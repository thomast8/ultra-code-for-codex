import { expect, it } from 'vitest';
import { workerHarness, workerSpec } from './codex-worker-fixture.js';

it('records bounded sanitized command, output, error, and file-change lifecycles', async () => {
  const h = workerHarness();
  h.backend.execute = async () => {
    await h.backend.emit('item/started', {
      turnId: 'owned-turn',
      item: {
        type: 'commandExecution',
        status: 'inProgress',
        command: 'secret command',
        exitCode: null,
        aggregatedOutput: null,
      },
    });
    await h.backend.emit('item/completed', {
      turnId: 'owned-turn',
      item: {
        type: 'commandExecution',
        status: 'failed',
        command: 'secret command',
        exitCode: 1,
        aggregatedOutput: 'Permission denied: secret output',
      },
    });
    await h.backend.emit('item/completed', {
      turnId: 'owned-turn',
      item: { type: 'fileChange', status: 'completed', changes: [{ path: 'secret file' }] },
    });
    await h.backend.emit('error', { turnId: 'owned-turn', error: { message: 'secret error' } });
    await h.backend.finish();
  };
  expect(await h.execute(workerSpec(), h.options)).toMatchObject({ acceptance: 'satisfied' });
  const activity = h.events.filter((event) => event.type === 'activity');
  expect(JSON.stringify(activity)).not.toContain('secret');
  expect(activity).toContainEqual({
    type: 'activity',
    message: 'Command completed; status=failed; exit=1; outputBytes=32; denied=true',
  });
  expect(activity).toContainEqual({ type: 'activity', message: 'File change completed; paths=1' });
});

it('caps repetitive activity records', async () => {
  const h = workerHarness();
  h.backend.execute = async () => {
    for (let index = 0; index < 250; index += 1)
      await h.backend.emit('error', { turnId: 'owned-turn', error: { message: 'private' } });
    await h.backend.finish();
  };
  expect(await h.execute(workerSpec(), h.options)).toMatchObject({ acceptance: 'satisfied' });
  expect(h.events.filter((event) => event.type === 'activity')).toHaveLength(200);
});

it.each([
  ['thread/tokenUsage/updated', { tokenUsage: { total: { totalTokens: -1 } } }],
  ['item/completed', { item: { type: 'commandExecution', status: 'secret-status', exitCode: 1 } }],
])('fails closed on malformed lifecycle metadata %s', async (method, params) => {
  const h = workerHarness();
  h.backend.execute = async () => {
    await h.backend.emit(method, { turnId: 'owned-turn', ...params });
  };
  const result = await h.execute(workerSpec(), h.options);
  expect(result).toMatchObject({
    execution: 'uncertain',
    acceptance: 'unverified',
    error: expect.stringContaining('validation failed'),
  });
  expect(JSON.stringify(h.events)).not.toContain('secret-status');
});
