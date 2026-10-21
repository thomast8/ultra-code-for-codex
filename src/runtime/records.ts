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
    version: request.contractVersion === 2 ? 2 : 1,
    cancelRequested: false,
    owner: { instanceId: authority.context.instanceId, sessionId: authority.context.sessionId },
    request: structuredClone(request),
    requestBytes: JSON.stringify(request),
    authority: structuredClone(authority),
    calls: [],
    nextSettlement: 1,
    snapshot: {
      id: randomUUID(),
      ...(request.continuationOf
        ? { continuationOf: { ...request.continuationOf, kind: 'follow-up' as const } }
        : {}),
      title: request.title,
      objective: request.objective,
      ...(request.budget ? { budget: structuredClone(request.budget) } : {}),
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
    ...(spec.format ? {} : { assessment: spec.assessment }),
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
export function emptyUsage(): TokenUsage {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
  };
}
export function maximumUsage(left: TokenUsage | null, right: TokenUsage): TokenUsage {
  const prior = left ?? emptyUsage();
  const output = {
    inputTokens: Math.max(prior.inputTokens, right.inputTokens),
    cachedInputTokens: Math.max(prior.cachedInputTokens, right.cachedInputTokens),
    outputTokens: Math.max(prior.outputTokens, right.outputTokens),
    reasoningOutputTokens: Math.max(prior.reasoningOutputTokens, right.reasoningOutputTokens),
    totalTokens: Math.max(prior.totalTokens, right.totalTokens),
  };
  const cacheWrite = maximumKnownCacheWrite(left, right);
  return cacheWrite !== undefined ? { ...output, cacheWriteInputTokens: cacheWrite } : output;
}
function maximumKnownCacheWrite(left: TokenUsage | null, right: TokenUsage): number | undefined {
  if (right.cacheWriteInputTokens !== undefined)
    return Math.max(left?.cacheWriteInputTokens ?? 0, right.cacheWriteInputTokens);
  if (left?.cacheWriteInputTokens !== undefined && right.totalTokens <= left.totalTokens)
    return left.cacheWriteInputTokens;
  return undefined;
}
export function refreshSnapshot(run: RunRecord): void {
  run.snapshot.tasks = run.calls.flatMap((call) => (call.task ? [call.task] : []));
  run.snapshot.handoffs = run.calls.flatMap((call) => (call.handoff ? [call.handoff] : []));
  const usage = run.snapshot.tasks.flatMap((task) => (task.usage ? [task.usage] : []));
  run.snapshot.accountingComplete = run.snapshot.tasks.every(
    (task) => task.result !== null && task.result.execution !== 'uncertain' && task.usage !== null,
  );
  run.snapshot.usage =
    usage.length || !run.snapshot.tasks.length
      ? usage.reduce((sum, value) => {
          sum.inputTokens += value.inputTokens;
          sum.cachedInputTokens += value.cachedInputTokens;
          sum.outputTokens += value.outputTokens;
          sum.reasoningOutputTokens += value.reasoningOutputTokens;
          sum.totalTokens += value.totalTokens;
          if (sum.cacheWriteInputTokens !== undefined && value.cacheWriteInputTokens !== undefined)
            sum.cacheWriteInputTokens += value.cacheWriteInputTokens;
          else delete sum.cacheWriteInputTokens;
          return sum;
        }, emptyUsage())
      : null;
}
