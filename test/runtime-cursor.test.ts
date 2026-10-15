import { expect, it } from 'vitest';
import { WorkflowEngine } from '../src/runtime/engine.js';
import { Journal } from '../src/runtime/journal.js';
import { createRun } from '../src/runtime/records.js';
import { authority, harness, output, owner, request } from './runtime-fixture.js';

it('returns an owner-scoped current cursor beyond the first page without skipping wait events', async () => {
  const { engine, dataDir } = harness();
  await engine.close();
  const journal = new Journal(dataDir);
  const run = createRun(request(), authority);
  run.snapshot.state = 'completed';
  for (let i = 0; i < 1010; i++) journal.save(run, 'log', String(i));
  const foreign = createRun(request(), {
    ...authority,
    context: { ...authority.context, sessionId: 'foreign' },
  });
  foreign.snapshot.state = 'completed';
  journal.save(foreign, 'private');
  journal.close();
  const reopened = new WorkflowEngine({ dataDir, executeWorker: async () => output() });
  expect(reopened.currentCursor(owner)).toBe(1010);
  const first = reopened.events(owner, 0);
  expect(first.events).toHaveLength(1000);
  expect(first.cursor).toBe(1000);
  const second = reopened.events(owner, first.cursor);
  expect(second.events).toHaveLength(10);
  expect(second.cursor).toBe(1010);
  expect(reopened.events(owner, second.cursor).events).toEqual([]);
  expect(reopened.events(owner, 0, []).events).toEqual([]);
  expect(() => reopened.currentCursor(owner, [foreign.snapshot.id])).toThrow('selected lead');
  await reopened.close();
});
