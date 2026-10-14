import { isDeepStrictEqual } from 'node:util';
import {
  agentSchema,
  assertPayloadBound,
  handoffSchema,
  phaseSchema,
} from '../contracts/schema.js';
import type { AgentSpec, JsonValue, LeadHandoffSpec } from '../contracts/workflow.js';
import type { Journal } from './journal.js';
import { attachTask, createCall, refreshSnapshot } from './records.js';
import { requireWriterLease, snapshotClaims } from './resources.js';
import { ScriptMachine } from './sandbox.js';
import type { CallKind, CallRecord, RunRecord } from './types.js';
import type { Workers } from './workers.js';

type Reply = (value: JsonValue) => void;
export class RunSession {
  private cursor = 0;
  private settlement = 1;
  private readonly replies = new Map<string, Reply>();
  private machine: ScriptMachine | undefined;
  private stopped = false;
  private failed = false;
  private readonly replayLength: number;
  constructor(
    readonly run: RunRecord,
    private readonly journal: Journal,
    private readonly workers: Workers,
    private readonly finished: () => void,
  ) {
    this.replayLength = run.calls.length;
  }
  replayReady(): boolean {
    return this.cursor >= this.replayLength && !this.failed && !this.stopped;
  }
  async launch(): Promise<void> {
    try {
      this.machine = await ScriptMachine.create({
        call: (kind, value) => this.call(kind, value),
        sync: (kind, value) => this.sync(kind, value),
        done: (value) => this.done(value),
        failed: (error) => this.fail(error.message),
      });
      if (this.stopped) {
        this.machine.close();
        return;
      }
      this.machine.start(this.run.request.script, this.run.request.args);
    } catch (error) {
      this.fail(error instanceof Error ? error.message : String(error));
    }
  }
  private intent(kind: CallKind, payload: JsonValue): { call: CallRecord; replay: boolean } {
    assertPayloadBound(payload);
    const saved = this.run.calls[this.cursor++];
    if (saved) {
      if (saved.kind !== kind || JSON.stringify(saved.payload) !== JSON.stringify(payload)) {
        this.fail('Replay host call does not match the durable journal', true);
        throw new Error('Replay mismatch');
      }
      if (this.cursor === this.replayLength) {
        this.journal.save(this.run, 'run.replay_ready');
        this.workers.wake();
      }
      return { call: saved, replay: true };
    }
    if (!['running', 'paused'].includes(this.run.snapshot.state))
      throw new Error('Run cannot dispatch new work');
    if (this.run.calls.length >= 4096) throw new Error('Workflow host call limit exceeded');
    const payloadBytes = this.run.calls.reduce(
      (sum, call) => sum + JSON.stringify(call.payload).length,
      0,
    );
    if (payloadBytes + JSON.stringify(payload).length > 8_388_608)
      throw new Error('Workflow payload limit exceeded');
    const call = createCall(this.run, kind, payload);
    this.run.calls.push(call);
    return { call, replay: false };
  }
  private sync(kind: 'phase' | 'log', value: JsonValue): JsonValue {
    if (!['phase', 'log'].includes(kind)) throw new Error('Unknown synchronous host call');
    if (typeof value !== 'string' || !value.trim() || value.length > 32_768)
      throw new Error('Expected bounded nonempty text');
    const { call, replay } = this.intent(kind, value);
    if (replay) return call.result;
    call.result =
      kind === 'phase'
        ? phaseSchema.parse({ id: `phase-${this.run.snapshot.phases.length + 1}`, label: value })
        : null;
    if (kind === 'phase') this.run.snapshot.phases.push(phaseSchema.parse(call.result));
    call.state = 'resolved';
    this.journal.save(this.run, kind, kind === 'log' ? value : call.result);
    return call.result;
  }
  private call(kind: CallKind, value: JsonValue): Promise<JsonValue> {
    try {
      if (kind !== 'agent' && kind !== 'lead') throw new Error('Unknown asynchronous host call');
      const { call, replay } = this.intent(kind, value);
      if (!replay) this.prepare(call);
      const result = new Promise<JsonValue>((resolve) => this.replies.set(call.id, resolve));
      if (call.state === 'queued' && kind === 'agent')
        this.workers.enqueue(
          this.run,
          call,
          (output) => this.resolve(call, output),
          () => this.replayReady(),
        );
      queueMicrotask(() => this.deliver());
      return result;
    } catch (error) {
      this.fail(error instanceof Error ? error.message : String(error));
      return Promise.reject(error);
    }
  }
  private prepare(call: CallRecord): void {
    if (call.kind === 'agent') this.prepareAgent(call);
    else {
      const spec = handoffSchema.parse(call.payload) as LeadHandoffSpec;
      this.validatePhase(spec.phase);
      call.claims = snapshotClaims(spec.resources);
      call.handoff = { id: call.id, spec, state: 'pending', claimedTurnId: null, result: null };
    }
    refreshSnapshot(this.run);
    this.journal.save(this.run, `${call.kind}.intent`, { callId: call.id });
  }
  private prepareAgent(call: CallRecord): void {
    const count = this.run.calls.filter((item) => item.kind === 'agent').length;
    if (count > this.run.request.maxAgentCalls) throw new Error('maxAgentCalls exceeded');
    const spec = agentSchema.parse(call.payload) as AgentSpec;
    const plan = this.run.authority.context.collaborationMode.toLowerCase().includes('plan');
    if (
      plan &&
      (spec.capability === 'workspace-write' ||
        spec.resources.some((claim) => claim.mode === 'write'))
    ) {
      throw new Error('Plan mode rejects write agents');
    }
    this.validatePhase(spec.phase);
    call.claims = snapshotClaims(spec.resources);
    requireWriterLease(spec, call.claims);
    attachTask(call, spec);
  }
  private validatePhase(value: { id: string; label: string }): void {
    if (
      !this.run.snapshot.phases.some(
        (phase) => phase.id === value.id && phase.label === value.label,
      )
    ) {
      throw new Error('Operation phase must come from phase(label)');
    }
  }
  resolve(call: CallRecord, value: JsonValue): void {
    assertPayloadBound(value);
    const previous = { result: call.result, state: call.state, settlement: call.settlement };
    const nextSettlement = this.run.nextSettlement;
    const updatedAt = this.run.snapshot.updatedAt;
    call.result = value;
    call.state = call.task?.state === 'needs_reconciliation' ? 'uncertain' : 'resolved';
    call.settlement = this.run.nextSettlement++;
    refreshSnapshot(this.run);
    try {
      this.journal.save(this.run, `${call.kind}.result`, {
        callId: call.id,
        settlement: call.settlement,
      });
    } catch (error) {
      Object.assign(call, previous);
      this.run.nextSettlement = nextSettlement;
      this.run.snapshot.updatedAt = updatedAt;
      throw error;
    }
    this.deliver();
    if (this.stopped || ['completed', 'failed', 'cancelled'].includes(this.run.snapshot.state))
      this.finished();
  }
  private deliver(): void {
    for (;;) {
      const call = this.run.calls.find((item) => item.settlement === this.settlement);
      if (!call) return;
      const reply = this.replies.get(call.id);
      if (!reply) return;
      this.replies.delete(call.id);
      this.settlement++;
      reply(call.result);
    }
  }
  private done(value: JsonValue): void {
    if (this.cursor !== this.run.calls.length) {
      this.fail('Replay ended before the journal', true);
      return;
    }
    if (['running', 'paused'].includes(this.run.snapshot.state)) {
      this.run.snapshot.state = 'completed';
      this.run.snapshot.result = value;
      this.run.snapshot.acceptanceOutcome = acceptance(this.run, value);
      if (this.run.calls.some((call) => call.state !== 'resolved'))
        this.run.snapshot.acceptanceOutcome = 'incomplete';
      this.run.snapshot.finishedAt = Date.now();
      this.journal.save(this.run, 'run.completed');
    }
    this.finished();
  }
  private fail(message: string, reconciliation = false): void {
    if (this.stopped || this.failed) return;
    this.failed = true;
    const blocked = reconciliation || this.run.snapshot.state === 'needs_reconciliation';
    this.run.snapshot.state = blocked ? 'needs_reconciliation' : 'failed';
    this.run.snapshot.acceptanceOutcome = blocked ? 'blocked' : 'incomplete';
    this.run.snapshot.finishedAt = blocked ? null : (this.run.snapshot.finishedAt ?? Date.now());
    this.run.snapshot.error = message;
    this.journal.save(this.run, 'run.failed', message);
    this.finished();
  }
  close(): void {
    this.stopped = true;
    this.machine?.close();
  }
}
function acceptance(run: RunRecord, value: JsonValue): RunRecord['snapshot']['acceptanceOutcome'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'unverified';
  if (value.acceptance === 'incomplete' || value.acceptance === 'blocked') return value.acceptance;
  const verified = run.calls.some(
    ({ handoff }) =>
      handoff?.state === 'resolved' &&
      handoff.result?.acceptance === 'satisfied' &&
      handoff.result.evidence.length > 0 &&
      isDeepStrictEqual(handoff.result, value),
  );
  return verified ? 'satisfied' : 'unverified';
}
