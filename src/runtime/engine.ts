import type { LeadContext } from '../activation/types.js';
import { assertPayloadBound, capacitySchema, startSchema } from '../contracts/schema.js';
import type {
  EventBatch,
  ExecuteWorker,
  HandoffSnapshot,
  LeadResult,
  RunAuthority,
  RunSnapshot,
  StartRequest,
  TaskResult,
} from '../contracts/workflow.js';
import { assertContext, assertOwner, changeHandoff } from './handoffs.js';
import { Journal } from './journal.js';
import { closeReadbackRun, hasWorkerReadback, recoveredWorker } from './reconciliation.js';
import { createRun, failedResult, refreshSnapshot, emptyUsage } from './records.js';
import { Scheduler } from './scheduler.js';
import { RunSession } from './session.js';
import type { CallRecord, Owner, RunRecord } from './types.js';
import { Workers } from './workers.js';
import type { AgentSpec, JsonValue } from '../contracts/workflow.js';

export class WorkflowEngine {
  private readonly journal: Journal;
  private readonly runs = new Map<string, RunRecord>();
  private readonly sessions = new Map<string, RunSession>();
  private readonly scheduler = new Scheduler();
  private readonly workers: Workers;
  private closing = false;
  private closeOperation: Promise<void> | null = null;
  constructor(options: { dataDir: string; executeWorker: ExecuteWorker }) {
    this.journal = new Journal(options.dataDir);
    this.workers = new Workers(this.scheduler, this.journal, options.executeWorker);
    for (const run of this.loadRecords()) {
      this.runs.set(run.snapshot.id, run);
      this.recover(run);
    }
  }
  private loadRecords(): RunRecord[] {
    try {
      return this.journal.load();
    } catch (error) {
      this.journal.close();
      throw error;
    }
  }
  start(request: StartRequest, authority: RunAuthority): RunSnapshot {
    this.assertOpen();
    assertPayloadBound(request);
    startSchema.parse(request);
    capacitySchema.parse(authority.capacity);
    const owner = {
      instanceId: authority.context.instanceId,
      sessionId: authority.context.sessionId,
    };
    assertContext(owner, authority.context);
    if (request.parentRunId) this.owned(owner, request.parentRunId);
    const existing = [...this.runs.values()].find(
      (run) =>
        run.request.requestId === request.requestId &&
        run.owner.instanceId === owner.instanceId &&
        run.owner.sessionId === owner.sessionId,
    );
    if (existing) {
      if (existing.requestBytes !== JSON.stringify(request))
        throw new Error('requestId reused with a different payload');
      return structuredClone(existing.snapshot);
    }
    const run = createRun(request, authority);
    this.journal.save(run, 'run.created');
    this.runs.set(run.snapshot.id, run);
    this.launch(run);
    return structuredClone(run.snapshot);
  }
  status(owner: Owner, runIds?: string[]): RunSnapshot[] {
    const runs = runIds
      ? runIds.map((id) => this.owned(owner, id))
      : [...this.runs.values()].filter(
          (run) =>
            run.owner.instanceId === owner.instanceId && run.owner.sessionId === owner.sessionId,
        );
    return structuredClone(runs.map((run) => run.snapshot));
  }
  result(owner: Owner, runId: string, taskId?: string): RunSnapshot | TaskResult | null {
    const run = this.owned(owner, runId);
    if (!taskId) return structuredClone(run.snapshot);
    const task = run.calls.find((call) => call.task?.id === taskId)?.task;
    if (!task) throw new Error('Task not found in this run');
    return structuredClone(task.result);
  }
  control(owner: Owner, runId: string, action: 'pause' | 'resume' | 'cancel'): RunSnapshot {
    this.assertOpen();
    const run = this.owned(owner, runId);
    if (action === 'pause' && ['running', 'queued'].includes(run.snapshot.state))
      run.snapshot.state = 'paused';
    if (action === 'resume') this.resume(run);
    if (action === 'cancel') this.cancel(run);
    this.journal.save(run, `run.${action}`);
    this.scheduler.wake();
    return structuredClone(run.snapshot);
  }
  currentCursor(owner: Owner, runIds?: string[]): number {
    return this.journal.currentCursor(this.status(owner, runIds).map((run) => run.id));
  }
  events(owner: Owner, afterCursor: number, runIds?: string[]): EventBatch {
    if (!Number.isSafeInteger(afterCursor) || afterCursor < 0)
      throw new Error('Invalid event cursor');
    const allowed = new Set(this.status(owner, runIds).map((run) => run.id));
    const batch = this.journal.events(owner, afterCursor, runIds);
    return {
      cursor: batch.at(-1)?.cursor ?? afterCursor,
      events: batch.filter((event) => allowed.has(event.runId)),
    };
  }
  handoff(
    owner: Owner,
    id: string,
    action: 'claim' | 'resolve',
    context: LeadContext,
    resolution?: LeadResult,
  ): HandoffSnapshot {
    this.assertOpen();
    const run = [...this.runs.values()].find((item) =>
      item.calls.some((call) => call.handoff?.id === id),
    );
    if (!run) throw new Error('Handoff not found');
    assertOwner(owner, run);
    const session = this.sessions.get(run.snapshot.id);
    const call = run.calls.find((item) => item.handoff?.id === id)!;
    if (action === 'claim' && call.kind === 'lead' && session && !session.replayReady()) {
      throw new Error('Workflow replay is not complete; inspect status before claiming lead work');
    }
    const result = changeHandoff({
      run,
      call,
      owner,
      action,
      context,
      ...(resolution ? { resolution } : {}),
      journal: this.journal,
      scheduler: this.scheduler,
      session,
    });
    refreshSnapshot(run);
    if (action === 'resolve') this.afterHandoffResolution(run, call.kind);
    return result;
  }
  private afterHandoffResolution(run: RunRecord, kind: string): void {
    if (kind === 'agent') {
      this.sessions.get(run.snapshot.id)?.close();
      this.releaseGrant(run);
      return;
    }
    if (this.reconciled(run)) this.continueReconciled(run);
  }
  private continueReconciled(run: RunRecord): void {
    if (hasWorkerReadback(run)) {
      closeReadbackRun(run);
      this.journal.save(run, 'run.readback_closed');
      return;
    }
    if (!run.cancelRequested) {
      this.launch(run);
      return;
    }
    run.snapshot.state = 'cancelled';
    run.snapshot.acceptanceOutcome = 'incomplete';
    run.snapshot.finishedAt ??= Date.now();
    this.journal.save(run, 'run.cancelled');
  }
  private reconciled(run: RunRecord): boolean {
    return (
      run.snapshot.state === 'needs_reconciliation' &&
      !run.calls.some(
        (call) => call.state === 'uncertain' || call.handoff?.state === 'needs_reconciliation',
      )
    );
  }
  private owned(owner: Owner, id: string): RunRecord {
    const run = this.runs.get(id);
    if (!run) throw new Error('Run not found');
    assertOwner(owner, run);
    return run;
  }
  private launch(run: RunRecord): void {
    run.snapshot.state = 'running';
    const { totalSlots, reservedSlots } = run.authority.capacity;
    this.scheduler.setGrant(run.snapshot.id, totalSlots - reservedSlots);
    const session = new RunSession(run, this.journal, this.workers, () => this.releaseGrant(run));
    this.sessions.set(run.snapshot.id, session);
    this.journal.save(run, 'run.running');
    void session.launch();
  }
  private recover(run: RunRecord): void {
    this.settleRecoveredQueue(run);
    const uncertain = run.calls.map((call) => this.recoverCall(call)).some(Boolean);
    refreshSnapshot(run);
    if (uncertain) {
      const grant = run.authority.capacity;
      this.scheduler.setGrant(run.snapshot.id, grant.totalSlots - grant.reservedSlots);
      run.snapshot.state = 'needs_reconciliation';
      run.snapshot.acceptanceOutcome = 'blocked';
      run.snapshot.finishedAt = null;
      this.journal.save(run, 'run.reconciliation_required');
    } else if (hasWorkerReadback(run)) {
      if (['failed', 'cancelled'].includes(run.snapshot.state)) return;
      closeReadbackRun(run);
      this.journal.save(run, 'run.readback_closed');
    } else if (['running', 'queued'].includes(run.snapshot.state)) this.launch(run);
    else if (run.snapshot.state === 'paused') {
      const grant = run.authority.capacity;
      this.scheduler.setGrant(run.snapshot.id, grant.totalSlots - grant.reservedSlots);
    }
  }
  private settleRecoveredQueue(run: RunRecord): void {
    if (!['completed', 'failed', 'cancelled'].includes(run.snapshot.state)) return;
    const queued = run.calls.filter((call) => call.state === 'queued' && call.task);
    if (!queued.length) return;
    for (const call of queued) this.cancelQueued(run, call.id);
    refreshSnapshot(run);
    this.journal.save(run, 'run.queued_settled');
  }
  private recoverCall(call: CallRecord): boolean {
    if (call.state === 'dispatched') {
      call.state = 'uncertain';
      if (call.task) call.task.state = 'needs_reconciliation';
      if (call.handoff) call.handoff.state = 'needs_reconciliation';
    }
    if (call.kind === 'agent') recoveredWorker(call);
    if (call.state !== 'uncertain') return false;
    this.scheduler.quarantine(call.id, call.claims, call.kind === 'agent');
    return true;
  }
  private resume(run: RunRecord): void {
    if (run.snapshot.state !== 'paused') return;
    run.snapshot.state = 'running';
    if (!this.sessions.has(run.snapshot.id)) this.launch(run);
  }
  private cancel(run: RunRecord): void {
    if (
      ['completed', 'failed', 'cancelled'].includes(run.snapshot.state) &&
      !run.calls.some((call) => call.state === 'dispatched')
    )
      return;
    run.cancelRequested = true;
    for (const call of run.calls) {
      if (call.handoff?.state !== 'claimed') continue;
      call.handoff.state = 'needs_reconciliation';
      call.state = 'uncertain';
    }
    this.markCancellation(run);
    this.sessions.get(run.snapshot.id)?.close();
    this.scheduler.remove(run.snapshot.id);
    this.releaseGrant(run);
    this.workers.abort(run.snapshot.id);
    for (const call of run.calls) this.cancelQueued(run, call.id);
    refreshSnapshot(run);
  }
  private markCancellation(run: RunRecord): void {
    const uncertain = run.calls.some((call) => call.state === 'uncertain');
    run.snapshot.state = uncertain ? 'needs_reconciliation' : 'cancelled';
    run.snapshot.acceptanceOutcome = uncertain ? 'blocked' : 'incomplete';
    run.snapshot.finishedAt = uncertain ? null : (run.snapshot.finishedAt ?? Date.now());
  }
  private releaseGrant(run: RunRecord): void {
    if (
      !run.calls.some(
        (call) =>
          call.task?.state === 'needs_reconciliation' ||
          (call.kind === 'agent' && call.state === 'dispatched'),
      )
    ) {
      this.scheduler.removeGrant(run.snapshot.id);
    }
  }
  private cancelQueued(run: RunRecord, id: string): void {
    const call = run.calls.find((item) => item.id === id)!;
    if (call.state !== 'queued' || !call.task) return;
    const result = failedResult(
      call.payload as AgentSpec,
      'Run closed before dispatch',
      'interrupted',
    );
    call.state = 'resolved';
    call.result = result as unknown as JsonValue;
    call.settlement = run.nextSettlement++;
    call.task.state = 'cancelled';
    result.usage = emptyUsage();
    call.task.usage = result.usage;
    call.task.waitingReason = null;
    call.task.result = result;
    call.task.finishedAt = Date.now();
  }
  private assertOpen(): void {
    if (this.closing) throw new Error('Engine is closing');
  }
  close(): Promise<void> {
    this.closeOperation ??= this.finishClose();
    return this.closeOperation;
  }
  private async finishClose(): Promise<void> {
    this.closing = true;
    for (const session of this.sessions.values()) session.close();
    this.workers.abortAll();
    await this.scheduler.close();
    this.journal.close();
  }
}
