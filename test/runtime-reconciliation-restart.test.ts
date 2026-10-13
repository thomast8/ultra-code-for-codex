import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { WorkflowEngine } from '../src/runtime/engine.js';
import type { RunRecord } from '../src/runtime/types.js';
import { authority, harness, output, owner, request, single, until } from './runtime-fixture.js';
import { receipt } from './runtime-reconciliation-fixture.js';

async function dispatchedCrash() {
  const { engine, calls, dataDir } = harness();
  const run = engine.start(request(single), authority);
  await until(() => calls.length === 1);
  await calls[0]!.options.onEvent({ type: 'turn', threadId: 'saved-thread', turnId: 'saved-turn' });
  await engine.close();
  const db = new DatabaseSync(join(dataDir, 'workflow.sqlite'));
  const row = db.prepare('SELECT record FROM runs WHERE id=?').get(run.id)!;
  const record = JSON.parse(String(row.record)) as RunRecord;
  record.snapshot.state = 'running';
  record.nextSettlement = 1;
  const call = record.calls[1]!;
  call.state = 'dispatched';
  call.result = null;
  call.settlement = null;
  call.task!.state = 'running';
  call.task!.result = null;
  call.task!.finishedAt = null;
  db.prepare('UPDATE runs SET record=? WHERE id=?').run(JSON.stringify(record), run.id);
  db.close();
  return { dataDir, runId: run.id, taskId: call.id };
}

it('creates readback after a dispatched crash and recovers claimed then resolved receipts without rerunning', async () => {
  const { dataDir, runId, taskId } = await dispatchedCrash();
  const execute = vi.fn(async () => output('new linked result'));
  let engine = new WorkflowEngine({ dataDir, executeWorker: execute });
  expect(engine.status(owner)[0]!.handoffs[0]).toMatchObject({ id: taskId, state: 'pending' });
  expect(engine.status(owner)[0]!.tasks[0]!.result).toMatchObject({ execution: 'uncertain' });
  expect(
    engine
      .status(owner)[0]
      ?.handoffs[0]!.spec.evidence.map((item) => item.description)
      .join(' '),
  ).toContain('saved-turn');
  engine.handoff(owner, taskId, 'claim', authority.context);
  await engine.close();
  engine = new WorkflowEngine({ dataDir, executeWorker: execute });
  expect(engine.status(owner)[0]!.handoffs[0]!.state).toBe('needs_reconciliation');
  const current = { ...authority.context, turnId: 'readback-turn' };
  expect(() => engine.handoff(owner, taskId, 'resolve', current, receipt)).toThrow('claimed');
  engine.handoff(owner, taskId, 'claim', current);
  engine.handoff(owner, taskId, 'resolve', current, { ...receipt, acceptance: 'satisfied' });
  expect(engine.status(owner)[0]).toMatchObject({
    state: 'failed',
    acceptanceOutcome: 'incomplete',
  });
  expect(execute).not.toHaveBeenCalled();
  await engine.close();
  engine = new WorkflowEngine({ dataDir, executeWorker: execute });
  expect(engine.status(owner)[0]!.handoffs[0]!.state).toBe('resolved');
  engine.start(
    request(single, { requestId: 'linked', parentRunId: runId, evidenceRefs: receipt.evidence }),
    authority,
  );
  await until(() => execute.mock.calls.length === 1);
  expect(engine.status(owner)[0]!.tasks[0]!.result?.execution).toBe('uncertain');
  await engine.close();
});

it('does not release a quarantined writer when receipt persistence fails', async () => {
  const { engine, calls, dataDir } = harness();
  const script = `const p=phase('Discover');return await agent({...args.spec,phase:p,resources:[{key:'owned',mode:'write'}]});`;
  const old = engine.start(request(script), authority);
  await until(() => calls.length === 1);
  calls[0]!.finish(output(null, { execution: 'uncertain' }));
  await until(() => engine.status(owner)[0]!.handoffs.length === 1);
  const id = engine.status(owner)[0]!.handoffs[0]!.id;
  engine.start(request(script, { requestId: 'linked', parentRunId: old.id }), authority);
  await until(() => engine.status(owner)[1]!.tasks.length === 1);
  engine.handoff(owner, id, 'claim', authority.context);
  const db = new DatabaseSync(join(dataDir, 'workflow.sqlite'));
  db.exec(`CREATE TRIGGER reject_receipt BEFORE UPDATE ON runs
    WHEN json_extract(NEW.record,'$.calls[1].handoff.state')='resolved'
    BEGIN SELECT RAISE(ABORT,'receipt persistence failure'); END`);
  expect(() => engine.handoff(owner, id, 'resolve', authority.context, receipt)).toThrow(
    'persistence failure',
  );
  expect(engine.status(owner)[0]!.handoffs[0]!.state).toBe('claimed');
  expect(engine.status(owner)[0]!.tasks[0]!.state).toBe('needs_reconciliation');
  expect(calls).toHaveLength(1);
  db.exec('DROP TRIGGER reject_receipt');
  db.close();
  engine.handoff(owner, id, 'resolve', authority.context, receipt);
  await until(() => calls.length === 2);
  calls[1]!.finish(output());
  await engine.close();
});

it('keeps cancelled uncertain work cancelled after readback and lets final scripts interrupt remaining workers', async () => {
  const { engine, calls } = harness();
  const old = engine.start(request(single), authority);
  await until(() => calls.length === 1);
  calls[0]!.finish(output(null, { execution: 'uncertain' }));
  await until(() => engine.status(owner)[0]!.handoffs.length === 1);
  const id = engine.status(owner)[0]!.handoffs[0]!.id;
  engine.control(owner, old.id, 'cancel');
  engine.handoff(owner, id, 'claim', authority.context);
  engine.handoff(owner, id, 'resolve', authority.context, receipt);
  expect(engine.status(owner)[0]!.state).toBe('cancelled');
  const active = engine.start(
    request(
      `const p=phase('Discover');
    agent({...args.spec,phase:p,title:'unawaited'});return await agent({...args.spec,phase:p,title:'awaited'});`,
      { requestId: 'active' },
    ),
    authority,
  );
  await until(() => calls.length === 3);
  calls[2]!.finish(output());
  await until(() => engine.status(owner)[1]!.state === 'completed');
  engine.control(owner, active.id, 'cancel');
  expect(calls[1]!.options.signal.aborted).toBe(true);
  await until(() => engine.status(owner)[1]!.tasks[0]!.state === 'cancelled');
  await engine.close();
});

it('finishes mixed worker and lead readback without restarting the old script or retaining its grant', async () => {
  const { engine, calls, dataDir, execute } = harness();
  const script = `const p=phase('Discover');
    await parallel([
      () => agent({...args.spec,phase:p}),
      () => lead({phase:p,objective:'Inspect writes',resources:[],evidence:[]})
    ]);
    return await agent({...args.spec,phase:p,title:'Must not rerun'});`;
  const old = engine.start(request(script), {
    ...authority,
    capacity: { ...authority.capacity, totalSlots: 2 },
  });
  await until(() => calls.length === 1 && engine.status(owner)[0]!.handoffs.length === 1);
  const leadId = engine.status(owner)[0]!.handoffs[0]!.id;
  engine.handoff(owner, leadId, 'claim', authority.context);
  calls[0]!.finish(output(null, { execution: 'uncertain' }));
  await until(() => engine.status(owner)[0]!.handoffs.length === 2);
  await engine.close();
  const recovered = new WorkflowEngine({ dataDir, executeWorker: execute });
  const workerId = recovered.status(owner)[0]!.tasks[0]!.id;
  recovered.handoff(owner, workerId, 'claim', authority.context);
  recovered.handoff(owner, workerId, 'resolve', authority.context, receipt);
  expect(recovered.status(owner)[0]!.state).toBe('needs_reconciliation');
  recovered.handoff(owner, leadId, 'resolve', authority.context, {
    acceptance: 'incomplete',
    value: null,
    evidence: receipt.evidence,
  });
  expect(recovered.status(owner)[0]!.state).toBe('failed');
  expect(calls).toHaveLength(1);
  recovered.start(
    request(
      `const p=phase('Discover');
    return await parallel([() => agent({...args.spec,phase:p}),
      () => agent({...args.spec,phase:p})]);`,
      {
        requestId: 'linked',
        parentRunId: old.id,
      },
    ),
    authority,
  );
  await until(() => calls.length === 3);
  expect(calls.slice(1).map((call) => call.spec.title)).toEqual(['Inspect', 'Inspect']);
  await recovered.close();
});
