import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { WorkflowEngine } from '../src/runtime/engine.js';
import type { RunRecord } from '../src/runtime/types.js';
import { authority, harness, output, owner, request, until } from './runtime-fixture.js';

async function replayFixture(mismatch: boolean) {
  const { engine, calls, dataDir } = harness();
  engine.start(
    request(`const p=phase('Discover');
    const pending=agent({...args.spec,phase:p,title:'queued'});
    await agent({...args.spec,phase:p,title:'saved'}); log('expected'); return await pending;`),
    authority,
  );
  await until(() => calls.length === 2);
  calls[1]!.finish(output('saved result'));
  await until(() => engine.events(owner, 0).events.some((event) => event.type === 'log'));
  await engine.close();
  const db = new DatabaseSync(join(dataDir, 'workflow.sqlite'));
  const row = db.prepare('SELECT id,record FROM runs').get()!;
  const record = JSON.parse(String(row.record)) as RunRecord;
  record.snapshot.state = 'running';
  const queued = record.calls[1]!;
  queued.state = 'queued';
  queued.result = null;
  queued.settlement = null;
  queued.task!.state = 'queued';
  queued.task!.result = null;
  queued.task!.startedAt = null;
  queued.task!.finishedAt = null;
  record.nextSettlement = 2;
  if (mismatch) record.calls[3]!.payload = 'different durable log';
  db.prepare('UPDATE runs SET record=? WHERE id=?').run(JSON.stringify(record), row.id!);
  db.close();
  return dataDir;
}

it('blocks a queued dispatch when a saved parallel result reveals a later replay mismatch', async () => {
  const dataDir = await replayFixture(true);
  const execute = vi.fn(async () => output());
  const recovered = new WorkflowEngine({ dataDir, executeWorker: execute });
  await until(() => recovered.status(owner)[0]?.state === 'needs_reconciliation');
  expect(recovered.status(owner)[0]?.error).toContain('Replay host call');
  expect(execute).not.toHaveBeenCalled();
  await recovered.close();
});

it('releases queued work after the saved parallel continuation matches the entire journal', async () => {
  const dataDir = await replayFixture(false);
  const execute = vi.fn(async () => output('new result'));
  const recovered = new WorkflowEngine({ dataDir, executeWorker: execute });
  await until(() => recovered.status(owner)[0]?.state === 'completed');
  expect(execute).toHaveBeenCalledOnce();
  expect(recovered.status(owner)[0]?.result).toMatchObject({ value: 'new result' });
  await recovered.close();
});
