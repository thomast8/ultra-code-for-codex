import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { WorkflowEngine } from '../src/runtime/engine.js';
import type { RunRecord } from '../src/runtime/types.js';
import { authority, harness, output, owner, request, single, until } from './runtime-fixture.js';

it('saves direct JSON object logs as JSON text', async () => {
  const { engine } = harness();
  try {
    engine.start(request(`log({plan:'inspect', ready:true}); return 'done';`), authority);
    await until(() => engine.status(owner)[0]?.state === 'completed');
    expect(engine.events(owner, 0).events).toContainEqual(
      expect.objectContaining({ type: 'log', data: '{"plan":"inspect","ready":true}' }),
    );
  } finally {
    await engine.close();
  }
});

function alter(dataDir: string, update: (record: RunRecord) => void): void {
  const db = new DatabaseSync(join(dataDir, 'workflow.sqlite'));
  const row = db.prepare('SELECT id,record FROM runs').get()!;
  const record = JSON.parse(String(row.record)) as RunRecord;
  update(record);
  db.prepare('UPDATE runs SET record=? WHERE id=?').run(JSON.stringify(record), row.id!);
  db.close();
}

it('replays saved parallel results in durable settlement order without redispatch', async () => {
  const { engine, calls, dataDir } = harness();
  const run = engine.start(
    request(`const p=phase('Discover'); const order=[];
    await parallel([
      async()=>{await agent({...args.spec,phase:p,title:'a'});order.push('a');log('a');},
      async()=>{await agent({...args.spec,phase:p,title:'b'});order.push('b');log('b');}
    ]); await lead({phase:p,objective:'Inspect',resources:[],evidence:[]}); return order;`),
    authority,
  );
  await until(() => calls.length === 2);
  calls[1]!.finish(output('b'));
  await until(
    () => engine.events(owner, 0).events.filter((event) => event.type === 'log').length === 1,
  );
  calls[0]!.finish(output('a'));
  await until(() => engine.status(owner)[0]?.handoffs.length === 1);
  await engine.close();
  const execute = vi.fn(async () => output());
  const recovered = new WorkflowEngine({ dataDir, executeWorker: execute });
  const handoff = recovered.status(owner)[0]!.handoffs[0]!;
  expect(() => recovered.handoff(owner, handoff.id, 'claim', authority.context)).toThrow(
    'replay is not complete',
  );
  await until(() =>
    recovered.events(owner, 0).events.some((event) => event.type === 'run.replay_ready'),
  );
  recovered.handoff(owner, handoff.id, 'claim', authority.context);
  recovered.handoff(owner, handoff.id, 'resolve', authority.context, {
    acceptance: 'incomplete',
    value: null,
    evidence: [],
  });
  await until(() => recovered.status(owner)[0]?.state === 'completed');
  expect(recovered.status(owner)[0]?.result).toEqual(['b', 'a']);
  expect(recovered.result(owner, run.id)).toMatchObject({ state: 'completed' });
  expect(execute).not.toHaveBeenCalled();
  await recovered.close();
});

it('blocks uncertain dispatch after restart and keeps completed results available', async () => {
  const { engine, calls, dataDir } = harness();
  engine.start(request(single), authority);
  await until(() => calls.length === 1);
  await engine.close();
  alter(dataDir, (record) => {
    record.snapshot.state = 'running';
    const call = record.calls[1]!;
    call.state = 'dispatched';
    call.result = null;
    call.settlement = null;
    call.task!.result = null;
    call.task!.state = 'running';
    record.nextSettlement = 1;
  });
  const execute = vi.fn(async () => output());
  const recovered = new WorkflowEngine({ dataDir, executeWorker: execute });
  expect(recovered.status(owner)[0]?.state).toBe('needs_reconciliation');
  expect(recovered.status(owner)[0]?.tasks[0]?.state).toBe('needs_reconciliation');
  expect(execute).not.toHaveBeenCalled();
  await recovered.close();
});

it('safely dispatches never-dispatched intents and blocks host-call replay mismatch', async () => {
  const { engine, calls, dataDir } = harness();
  engine.start(request(single), authority);
  await until(() => calls.length === 1);
  await engine.close();
  alter(dataDir, (record) => {
    record.snapshot.state = 'running';
    const call = record.calls[1]!;
    call.state = 'queued';
    call.result = null;
    call.settlement = null;
    call.task!.result = null;
    call.task!.state = 'queued';
    record.nextSettlement = 1;
  });
  const execute = vi.fn(async () => output(19));
  const recovered = new WorkflowEngine({ dataDir, executeWorker: execute });
  await until(() => recovered.status(owner)[0]?.state === 'completed');
  expect(execute).toHaveBeenCalledOnce();
  await recovered.close();
  alter(dataDir, (record) => {
    record.snapshot.state = 'running';
    record.calls[0]!.payload = 'Changed';
  });
  const mismatch = new WorkflowEngine({ dataDir, executeWorker: execute });
  await until(() => mismatch.status(owner)[0]?.state === 'needs_reconciliation');
  expect(execute).toHaveBeenCalledOnce();
  await mismatch.close();
});

it('rejects unsupported and corrupt journal records before dispatch', async () => {
  const { engine, dataDir } = harness();
  engine.start(request(), authority);
  await engine.close();
  alter(dataDir, (record) => {
    Object.assign(record, { version: 2 });
  });
  const execute = vi.fn(async () => output());
  expect(() => new WorkflowEngine({ dataDir, executeWorker: execute })).toThrow(
    'Unsupported or corrupt',
  );
  expect(execute).not.toHaveBeenCalled();
});
