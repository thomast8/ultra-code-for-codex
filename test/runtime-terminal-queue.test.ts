import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { WorkflowEngine } from '../src/runtime/engine.js';
import { expect, it } from 'vitest';
import { authority, harness, output, owner, request, until } from './runtime-fixture.js';

it('settles queued workers after a script fails before dispatch', async () => {
  const { engine, calls } = harness();
  engine.start(
    request(`const p=phase('Discover');agent({...args.spec,phase:p});
    agent({...args.spec,phase:p});throw new Error('Script failed');`),
    authority,
  );
  await until(() => engine.status(owner)[0]?.state === 'failed');
  const run = engine.status(owner)[0]!;
  expect(calls).toHaveLength(0);
  expect(run.tasks.map((task) => task.state)).toEqual(['cancelled', 'cancelled']);
  expect(run.tasks.every((task) => task.result?.execution === 'interrupted')).toBe(true);
  expect(engine.control(owner, run.id, 'cancel').state).toBe('failed');
  await engine.close();
});

it('settles all queued calls on budget exhaustion and leaves other workflows runnable', async () => {
  const { engine, calls } = harness();
  const grant = { ...authority, capacity: { ...authority.capacity, totalSlots: 2 } };
  engine.start(
    request(
      `const p=phase('Discover');return await parallel([0,1,2].map(n=>
    ()=>agent({...args.spec,phase:p,title:String(n)})));`,
      { budget: { maxObservedTokens: 1 } },
    ),
    grant,
  );
  await until(() => calls.length === 1);
  calls[0]!.finish(
    output(1, {
      usage: {
        inputTokens: 1,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
        totalTokens: 1,
      },
    }),
  );
  await until(() => engine.status(owner)[0]?.state === 'failed');
  expect(calls).toHaveLength(1);
  expect(engine.status(owner)[0]!.tasks.map((task) => task.state)).toEqual([
    'completed',
    'cancelled',
    'cancelled',
  ]);
  engine.start(request('return 9;', { requestId: 'other' }), grant);
  await until(() => engine.status(owner)[1]?.state === 'completed');
  await engine.close();
});

it('settles workers queued by a script that returns without awaiting them', async () => {
  const { engine, calls } = harness();
  engine.start(
    request(`const p=phase('Discover');agent({...args.spec,phase:p});return 1;`),
    authority,
  );
  await until(() => engine.status(owner)[0]?.state === 'completed');
  expect(calls).toHaveLength(0);
  expect(engine.status(owner)[0]?.tasks[0]?.state).toBe('cancelled');
  expect(engine.status(owner)[0]?.accountingComplete).toBe(true);
  expect(engine.status(owner)[0]?.usage?.totalTokens).toBe(0);
  await engine.close();
});

it('settles legacy terminal queued tasks on recovery without redispatch', async () => {
  const { engine, calls, dataDir } = harness();
  const original = engine.start(
    request(`const p=phase('Discover');await agent({...args.spec,phase:p});`),
    authority,
  );
  engine.control(owner, original.id, 'pause');
  await until(() => engine.status(owner)[0]?.tasks.length === 1);
  await engine.close();
  const db = new DatabaseSync(join(dataDir, 'workflow.sqlite'));
  const row = db.prepare('SELECT id,record FROM runs').get()!;
  const record = JSON.parse(String(row.record));
  record.snapshot.state = 'failed';
  db.prepare('UPDATE runs SET record=? WHERE id=?').run(JSON.stringify(record), row.id!);
  db.close();
  let dispatched = 0;
  const recovered = new WorkflowEngine({
    dataDir,
    executeWorker: async () => {
      dispatched++;
      return output();
    },
  });
  expect(recovered.status(owner)[0]?.tasks[0]?.state).toBe('cancelled');
  expect(recovered.status(owner)[0]?.tasks[0]?.usage?.totalTokens).toBe(0);
  expect(calls).toHaveLength(0);
  expect(dispatched).toBe(0);
  await recovered.close();
});

it('settles queued agents immediately when uncertain-worker readback closes the run', async () => {
  const { engine, calls } = harness();
  const grant = { ...authority, capacity: { ...authority.capacity, totalSlots: 2 } };
  engine.start(
    request(`const p=phase('Discover');return await parallel([0,1,2].map(n=>
    ()=>agent({...args.spec,phase:p,title:String(n)})));`),
    grant,
  );
  await until(() => calls.length === 1);
  calls[0]!.finish(output(null, { execution: 'uncertain' }));
  await until(() => engine.status(owner)[0]?.state === 'needs_reconciliation');
  const id = engine.status(owner)[0]!.handoffs[0]!.id;
  engine.handoff(owner, id, 'claim', authority.context);
  engine.handoff(owner, id, 'resolve', authority.context, {
    acceptance: 'incomplete',
    value: { terminationConfirmed: true, writesReconciled: true },
    evidence: [
      {
        id: 'fixture-readback',
        description: 'Controlled worker ended; no filesystem writes were issued',
      },
    ],
  });
  expect(engine.status(owner)[0]?.state).toBe('failed');
  expect(engine.status(owner)[0]?.tasks.map((task) => task.state)).toEqual([
    'failed',
    'cancelled',
    'cancelled',
  ]);
  expect(calls).toHaveLength(1);
  await engine.close();
});
