import { randomUUID } from 'node:crypto';
import type {
  AgentSpec,
  JsonValue,
  RunAuthority,
  StartRequest,
  TaskResult,
  TokenUsage,
} from '../contracts/workflow.js';
import type { CallKind, CallRecord, RunRecord } from './types.js';

export function createRun(request: StartRequest, authority: RunAuthority): RunRecord {
  const now = Date.now();
  return {
    version: 1,
    cancelRequested: false,
    owner: { instanceId: authority.context.instanceId, sessionId: authority.context.sessionId },
    request: structuredClone(request),
    requestBytes: JSON.stringify(request),
    authority: structuredClone(authority),
    calls: [],
    nextSettlement: 1,
    snapshot: {
      id: randomUUID(),
      title: request.title,
      objective: request.objective,
      state: 'queued',
      parentRunId: request.parentRunId ?? null,
      createdAt: now,
      updatedAt: now,
      finishedAt: null,
      acceptance: [...request.acceptance],
      acceptanceOutcome: 'unverified',
      phases: [],
      tasks: [],
      handoffs: [],
      usage: null,
      accountingComplete: false,
      result: null,
      error: null,
    },
  };
}
export function createCall(run: RunRecord, kind: CallKind, payload: JsonValue): CallRecord {
  return {
    id: `${run.snapshot.id}:${run.calls.length + 1}`,
    kind,
    payload,
    state: 'queued',
    settlement: null,
    result: null,
    claims: [],
    task: null,
    handoff: null,
    threadId: null,
    turnId: null,
    instructionSources: [],
  };
}
export function attachTask(call: CallRecord, spec: AgentSpec): void {
  call.task = {
    id: call.id,
    title: spec.title,
    phase: spec.phase,
    state: 'queued',
    waitingReason: null,
    requestedModel: spec.model,
    reportedModel: null,
    effort: spec.effort,
    assessment: spec.assessment,
    createdAt: Date.now(),
    startedAt: null,
    finishedAt: null,
    lastActivityAt: Date.now(),
    lastActivity: null,
    usage: null,
    result: null,
  };
}
export function failedResult(
  spec: AgentSpec,
  message: string,
  execution: TaskResult['execution'] = 'failed',
): TaskResult {
  return {
    execution,
    acceptance: 'incomplete',
    value: null,
    evidence: [],
    unresolved: [message],
    usage: null,
    requestedModel: spec.model,
    reportedModel: null,
    error: message,
  };
}
export function maximumUsage(left: TokenUsage | null, right: TokenUsage): TokenUsage {
  const output = { ...right };
  for (const key of Object.keys(output) as (keyof TokenUsage)[]) {
    output[key] = Math.max(left?.[key] ?? 0, right[key]);
  }
  return output;
}
export function refreshSnapshot(run: RunRecord): void {
  run.snapshot.tasks = run.calls.flatMap((call) => (call.task ? [call.task] : []));
  run.snapshot.handoffs = run.calls.flatMap((call) => (call.handoff ? [call.handoff] : []));
  const usage = run.snapshot.tasks.flatMap((task) => (task.usage ? [task.usage] : []));
  run.snapshot.usage = usage.length
    ? usage.reduce(
        (sum, value) => {
          for (const key of Object.keys(sum) as (keyof TokenUsage)[]) sum[key] += value[key];
          return sum;
        },
        {
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
          reasoningOutputTokens: 0,
          totalTokens: 0,
        },
      )
    : null;
}
