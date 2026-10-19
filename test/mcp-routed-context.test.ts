import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { DaemonCall } from '../src/local/client.js';
import { createPanelServer } from '../src/mcp/panel-server.js';
import { assertRoutedContext } from '../src/mcp/panel-owner.js';
import { authority, request } from './runtime-fixture.js';
import packageMetadata from '../package.json';

const sessionId = '01a2090e-4f83-7a73-8500-f87c808e0e85';
const otherId = '01a3090e-4f83-7a73-8500-f87c808e0e85';
const routed = { thread_id: sessionId, threadId: sessionId };
async function connected() {
  const runtime = vi.fn<DaemonCall>(async (method) => {
    if (method === 'health') return { version: packageMetadata.version };
    if (method === 'capabilities')
      return {
        status: 'verified-metadata',
        models: [{ model: authority.context.model, reasoningEfforts: [authority.context.effort] }],
      };
    return { state: 'running', runs: [], cursor: 0 };
  });
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
  const old = request();
  delete old.authorityRef;
  delete old.maxAgentCalls;
  return [
    { name: 'ultra_panel', arguments: { contextKey: 'current' } },
    { name: 'ultra_panel_bind', arguments: { contextKey: 'current', nonce } },
    { name: 'ultra_context', arguments: { contextKey: 'current' } },
    {
      name: 'ultra_start',
      arguments: { ...old, contractVersion: 2, contextKey: 'current' },
    },
    { name: 'ultra_status', arguments: { contextKey: 'current' } },
    { name: 'ultra_result', arguments: { contextKey: 'current', runId: 'run' } },
    { name: 'ultra_wait', arguments: { contextKey: 'current', afterCursor: 0, timeoutMs: 0 } },
    { name: 'ultra_control', arguments: { contextKey: 'current', runId: 'run', action: 'pause' } },
    { name: 'ultra_handoff', arguments: { contextKey: 'current', id: 'handoff', action: 'claim' } },
  ];
}

it.each([
  { thread_id: otherId },
  { threadId: otherId },
  { thread_id: null },
  { threadId: 7 },
  { thread_id: null, threadId: sessionId },
  { thread_id: sessionId, threadId: 7 },
  { thread_id: sessionId, threadId: otherId },
  { thread_id: otherId, threadId: sessionId },
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

it.each([
  undefined,
  {},
  { progressToken: 7 },
  { extension: 'private-value' },
  { thread_id: sessionId },
  { threadId: sessionId },
  routed,
])('accepts exact handles with generic metadata or matching routed identity: %j', async (_meta) => {
  const f = await connected();
  try {
    for (const operation of operations(f.nonce)) {
      const result = await f.client.callTool({ ...operation, ...(_meta ? { _meta } : {}) });
      expect(result.isError, operation.name).not.toBe(true);
    }
    const context = await f.client.callTool({
      name: 'ultra_context',
      arguments: { contextKey: 'current' },
      ...(_meta ? { _meta } : {}),
    });
    expect(JSON.stringify(context)).not.toContain('private-value');
    expect(f.runtime.mock.calls.map(([method]) => method)).toEqual(
      expect.arrayContaining(['start', 'status', 'result', 'wait', 'control', 'handoff']),
    );
  } finally {
    await f.close();
  }
});

it('checks routed identity on an already-bound nonce without changing app nonce access', async () => {
  const f = await connected();
  try {
    await f.client.callTool({
      name: 'ultra_panel_bind',
      arguments: { contextKey: 'current', nonce: f.nonce },
      _meta: routed,
    });
    const repeated = await f.client.callTool({
      name: 'ultra_panel_bind',
      arguments: { contextKey: 'current', nonce: f.nonce },
      _meta: { progressToken: 9 },
    });
    expect(repeated.isError).not.toBe(true);
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

it('accepts progress metadata generated by the actual MCP SDK', async () => {
  const f = await connected();
  try {
    for (const operation of operations(f.nonce)) {
      const result = await f.client.callTool(operation, undefined, { onprogress: () => {} });
      expect(result.isError, operation.name).not.toBe(true);
      if (operation.name === 'ultra_context')
        expect(result.structuredContent).toHaveProperty('requestMetadataKind', 'generic');
    }
  } finally {
    await f.close();
  }
});

it.each([null, [], 7, 'invalid metadata'])(
  'rejects malformed metadata containers at the shared boundary: %j',
  (metadata) => {
    expect(() => assertRoutedContext(metadata, sessionId)).toThrow(
      'Routed chat identity is missing, invalid, or conflicting',
    );
  },
);

it('reports only routing field names and validation codes on malformed identity', () => {
  expect(() => assertRoutedContext({ thread_id: null, threadId: sessionId }, sessionId)).toThrow(
    'thread_id:invalid_type',
  );
  try {
    assertRoutedContext({ thread_id: 'private-identity', threadId: otherId }, sessionId);
    throw new Error('Expected malformed routing to fail');
  } catch (error) {
    expect(String(error)).toContain('thread_id:invalid_format');
    expect(String(error)).not.toContain('private-identity');
    expect(String(error)).not.toContain(otherId);
  }
});

it('rejects a supplied route with no defined identity', () => {
  expect(() => assertRoutedContext({ threadId: undefined }, sessionId)).toThrow(
    'Routed chat identity is missing, invalid, or conflicting (aliases:custom)',
  );
});
