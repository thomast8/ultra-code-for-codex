import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { LeadResult } from '../src/contracts/workflow.js';
import { WorkflowEngine } from '../src/runtime/engine.js';
import { Journal } from '../src/runtime/journal.js';
import type { RunRecord } from '../src/runtime/types.js';
import { authority, harness, output, owner, request, until } from './runtime-fixture.js';

const script = `const p=phase('Verify'); const result=await lead({phase:p,
  objective:'Inspect patch',resources:[{key:'patch',mode:'write'}],evidence:[]});
  log('resolution delivered'); return result;`;
const resolution: LeadResult = {
  acceptance: 'satisfied',
  value: 'checked',
  evidence: [{ id: 'readback', description: 'Verified patch' }],
};
const writer = `const p=phase('Verify'); return await agent({...args.spec,phase:p,
  resources:[{key:'patch',mode:'write'}]});`;

afterEach(() => vi.restoreAllMocks());
function failSaveOnce(type: string) {
  const save = Journal.prototype.save;
  let failed = false;
  return vi.spyOn(Journal.prototype, 'save').mockImplementation(function (
    this: Journal,
    run,
    event,
    data,
  ) {
    if (!failed && event === type) {
      failed = true;
      throw new Error('Injected journal failure');
    }
    save.call(this, run, event, data);
  });
}
function durable(dataDir: string, id: string): RunRecord {
  const db = new DatabaseSync(join(dataDir, 'workflow.sqlite'), { readOnly: true });
  try {
    return JSON.parse(
      String(db.prepare('SELECT record FROM runs WHERE id=?').get(id)!.record),
    ) as RunRecord;
  } finally {
    db.close();
  }
}

it('rolls back a failed lead claim and releases only its unsaved reservation', async () => {
  const { engine, calls, dataDir } = harness();
  const run = engine.start(request(script), authority);
  await until(() => engine.status(owner)[0]!.handoffs.length === 1);
  const id = engine.status(owner)[0]!.handoffs[0]!.id;
  failSaveOnce('handoff.claimed');
  expect(() => engine.handoff(owner, id, 'claim', authority.context)).toThrow('Injected');
  expect(engine.status(owner)[0]!.handoffs[0]).toMatchObject({
    state: 'pending',
    claimedTurnId: null,
  });
  expect(durable(dataDir, run.id).calls[1]!.state).toBe('queued');
  engine.start(request(writer, { requestId: 'competing' }), authority);
  await until(() => calls.length === 1);
  calls[0]!.finish(output());
  await until(() => engine.status(owner)[1]!.state === 'completed');
  expect(engine.handoff(owner, id, 'claim', authority.context).state).toBe('claimed');
  expect(engine.handoff(owner, id, 'claim', authority.context).state).toBe('claimed');
  expect(
    engine.events(owner, 0, [run.id]).events.filter((event) => event.type === 'handoff.claimed'),
  ).toHaveLength(1);
  await engine.close();
});

it('retains a failed live resolution until one durable retry and reuses the acknowledged receipt after restart', async () => {
  const { engine, calls, dataDir } = harness();
  const run = engine.start(request(script), authority);
  await until(() => engine.status(owner)[0]!.handoffs.length === 1);
  const id = engine.status(owner)[0]!.handoffs[0]!.id;
  engine.handoff(owner, id, 'claim', authority.context);
  engine.start(request(writer, { requestId: 'competing' }), authority);
  await until(() => engine.status(owner)[1]!.tasks.length === 1);
  failSaveOnce('lead.result');
  expect(() => engine.handoff(owner, id, 'resolve', authority.context, resolution)).toThrow(
    'Injected',
  );
  expect(engine.status(owner)[0]!.handoffs[0]).toMatchObject({ state: 'claimed', result: null });
  expect(durable(dataDir, run.id).calls[1]).toMatchObject({
    state: 'dispatched',
    result: null,
    settlement: null,
  });
  expect(engine.events(owner, 0, [run.id]).events.some((event) => event.type === 'log')).toBe(
    false,
  );
  expect(calls).toHaveLength(0);
  engine.handoff(owner, id, 'resolve', authority.context, resolution);
  expect(engine.handoff(owner, id, 'resolve', authority.context, resolution).result).toEqual(
    resolution,
  );
  await until(() => calls.length === 1 && engine.status(owner)[0]!.state === 'completed');
  calls[0]!.finish(output());
  expect(durable(dataDir, run.id).nextSettlement).toBe(2);
  expect(
    engine.events(owner, 0, [run.id]).events.filter((event) => event.type === 'lead.result'),
  ).toHaveLength(1);
  await engine.close();
  const execute = vi.fn(async () => output());
  const recovered = new WorkflowEngine({ dataDir, executeWorker: execute });
  expect(recovered.handoff(owner, id, 'resolve', authority.context, resolution).result).toEqual(
    resolution,
  );
  expect(recovered.status(owner)[0]!.acceptanceOutcome).toBe('satisfied');
  expect(execute).not.toHaveBeenCalled();
  await recovered.close();
});

it('keeps restart readback quarantined when its result save fails and persists the explicit retry', async () => {
  const { engine, dataDir } = harness();
  const run = engine.start(request(script), authority);
  await until(() => engine.status(owner)[0]!.handoffs.length === 1);
  const id = engine.status(owner)[0]!.handoffs[0]!.id;
  engine.handoff(owner, id, 'claim', authority.context);
  failSaveOnce('lead.result');
  expect(() => engine.handoff(owner, id, 'resolve', authority.context, resolution)).toThrow(
    'Injected',
  );
  await engine.close();
  const execute = vi.fn(async () => output());
  const recovered = new WorkflowEngine({ dataDir, executeWorker: execute });
  expect(recovered.status(owner)[0]!.handoffs[0]!.state).toBe('needs_reconciliation');
  vi.restoreAllMocks();
  failSaveOnce('handoff.result');
  expect(() => recovered.handoff(owner, id, 'resolve', authority.context, resolution)).toThrow(
    'Injected',
  );
  expect(recovered.status(owner)[0]!.handoffs[0]).toMatchObject({
    state: 'needs_reconciliation',
    result: null,
  });
  expect(durable(dataDir, run.id).calls[1]!.settlement).toBeNull();
  recovered.handoff(owner, id, 'resolve', authority.context, resolution);
  await until(() => recovered.status(owner)[0]!.state === 'completed');
  expect(durable(dataDir, run.id).nextSettlement).toBe(2);
  expect(
    recovered.events(owner, 0, [run.id]).events.filter((event) => event.type === 'handoff.result'),
  ).toHaveLength(1);
  expect(execute).not.toHaveBeenCalled();
  await recovered.close();
});
