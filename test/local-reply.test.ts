import { join } from 'node:path';
import { expect, it } from 'vitest';
import { ReplyReader } from '../src/local/reply.js';
import { serveDaemon } from '../src/daemon.js';
import { createDaemonClient } from '../src/local/client.js';
import { WorkflowEngine } from '../src/runtime/engine.js';
import { localFixture } from './local-runtime-fixture.js';
import { output, request, until } from './runtime-fixture.js';

it('reads a multi-MiB workflow and selected result without losing values or evidence', async () => {
  const f = localFixture();
  const value = 'x'.repeat(262_000) + 'résultat 🌐\\"\n';
  const daemon = await serveDaemon(
    f.dataDir,
    () =>
      new WorkflowEngine({
        dataDir: join(f.dataDir, 'runtime'),
        executeWorker: async () =>
          output(value, {
            evidence: [{ id: 'source', description: 'Saved source evidence' }],
          }),
      }),
  );
  const call = createDaemonClient(f.dataDir);
  try {
    daemon.engine.start(
      request(
        'const p=phase("Read"); await parallel(Array.from({length:4}, () => () => agent({...args.spec,phase:p}))); return null;',
      ),
      f.grant,
    );
    await until(() =>
      ['completed', 'failed'].includes(daemon.engine.status(f.owner)[0]?.state ?? ''),
    );
    const expected = daemon.engine.status(f.owner);
    expect(expected[0]?.state, expected[0]?.error ?? '').toBe('completed');
    expect(Buffer.byteLength(JSON.stringify(expected))).toBeGreaterThan(1_048_576);
    const snapshot = await call('status', { owner: f.owner });
    expect(snapshot).toEqual({ runs: expected, cursor: daemon.engine.currentCursor(f.owner) });
    expect(await call('result', { owner: f.owner, runId: expected[0]!.id })).toEqual(expected[0]);
    expect(
      await call('control', { owner: f.owner, runId: expected[0]!.id, action: 'pause' }),
    ).toMatchObject({ id: expected[0]!.id, state: 'completed' });
    expect(
      await call('result', {
        owner: f.owner,
        runId: expected[0]!.id,
        taskId: expected[0]!.tasks[0]!.id,
      }),
    ).toEqual(expected[0]!.tasks[0]!.result);
    expect(await call('status', { owner: { ...f.owner, sessionId: 'another' } })).toEqual({
      runs: [],
      cursor: 0,
    });
    expect(daemon.engine.status(f.owner)[0]?.tasks).toEqual(expected[0]!.tasks);
  } finally {
    await daemon.engine.close();
    await daemon.close();
  }
});

const line = (value: unknown) => `${JSON.stringify(value)}\n`;
const page = (index = 0, bytes = 100, data = 'data') => ({
  id: 'id',
  page: { index, bytes, data },
});

it('assembles coalesced and fragmented pages without treating an early page as success', () => {
  const data = JSON.stringify({ id: 'id', result: { value: 'é🌐' } });
  const bytes = Buffer.byteLength(data);
  const reader = new ReplyReader('id');
  const first = line(page(0, bytes, data.slice(0, 10)));
  expect(reader.accept(first.slice(0, 8))).toBeNull();
  expect(reader.accept(first.slice(8))).toBeNull();
  expect(
    reader.accept(line(page(1, bytes, data.slice(10))) + line({ id: 'id', end: true })),
  ).toEqual({ result: { value: 'é🌐' } });
});

it.each([
  page(1),
  page(0, 0),
  page(0, 67_108_865),
  page(0, 1),
  page(0, 100, ''),
  { id: 'foreign', result: 1 },
  { id: 'id' },
  { id: 'id', page: null },
])('rejects malformed or unbounded read pages: %j', (frame) => {
  expect(() => new ReplyReader('id').accept(line(frame))).toThrow();
});

it('rejects inconsistent or incomplete page sequences', () => {
  for (const next of [page(0), page(1, 99), { id: 'id', result: 1 }, { id: 'id', end: true }]) {
    const reader = new ReplyReader('id');
    reader.accept(line(page()));
    expect(() => reader.accept(line(next))).toThrow();
  }
});
