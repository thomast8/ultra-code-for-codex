import { agentSchema, assertPayloadBound, taskResultSchema } from '../contracts/schema.js';
import type {
  AgentSpec,
  ExecuteWorker,
  JsonValue,
  TaskResult,
  WorkerEvent,
} from '../contracts/workflow.js';
import { requireWriterLease } from './resources.js';
import { ensureWorkerHandoff } from './reconciliation.js';
import { failedResult, maximumUsage, refreshSnapshot } from './records.js';
import type { Journal } from './journal.js';
import { asError, type Scheduler } from './scheduler.js';
import type { CallRecord, RunRecord } from './types.js';

export class Workers {
  private readonly controllers = new Map<string, { runId: string; controller: AbortController }>();
  constructor(
    private readonly scheduler: Scheduler,
    private readonly journal: Journal,
    private readonly execute: ExecuteWorker,
  ) {}
  enqueue(
    run: RunRecord,
    call: CallRecord,
    deliver: (value: JsonValue) => void,
    eligible: () => boolean,
  ): void {
    const spec = agentSchema.parse(call.payload) as AgentSpec;
    requireWriterLease(spec, call.claims);
    this.scheduler.enqueue({
      id: call.id,
      runId: run.snapshot.id,
      claims: call.claims,
      ready: () => eligible() && run.snapshot.state === 'running' && call.state === 'queued',
      waiting: () => this.waiting(run, call),
      run: () => this.executeCall(run, call, spec, deliver),
      invalid: (error) => {
        this.complete(run, call, failedResult(spec, error.message), deliver);
      },
    });
  }
  private async executeCall(
    run: RunRecord,
    call: CallRecord,
    spec: AgentSpec,
    deliver: (value: JsonValue) => void,
  ): Promise<boolean> {
    if (this.overBudget(run)) {
      run.snapshot.state = 'failed';
      run.snapshot.acceptanceOutcome = 'incomplete';
      run.snapshot.finishedAt ??= Date.now();
      run.snapshot.error = 'Observed token budget exhausted; no new workers may start';
      this.complete(run, call, failedResult(spec, run.snapshot.error), deliver);
      return true;
    }
    const controller = new AbortController();
    this.controllers.set(call.id, { runId: run.snapshot.id, controller });
    call.state = 'dispatched';
    call.task!.state = 'running';
    call.task!.waitingReason = null;
    call.task!.startedAt = Date.now();
    const timer = spec.timeoutMs ? setTimeout(() => controller.abort(), spec.timeoutMs) : null;
    let completedResult: TaskResult | undefined;
    let executionStarted = false;
    try {
      this.journal.save(run, 'task.dispatched', { taskId: call.id });
      executionStarted = true;
      const result = await this.execute(spec, {
        instanceId: run.owner.instanceId,
        signal: controller.signal,
        onEvent: (event) => this.event(run, call, event),
      });
      assertPayloadBound(result);
      taskResultSchema.parse(result);
      completedResult = result;
      this.complete(run, call, result, deliver);
      return result.execution !== 'uncertain';
    } catch (error) {
      if (!executionStarted) return this.completeUndispatched(run, call, spec, error, deliver);
      const failure = completedResult
        ? {
            ...completedResult,
            execution: 'uncertain' as const,
            acceptance: 'incomplete' as const,
            error: asError(error).message,
          }
        : failedResult(spec, asError(error).message, 'uncertain');
      this.recordUncertain(run, call, failure, deliver);
      return false;
    } finally {
      if (timer) clearTimeout(timer);
      this.controllers.delete(call.id);
    }
  }
  private completeUndispatched(
    run: RunRecord,
    call: CallRecord,
    spec: AgentSpec,
    error: unknown,
    deliver: (value: JsonValue) => void,
  ): boolean {
    try {
      this.complete(run, call, failedResult(spec, asError(error).message), deliver);
      return true;
    } catch (failure) {
      this.recordUncertain(
        run,
        call,
        failedResult(spec, asError(failure).message, 'uncertain'),
        deliver,
      );
      return false;
    }
  }
  private recordUncertain(
    run: RunRecord,
    call: CallRecord,
    result: TaskResult,
    deliver: (value: JsonValue) => void,
  ): void {
    try {
      this.complete(run, call, result, deliver);
    } catch {
      // A failed result write must not become an ordinary scheduler failure.
      // The durable dispatch and held lease require readback; do not acknowledge it.
      call.state = 'uncertain';
    }
  }
  private overBudget(run: RunRecord): boolean {
    const maximum = run.request.budget?.maxObservedTokens;
    return maximum !== undefined && (run.snapshot.usage?.totalTokens ?? 0) >= maximum;
  }
  private event(run: RunRecord, call: CallRecord, event: WorkerEvent): void {
    assertPayloadBound(event);
    const task = call.task!;
    task.lastActivityAt = Date.now();
    if (event.type === 'usage') task.usage = maximumUsage(task.usage, event.usage);
    if (event.type === 'activity') task.lastActivity = event.message;
    if (event.type === 'thread') {
      call.threadId = event.threadId;
      call.instructionSources = event.instructionSources;
      task.reportedModel = event.reportedModel;
    }
    if (event.type === 'turn') {
      call.threadId = event.threadId;
      call.turnId = event.turnId;
    }
    refreshSnapshot(run);
    this.journal.save(run, `worker.${event.type}`, { taskId: call.id, ...event });
  }
  private complete(
    run: RunRecord,
    call: CallRecord,
    result: TaskResult,
    deliver: (value: JsonValue) => void,
  ): void {
    const task = call.task!;
    task.finishedAt = Date.now();
    task.reportedModel = result.reportedModel ?? task.reportedModel;
    if (result.usage) task.usage = maximumUsage(task.usage, result.usage);
    result = {
      ...result,
      requestedModel: task.requestedModel,
      reportedModel: task.reportedModel,
      usage: task.usage,
    };
    task.result = result;
    task.waitingReason = null;
    task.state = result.execution === 'completed' ? 'completed' : 'failed';
    if (result.execution === 'interrupted') task.state = 'cancelled';
    if (result.execution === 'uncertain') {
      task.state = 'needs_reconciliation';
      run.snapshot.state = 'needs_reconciliation';
      run.snapshot.acceptanceOutcome = 'blocked';
      run.snapshot.finishedAt = null;
      ensureWorkerHandoff(call);
    }
    refreshSnapshot(run);
    deliver(result as unknown as JsonValue);
  }
  private waiting(run: RunRecord, call: CallRecord): void {
    if (call.task!.waitingReason === 'Resource claims are busy') return;
    call.task!.state = 'waiting';
    call.task!.waitingReason = 'Resource claims are busy';
    this.journal.save(run, 'task.waiting', { taskId: call.id, reason: call.task!.waitingReason });
  }
  wake(): void {
    this.scheduler.wake();
  }
  abort(runId: string): void {
    for (const entry of this.controllers.values())
      if (entry.runId === runId) entry.controller.abort();
  }
  abortAll(): void {
    for (const entry of this.controllers.values()) entry.controller.abort();
  }
}
