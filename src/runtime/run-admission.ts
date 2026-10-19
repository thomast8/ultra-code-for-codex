import type { AgentSpec, StartRequest } from '../contracts/workflow.js';
import type { CallRecord, RunRecord } from './types.js';

export function prepareRun(
  run: RunRecord,
  getRun: (id: string) => RunRecord,
  existing: Iterable<RunRecord>,
): void {
  const request = run.request;
  const parent = request.parentRunId ? getRun(request.parentRunId) : null;
  if (run.version === 2 && parent) run.snapshot.attemptKind = attemptKind(parent);
  if (request.continuationOf) {
    const continuation = resolveContinuation(request, getRun, [...existing]);
    run.continuation = continuation;
    run.snapshot.continuationOf = { ...request.continuationOf, kind: continuation.kind };
    if (continuation.kind === 'repair') run.snapshot.attemptKind = 'repair';
  }
  if (run.version === 2 && request.evidenceRefs?.length)
    run.sourceEvidence = savedEvidence(request.evidenceRefs, getRun);
}

function attemptKind(parent: RunRecord): 'repair' | 'follow-up' {
  const failed =
    parent.snapshot.state === 'failed' ||
    ['incomplete', 'blocked'].includes(parent.snapshot.acceptanceOutcome) ||
    parent.snapshot.tasks.some((task) =>
      ['failed', 'cancelled', 'needs_reconciliation'].includes(task.state),
    );
  return failed ? 'repair' : 'follow-up';
}

function resolveContinuation(
  request: StartRequest,
  getRun: (id: string) => RunRecord,
  existing: RunRecord[],
): NonNullable<RunRecord['continuation']> {
  const ref = request.continuationOf!;
  if (request.contractVersion !== 2 || request.parentRunId !== ref.runId)
    throw new Error('Continuation requires a version-2 parent run');
  const call = continuationCall(ref, getRun, existing);
  const spec = call.payload as AgentSpec;
  if (!spec.format) throw new Error('Legacy ephemeral workers cannot be continued');
  return {
    threadId: call.threadId!,
    cwd: spec.assignment.ownership.cwd,
    capability: spec.capability,
    kind: call.task!.result!.execution === 'completed' ? 'follow-up' : 'repair',
  };
}

function continuationCall(
  ref: { runId: string; taskId: string },
  getRun: (id: string) => RunRecord,
  existing: RunRecord[],
): CallRecord {
  const source = getRun(ref.runId);
  const call = source.calls.find((item) => item.task?.id === ref.taskId);
  if (!call?.threadId || !call.task || call.state !== 'resolved')
    throw new Error('Source worker cannot be continued');
  if (!['completed', 'failed'].includes(call.task.result?.execution ?? ''))
    throw new Error('Source worker termination is not verified');
  const latest = existing.filter((item) => item.continuation?.threadId === call.threadId).at(-1);
  if (latest && latest.snapshot.id !== ref.runId)
    throw new Error('Continue the latest worker task for this thread');
  return call;
}

function savedEvidence(
  refs: NonNullable<StartRequest['evidenceRefs']>,
  getRun: (id: string) => RunRecord,
): string[] {
  const selected = refs.map((ref) => {
    const match = /^ultra:\/\/run\/([^/]+)\/task\/([^/]+)$/.exec(ref.uri ?? '');
    if (!match) throw new Error(`Evidence ${ref.id} needs an Ultra task URI`);
    const run = getRun(match[1]!);
    const task = run.calls.find((call) => call.task?.id === match[2]!)?.task;
    if (task?.result?.execution !== 'completed')
      throw new Error(`Evidence ${ref.id} has no completed saved result`);
    const source = {
      runId: match[1],
      taskId: match[2],
      acceptance: task.result.acceptance,
      unresolved: task.result.unresolved,
      evidence: task.result.evidence,
      value: task.result.value,
    };
    return `Evidence ${ref.id}: ${ref.description}\n${JSON.stringify(source)}`;
  });
  const bytes = Buffer.byteLength(selected.join('\n\n'));
  if (bytes > 48_000) throw new Error(`Saved evidence is ${bytes} bytes; limit is 48000 bytes`);
  return selected;
}
