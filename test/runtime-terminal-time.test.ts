import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { WorkflowEngine } from '../src/runtime/engine.js';
import type { RunRecord } from '../src/runtime/types.js';
import { afterEach, expect, it, vi } from 'vitest';
import { authority, harness, output, owner, request, until } from './runtime-fixture.js';
import { receipt } from './runtime-reconciliation-fixture.js';

const lead = `const p=phase('Verify'); return await lead({phase:p,
  objective:'Inspect result',resources:[],evidence:[]});`;
afterEach(() => vi.restoreAllMocks());

it('timestamps cancellation before worker dispatch and preserves it on repeated controls', async () => {
  const { engine, calls } = harness();
  const run = engine.start(request(lead), authority);
  await until(() => engine.status(owner)[0]!.handoffs.length === 1);
  const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
  expect(engine.control(owner, run.id, 'cancel')).toMatchObject({
    state: 'cancelled',
    finishedAt: 1000,
  });
  clock.mockReturnValue(2000);
  expect(engine.control(owner, run.id, 'cancel').finishedAt).toBe(1000);
  expect(engine.control(owner, run.id, 'resume').finishedAt).toBe(1000);
  expect(calls).toHaveLength(0);
  await engine.close();
});

it('timestamps script failure and budget stop independently from worker completion', async () => {
  const { engine, calls } = harness();
  const failed = engine.start(request(`throw new Error('script failed');`), authority);
  await until(() => engine.status(owner)[0]!.state === 'failed');
  const finished = engine.status(owner)[0]!.finishedAt;
  expect(finished).not.toBeNull();
  expect(engine.control(owner, failed.id, 'cancel').finishedAt).toBe(finished);
  engine.start(
    request(
      `const p=phase('Discover'); await agent({...args.spec,phase:p});
    return await agent({...args.spec,phase:p});`,
      { requestId: 'budget', budget: { maxObservedTokens: 1 } },
    ),
    authority,
  );
  await until(() => calls.length === 1);
  calls[0]!.finish(
    output(null, {
      usage: {
        inputTokens: 1,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
        totalTokens: 1,
      },
    }),
  );
  await until(() => engine.status(owner)[1]!.state === 'failed');
  expect(engine.status(owner)[1]!.finishedAt).not.toBeNull();
  expect(engine.status(owner)[1]!.error).toContain('budget');
  expect(calls).toHaveLength(1);
  await engine.close();
});

it('keeps interrupted lead reconciliation untimed until its explicit final readback', async () => {
  const { engine } = harness();
  const run = engine.start(request(lead), authority);
  await until(() => engine.status(owner)[0]!.handoffs.length === 1);
  const id = engine.status(owner)[0]!.handoffs[0]!.id;
  engine.handoff(owner, id, 'claim', authority.context);
  expect(engine.control(owner, run.id, 'cancel')).toMatchObject({
    state: 'needs_reconciliation',
    finishedAt: null,
  });
  const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
  engine.handoff(owner, id, 'resolve', authority.context, {
    acceptance: 'incomplete',
    value: null,
    evidence: [],
  });
  expect(engine.status(owner)[0]).toMatchObject({ state: 'cancelled', finishedAt: 1000 });
  clock.mockReturnValue(2000);
  engine.handoff(owner, id, 'resolve', authority.context, {
    acceptance: 'incomplete',
    value: null,
    evidence: [],
  });
  expect(engine.status(owner)[0]!.finishedAt).toBe(1000);
  await engine.close();
});

it('clears terminal workflow time when a draining worker becomes uncertain and records readback closure', async () => {
  const { engine, calls } = harness();
  const run = engine.start(
    request(`const p=phase('Discover');
    agent({...args.spec,phase:p}); await agent({...args.spec,phase:p}); return 'script done';`),
    authority,
  );
  await until(() => calls.length === 2);
  calls[1]!.finish(output());
  await until(() => engine.status(owner)[0]!.state === 'completed');
  expect(engine.status(owner)[0]!.finishedAt).not.toBeNull();
  expect(engine.status(owner)[0]!.tasks[0]!.finishedAt).toBeNull();
  calls[0]!.finish(output(null, { execution: 'uncertain' }));
  await until(() => engine.status(owner)[0]!.state === 'needs_reconciliation');
  expect(engine.status(owner)[0]!.finishedAt).toBeNull();
  expect(engine.status(owner)[0]!.tasks[0]!.finishedAt).not.toBeNull();
  engine.control(owner, run.id, 'cancel');
  expect(engine.status(owner)[0]!.finishedAt).toBeNull();
  const id = engine.status(owner)[0]!.handoffs[0]!.id;
  engine.handoff(owner, id, 'claim', authority.context);
  engine.handoff(owner, id, 'resolve', authority.context, receipt);
  expect(engine.status(owner)[0]).toMatchObject({
    state: 'cancelled',
    acceptanceOutcome: 'incomplete',
  });
  expect(engine.status(owner)[0]!.finishedAt).not.toBeNull();
  await engine.close();
});

it('preserves a historical terminal readback record whose finish time is unknown', async () => {
  const { engine, calls, dataDir, execute } = harness();
  const run = engine.start(
    request(`const p=phase('Discover');return await agent({...args.spec,phase:p});`),
    authority,
  );
  await until(() => calls.length === 1);
  calls[0]!.finish(output(null, { execution: 'uncertain' }));
  await until(() => engine.status(owner)[0]!.handoffs.length === 1);
  const id = engine.status(owner)[0]!.handoffs[0]!.id;
  engine.handoff(owner, id, 'claim', authority.context);
  engine.handoff(owner, id, 'resolve', authority.context, receipt);
  await engine.close();
  const db = new DatabaseSync(join(dataDir, 'workflow.sqlite'));
  const row = db.prepare('SELECT record FROM runs WHERE id=?').get(run.id)!;
  const record = JSON.parse(String(row.record)) as RunRecord;
  record.snapshot.finishedAt = null;
  db.prepare('UPDATE runs SET record=? WHERE id=?').run(JSON.stringify(record), run.id);
  db.close();
  const recovered = new WorkflowEngine({ dataDir, executeWorker: execute });
  expect(recovered.status(owner)[0]).toMatchObject({ state: 'failed', finishedAt: null });
  expect(recovered.control(owner, run.id, 'cancel').finishedAt).toBeNull();
  expect(calls).toHaveLength(1);
  await recovered.close();
});
