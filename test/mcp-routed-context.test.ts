import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { DaemonCall } from '../src/local/client.js';
import { createPanelServer } from '../src/mcp/panel-server.js';
import { authority, request } from './runtime-fixture.js';

const sessionId = '01a2090e-4f83-7a73-8500-f87c808e0e85';
const otherId = '01a3090e-4f83-7a73-8500-f87c808e0e85';
const routed = { thread_id: sessionId, threadId: sessionId };
async function connected() {
  const runtime = vi.fn<DaemonCall>(async () => ({ state: 'running', runs: [], cursor: 0 }));
  const server = createPanelServer(
    async () => ({ ...authority.context, sessionId }),
    await mkdtemp(join(tmpdir(), 'ultra-routing-')),
    async () => '<main/>',
    runtime,
  );
  const client = new Client({ name: 'routing-tests', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  const open = await client.callTool({ name: 'ultra_panel', arguments: {} });
  const nonce = z.object({ bindingNonce: z.string() }).parse(open.structuredContent).bindingNonce;
  runtime.mockClear();
  return {
    client,
    runtime,
    nonce,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}
function operations(nonce: string) {
  return [
    { name: 'ultra_panel', arguments: { contextKey: 'current' } },
    { name: 'ultra_panel_bind', arguments: { contextKey: 'current', nonce } },
    { name: 'ultra_context', arguments: { contextKey: 'current' } },
    {
      name: 'ultra_start',
      arguments: { ...request(), contextKey: 'current', capacity: authority.capacity },
    },
    { name: 'ultra_status', arguments: { contextKey: 'current' } },
    { name: 'ultra_result', arguments: { contextKey: 'current', runId: 'run' } },
    { name: 'ultra_wait', arguments: { contextKey: 'current', afterCursor: 0, timeoutMs: 0 } },
    { name: 'ultra_control', arguments: { contextKey: 'current', runId: 'run', action: 'pause' } },
    { name: 'ultra_handoff', arguments: { contextKey: 'current', id: 'handoff', action: 'claim' } },
  ];
}

it.each([
  {},
  { thread_id: sessionId },
  { thread_id: sessionId, threadId: otherId },
  { thread_id: 'not-a-uuid', threadId: 'not-a-uuid' },
  { thread_id: otherId, threadId: otherId },
])(
  'rejects supplied unknown, conflicting or other-chat metadata across every context path: %j',
  async (_meta) => {
    const f = await connected();
    try {
      for (const operation of operations(f.nonce)) {
        const result = await f.client.callTool({ ...operation, _meta });
        expect(result.isError, operation.name).toBe(true);
      }
      expect(f.runtime).not.toHaveBeenCalled();
    } finally {
      await f.close();
    }
  },
);

it.each([undefined, routed])(
  'accepts explicit handles with absent or matching route metadata: %j',
  async (_meta) => {
    const f = await connected();
    try {
      for (const operation of operations(f.nonce)) {
        const result = await f.client.callTool({ ...operation, ...(_meta ? { _meta } : {}) });
        expect(result.isError, operation.name).not.toBe(true);
      }
      expect(f.runtime.mock.calls.map(([method]) => method)).toEqual(
        expect.arrayContaining(['start', 'status', 'result', 'wait', 'control', 'handoff']),
      );
    } finally {
      await f.close();
    }
  },
);

it('checks routed identity on an already-bound nonce without changing app nonce access', async () => {
  const f = await connected();
  try {
    await f.client.callTool({
      name: 'ultra_panel_bind',
      arguments: { contextKey: 'current', nonce: f.nonce },
      _meta: routed,
    });
    const rejected = await f.client.callTool({
      name: 'ultra_panel_bind',
      arguments: { contextKey: 'current', nonce: f.nonce },
      _meta: { threadId: otherId, thread_id: otherId },
    });
    expect(rejected.isError).toBe(true);
    expect(
      (await f.client.callTool({ name: 'ultra_status', arguments: { nonce: f.nonce } })).isError,
    ).not.toBe(true);
    expect(
      (
        await f.client.callTool({
          name: 'ultra_panel_control',
          arguments: { nonce: f.nonce, runId: 'run', action: 'pause' },
        })
      ).isError,
    ).not.toBe(true);
  } finally {
    await f.close();
  }
});
