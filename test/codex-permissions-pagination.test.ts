import { describe, expect, it } from 'vitest';
import { verifyReadOnlyWorker } from '../src/codex/permissions.js';
import {
  expectedWorker,
  featurePage,
  permissionTransport,
  workerThread,
} from './codex-permissions-fixture.js';

it('follows effective thread inventories to their final pages', async () => {
  let featureIndex = 0;
  let mcpIndex = 0;
  const features = featurePage().data;
  const { transport, calls } = permissionTransport({
    'experimentalFeature/list': () => {
      featureIndex += 1;
      return featureIndex === 1
        ? { data: features.slice(0, 10), nextCursor: 'feature-next' }
        : { data: features.slice(10), nextCursor: null };
    },
    'mcpServerStatus/list': () => {
      mcpIndex += 1;
      return { data: [], nextCursor: mcpIndex === 1 ? 'mcp-next' : null };
    },
  });
  await expect(
    verifyReadOnlyWorker(transport, workerThread(), expectedWorker),
  ).resolves.toMatchObject({ disabledFeatureCount: 23 });
  expect(
    calls.filter(({ method }) => method === 'experimentalFeature/list').map(({ params }) => params),
  ).toEqual([
    { threadId: 'worker-thread', cursor: null, limit: 100 },
    { threadId: 'worker-thread', cursor: 'feature-next', limit: 100 },
  ]);
  expect(
    calls.filter(({ method }) => method === 'mcpServerStatus/list').map(({ params }) => params),
  ).toEqual([
    { threadId: 'worker-thread', detail: 'full', cursor: null, limit: 100 },
    { threadId: 'worker-thread', detail: 'full', cursor: 'mcp-next', limit: 100 },
  ]);
});

describe.each(['experimentalFeature/list', 'mcpServerStatus/list'])('%s pagination', (method) => {
  it('blocks cursor cycles', async () => {
    const { transport } = permissionTransport({ [method]: { data: [], nextCursor: 'same' } });
    await expect(verifyReadOnlyWorker(transport, workerThread(), expectedWorker)).rejects.toThrow(
      'pagination cursor repeated',
    );
  });

  it.each([undefined, '', 123])(
    'requires an explicit valid next cursor: %s',
    async (nextCursor) => {
      const { transport } = permissionTransport({ [method]: { data: [], nextCursor } });
      await expect(verifyReadOnlyWorker(transport, workerThread(), expectedWorker)).rejects.toThrow(
        'pagination state is unavailable',
      );
    },
  );

  it('bounds unlimited distinct cursor pages', async () => {
    let index = 0;
    const { transport, calls } = permissionTransport({
      [method]: () => {
        index += 1;
        return { data: [], nextCursor: `next-${index}` };
      },
    });
    await expect(verifyReadOnlyWorker(transport, workerThread(), expectedWorker)).rejects.toThrow(
      'pagination exceeds the verification bound',
    );
    expect(calls.filter((call) => call.method === method)).toHaveLength(100);
  });

  it('bounds total inventory rows even if the server ignores the page limit', async () => {
    const { transport } = permissionTransport({
      [method]: { data: Array.from({ length: 10_001 }, () => ({})), nextCursor: null },
    });
    await expect(verifyReadOnlyWorker(transport, workerThread(), expectedWorker)).rejects.toThrow(
      'inventory exceeds the verification bound',
    );
  });
});
