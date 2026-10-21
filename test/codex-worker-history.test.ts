import { expect, it, vi } from 'vitest';
import { openRestrictedBackend } from '../src/codex/launch-policy.js';
import { readWorkerHistory } from '../src/codex/worker-history.js';
import { WorkerBackend } from './codex-worker-fixture.js';

vi.mock('../src/codex/launch-policy.js', async (original) => ({
  ...(await original<typeof import('../src/codex/launch-policy.js')>()),
  openRestrictedBackend: vi.fn(),
}));

it('starts inspection at the newest events and pages backward with bounded output', async () => {
  const backend = new WorkerBackend();
  vi.mocked(openRestrictedBackend).mockResolvedValue(backend);
  backend.overrides['thread/items/list'] = {
    data: [{ text: 'x'.repeat(40_000) }],
    nextCursor: 'older',
  };
  const page = await readWorkerHistory('/profile', '/workspace', 'owned-thread');
  expect(backend.calls[0]).toEqual({
    method: 'thread/items/list',
    params: { threadId: 'owned-thread', cursor: null, limit: 10, sortDirection: 'desc' },
  });
  expect(page).toMatchObject({
    order: 'newest-first',
    nextCursor: 'older',
    items: [{ truncated: true }],
  });
  expect(page.note).toContain('not a workflow execution or dispatch failure');
  expect(Object.keys(page).indexOf('note')).toBeLessThan(Object.keys(page).indexOf('items'));
  expect(page.items[0]!.preview).toHaveLength(32_768);
  await readWorkerHistory('/profile', '/workspace', 'owned-thread', page.nextCursor!);
  expect(backend.calls[1]!.params).toMatchObject({ cursor: 'older', sortDirection: 'desc' });
  expect(backend.close).toHaveBeenCalledTimes(2);
});

it('closes the restricted history transport on an inspection error', async () => {
  const backend = new WorkerBackend();
  vi.mocked(openRestrictedBackend).mockResolvedValue(backend);
  backend.overrides['thread/items/list'] = () => {
    throw new Error('private backend error');
  };
  await expect(readWorkerHistory('/profile', '/workspace', 'owned-thread')).rejects.toThrow(
    'Worker backend request failed: thread/items/list',
  );
  expect(backend.close).toHaveBeenCalledOnce();
});
