import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { LeadContext } from '../activation/types.js';
import { assertPayloadBound, leadResultSchema } from '../contracts/schema.js';
import type { AgentSpec, ArtifactRef, HandoffSnapshot, LeadResult } from '../contracts/workflow.js';
import type { Journal } from './journal.js';
import { failedResult } from './records.js';
import type { Scheduler } from './scheduler.js';
import type { CallRecord, RunRecord } from './types.js';

const confirmations = z.strictObject({
  terminationConfirmed: z.literal(true),
  writesReconciled: z.literal(true),
});
export function workerReceipt(value: unknown): LeadResult {
  const result = leadResultSchema.parse(value) as LeadResult;
  assertPayloadBound(result);
  if (!result.evidence.length || result.acceptance === 'blocked') {
    throw new Error('Worker readback requires evidence and an unblocked resolution');
  }
  confirmations.parse(result.value);
  return result;
}
export function ensureWorkerHandoff(call: CallRecord): void {
  if (call.handoff) return;
  const task = call.task!;
  task.result ??= {
    ...failedResult(
      call.payload as AgentSpec,
      'Worker was dispatched before runtime stopped; termination and possible writes require readback',
      'uncertain',
    ),
    reportedModel: task.reportedModel,
    usage: task.usage,
  };
  const evidence: ArtifactRef[] = [
    {
      id: `${call.id}:task`,
      description: `Original worker result and usage are retained in task ${call.id}`,
    },
  ];
  if (call.threadId)
    evidence.push({
      id: `${call.id}:thread`,
      description: `Recorded worker thread: ${call.threadId}`,
    });
  if (call.turnId)
    evidence.push({ id: `${call.id}:turn`, description: `Recorded worker turn: ${call.turnId}` });
  call.handoff = {
    id: call.id,
    state: 'pending',
    claimedTurnId: null,
    result: null,
    spec: {
      phase: task.phase,
      resources: call.claims,
      evidence,
      objective:
        'Verify worker termination and reconcile any possible writes before releasing this task’s reserved capacity and resources. Do not repeat the task. Resolve with evidence and value {terminationConfirmed:true,writesReconciled:true} only after checking termination and the resulting file or revision state.',
    },
  };
}
export function recoveredWorker(call: CallRecord): void {
  if (call.handoff?.state === 'resolved') {
    workerReceipt(call.handoff.result);
    call.state = 'resolved';
    call.task!.state = 'failed';
    return;
  }
  if (call.state !== 'uncertain') return;
  ensureWorkerHandoff(call);
  if (call.handoff!.state === 'claimed') call.handoff!.state = 'needs_reconciliation';
}
export function changeWorkerHandoff(input: {
  run: RunRecord;
  call: CallRecord;
  action: 'claim' | 'resolve';
  context: LeadContext;
  resolution?: LeadResult;
  journal: Journal;
  scheduler: Scheduler;
}): HandoffSnapshot {
  const { run, call, action, context, journal, scheduler } = input;
  const handoff = call.handoff!;
  if (context.collaborationMode !== 'default')
    throw new Error('Worker readback requires a verified Default-mode turn');
  if (action === 'claim') {
    claimReadback(run, call, context, journal);
    return structuredClone(handoff);
  }
  const receipt = workerReceipt(input.resolution);
  if (handoff.state === 'resolved') {
    if (!isDeepStrictEqual(handoff.result, receipt))
      throw new Error('Conflicting handoff resolution');
    return structuredClone(handoff);
  }
  if (handoff.state !== 'claimed' || handoff.claimedTurnId !== context.turnId) {
    throw new Error('Worker readback must be claimed by this exact verified turn');
  }
  persistReceipt(run, call, receipt, context.turnId, journal);
  scheduler.resolveQuarantine(call.id);
  return structuredClone(handoff);
}
function claimReadback(
  run: RunRecord,
  call: CallRecord,
  context: LeadContext,
  journal: Journal,
): void {
  const handoff = call.handoff!;
  if (run.snapshot.state !== 'needs_reconciliation')
    throw new Error('Run does not need worker reconciliation');
  if (handoff.state === 'claimed' && handoff.claimedTurnId === context.turnId) return;
  if (!['pending', 'needs_reconciliation'].includes(handoff.state))
    throw new Error(`Handoff cannot be claimed in ${handoff.state}`);
  const before = { state: handoff.state, claimedTurnId: handoff.claimedTurnId };
  handoff.state = 'claimed';
  handoff.claimedTurnId = context.turnId;
  try {
    journal.save(run, 'worker.readback_claimed', { taskId: call.id, turnId: context.turnId });
  } catch (error) {
    Object.assign(handoff, before);
    throw error;
  }
}
function persistReceipt(
  run: RunRecord,
  call: CallRecord,
  receipt: LeadResult,
  turnId: string,
  journal: Journal,
): void {
  const handoff = call.handoff!;
  const before = { state: handoff.state, result: handoff.result };
  const callState = call.state;
  const taskState = call.task!.state;
  const snapshot = {
    state: run.snapshot.state,
    acceptanceOutcome: run.snapshot.acceptanceOutcome,
    finishedAt: run.snapshot.finishedAt,
    error: run.snapshot.error,
    updatedAt: run.snapshot.updatedAt,
  };
  handoff.result = receipt;
  handoff.state = 'resolved';
  call.state = 'resolved';
  call.task!.state = 'failed';
  if (!run.calls.some((other) => other.state === 'uncertain')) closeReadbackRun(run);
  try {
    journal.save(run, 'worker.readback_resolved', { taskId: call.id, turnId, receipt });
  } catch (error) {
    Object.assign(handoff, before);
    call.state = callState;
    call.task!.state = taskState;
    Object.assign(run.snapshot, snapshot);
    throw error;
  }
}

export function hasWorkerReadback(run: RunRecord): boolean {
  return run.calls.some((call) => call.kind === 'agent' && call.handoff?.state === 'resolved');
}
export function closeReadbackRun(run: RunRecord): void {
  run.snapshot.state = run.cancelRequested ? 'cancelled' : 'failed';
  run.snapshot.acceptanceOutcome = 'incomplete';
  run.snapshot.finishedAt ??= Date.now();
  run.snapshot.error = 'Worker readback recorded; retry requires a new linked run';
}
