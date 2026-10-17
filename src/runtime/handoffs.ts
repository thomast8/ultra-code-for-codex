import type { LeadContext } from '../activation/types.js';
import { assertPayloadBound, leadResultSchema } from '../contracts/schema.js';
import type { HandoffSnapshot, JsonValue, LeadResult } from '../contracts/workflow.js';
import type { Journal } from './journal.js';
import { changeWorkerHandoff } from './reconciliation.js';
import type { Scheduler } from './scheduler.js';
import type { RunSession } from './session.js';
import type { CallRecord, Owner, RunRecord } from './types.js';

export function assertOwner(owner: Owner, run: RunRecord): void {
  if (owner.instanceId !== run.owner.instanceId || owner.sessionId !== run.owner.sessionId) {
    throw new Error('Run does not belong to the selected lead');
  }
}
export function assertContext(owner: Owner, context: LeadContext): void {
  if (
    context.resolutionStatus !== 'verified' ||
    !context.turnId ||
    !context.instanceId ||
    !context.sessionId
  ) {
    throw new Error('An exact verified lead turn is required');
  }
  if (!['default', 'plan'].includes(context.collaborationMode)) {
    throw new Error('A supported collaboration mode (default or plan) is required');
  }
  if (context.instanceId !== owner.instanceId || context.sessionId !== owner.sessionId) {
    throw new Error('Lead context does not match the owner');
  }
}
type HandoffInput = {
  run: RunRecord;
  call: CallRecord;
  owner: Owner;
  action: 'claim' | 'resolve';
  context: LeadContext;
  resolution?: LeadResult;
  journal: Journal;
  scheduler: Scheduler;
  session: RunSession | undefined;
};
export function changeHandoff(input: HandoffInput): HandoffSnapshot {
  assertOwner(input.owner, input.run);
  assertContext(input.owner, input.context);
  if (input.call.kind === 'agent') return changeWorkerHandoff(input);
  return changeLeadHandoff(input);
}
function changeLeadHandoff(input: HandoffInput): HandoffSnapshot {
  const { run, call, action, context, scheduler } = input;
  const handoff = call.handoff!;
  if (action === 'claim') {
    if (
      handoff.spec.kind !== 'planning' &&
      [context, run.authority.context].some((lead) =>
        lead.collaborationMode.toLowerCase().includes('plan'),
      )
    ) {
      throw new Error('Plan mode cannot claim consequential lead work; start a Default-mode run');
    }
    if (run.snapshot.state !== 'running')
      throw new Error(`Run ${run.snapshot.state} cannot claim new lead work`);
    claim(input);
  } else {
    const resolution = leadResultSchema.parse(input.resolution) as LeadResult;
    assertPayloadBound(resolution);
    if (handoff.state === 'resolved') {
      if (JSON.stringify(handoff.result) !== JSON.stringify(resolution))
        throw new Error('Conflicting handoff resolution');
      return structuredClone(handoff);
    }
    if (handoff.state === 'pending') throw new Error('Handoff must be claimed before resolution');
    if (handoff.state === 'claimed' && handoff.claimedTurnId !== context.turnId)
      throw new Error('Handoff claimed by another turn');
    persistResolution(input, resolution);
    scheduler.resources.release(call.id);
    scheduler.wake();
  }
  return structuredClone(handoff);
}
function claim({ run, call, context, scheduler, journal }: HandoffInput): void {
  const handoff = call.handoff!;
  if (handoff.state === 'claimed' && handoff.claimedTurnId === context.turnId) return;
  if (handoff.state !== 'pending') throw new Error(`Handoff cannot be claimed in ${handoff.state}`);
  if (!scheduler.resources.acquire(call.id, call.claims))
    throw new Error('Handoff resources are busy');
  const before = { state: handoff.state, claimedTurnId: handoff.claimedTurnId };
  const callState = call.state;
  const updatedAt = run.snapshot.updatedAt;
  handoff.state = 'claimed';
  handoff.claimedTurnId = context.turnId;
  call.state = 'dispatched';
  try {
    journal.save(run, 'handoff.claimed', { handoffId: call.id, turnId: context.turnId });
  } catch (error) {
    Object.assign(handoff, before);
    call.state = callState;
    run.snapshot.updatedAt = updatedAt;
    scheduler.resources.release(call.id);
    scheduler.wake();
    throw error;
  }
}
function persistResolution(input: HandoffInput, resolution: LeadResult): void {
  const { run, call, context, journal, session } = input;
  const handoff = call.handoff!;
  const previousHandoff = { state: handoff.state, result: handoff.result };
  const previousCall = { result: call.result, state: call.state, settlement: call.settlement };
  const nextSettlement = run.nextSettlement;
  const updatedAt = run.snapshot.updatedAt;
  handoff.result = resolution;
  handoff.state = 'resolved';
  try {
    if (session) session.resolve(call, resolution as JsonValue);
    else {
      call.result = resolution as JsonValue;
      call.state = 'resolved';
      call.settlement = run.nextSettlement++;
      journal.save(run, 'handoff.result', { handoffId: call.id, turnId: context.turnId });
    }
  } catch (error) {
    Object.assign(handoff, previousHandoff);
    Object.assign(call, previousCall);
    run.nextSettlement = nextSettlement;
    run.snapshot.updatedAt = updatedAt;
    throw error;
  }
}
