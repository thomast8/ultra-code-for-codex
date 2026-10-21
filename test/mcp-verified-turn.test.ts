import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { registerContext, resolveCurrentContext } from '../src/activation/registry.js';
import type { DaemonCall } from '../src/local/client.js';
import { createPanelServer } from '../src/mcp/panel-server.js';
import {
  compatibilityRows,
  fixtureInput,
  serializeRows,
} from './activation-compatibility-fixture.js';
import packageMetadata from '../package.json';

const metadata = { thread_id: fixtureInput.session_id, threadId: fixtureInput.session_id };
async function fixture() {
  const profile = await realpath(await mkdtemp(join(tmpdir(), 'ultra-verified-turn-')));
  const dataDir = join(profile, 'plugins', 'data', 'ultra-code');
  await mkdir(join(profile, 'sessions'));
  const input = {
    ...fixtureInput,
    cwd: profile,
    transcript_path: join(profile, 'sessions', 'turn.jsonl'),
  };
  const rows = compatibilityRows();
  const turn = {
    ...rows.turn,
    payload: {
      ...rows.turn.payload,
      cwd: profile,
      file_system_sandbox_policy: {
        kind: 'restricted',
        entries: [{ path: { type: 'special', value: { kind: 'root' } }, access: 'read' }],
      },
    },
  };
  const register = async (turnId = input.turn_id) => {
    turn.payload.turn_id = turnId;
    await writeFile(input.transcript_path, serializeRows(rows.session, turn));
    return registerContext({ ...input, turn_id: turnId }, dataDir);
  };
  const first = await register();
  const runtime = vi.fn<DaemonCall>(async (method) => {
    if (method === 'health') return { version: packageMetadata.version };
    if (method === 'capabilities')
      return {
        status: 'verified-metadata',
        models: [{ model: 'gpt-6-astra', reasoningEfforts: ['ultra'] }],
      };
    return { id: 'run', state: 'running', runs: [], cursor: 0 };
  });
  const connect = async () => {
    const server = createPanelServer(
      resolveCurrentContext,
      dataDir,
      async () => '<main/>',
      runtime,
    );
    const client = new Client({ name: 'verified-turn', version: '1' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    return { client, close: () => Promise.all([client.close(), server.close()]) };
  };
  return { first, register, connect, runtime };
}

const operations = [
  { name: 'ultra_status', arguments: {} },
  {
    name: 'ultra_start',
    arguments: {
      requestId: 'trial',
      title: 'Review',
      objective: 'Check source',
      acceptance: ['Evidence'],
      script: 'return 7;',
    },
  },
  { name: 'ultra_wait', arguments: { afterCursor: 0, timeoutMs: 0 } },
  { name: 'ultra_result', arguments: { runId: 'run' } },
  { name: 'ultra_inspect', arguments: { runId: 'run', taskId: 'task' } },
  { name: 'ultra_continue', arguments: { runId: 'run', taskId: 'task', prompt: 'Explain' } },
  { name: 'ultra_control', arguments: { runId: 'run', action: 'pause' } },
  { name: 'ultra_handoff', arguments: { id: 'handoff', action: 'claim' } },
];

it('requires verification once, then retains the exact turn across workflow calls and reconnects', async () => {
  const f = await fixture();
  let c = await f.connect();
  try {
    expect(
      (await c.client.callTool({ name: 'ultra_status', arguments: {}, _meta: metadata })).isError,
    ).toBe(true);
    expect(f.runtime).not.toHaveBeenCalled();
    const verified = await c.client.callTool({
      name: 'ultra_context',
      arguments: f.first,
      _meta: metadata,
    });
    expect(verified.structuredContent).toMatchObject({ workflowContextBound: true });
    await c.close();
    c = await f.connect();
    for (const operation of operations) {
      expect(
        (await c.client.callTool({ ...operation, _meta: metadata })).isError,
        operation.name,
      ).not.toBe(true);
    }
    expect(f.runtime.mock.calls.find(([method]) => method === 'start')?.[1]).toMatchObject({
      request: { contextKey: f.first.contextKey },
      authority: { context: { sessionId: fixtureInput.session_id, turnId: fixtureInput.turn_id } },
    });
  } finally {
    await c.close();
  }
});

it('does not promote a verified old turn when a new turn is registered', async () => {
  const f = await fixture();
  const c = await f.connect();
  try {
    await c.client.callTool({ name: 'ultra_context', arguments: f.first, _meta: metadata });
    const next = await f.register('01a2090e-4f83-7a73-8500-f87c808e0e86');
    f.runtime.mockClear();
    expect(
      (await c.client.callTool({ name: 'ultra_status', arguments: {}, _meta: metadata })).isError,
    ).toBe(true);
    expect(f.runtime).not.toHaveBeenCalled();
    await c.client.callTool({ name: 'ultra_context', arguments: next, _meta: metadata });
    expect(
      (await c.client.callTool({ name: 'ultra_status', arguments: {}, _meta: metadata })).isError,
    ).not.toBe(true);
  } finally {
    await c.close();
  }
});

it('does not correct explicit wrong keys or share verification with generic or other-chat callers', async () => {
  const f = await fixture();
  const c = await f.connect();
  try {
    await c.client.callTool({ name: 'ultra_context', arguments: f.first, _meta: metadata });
    f.runtime.mockClear();
    expect(
      (
        await c.client.callTool({
          name: 'ultra_status',
          arguments: { contextKey: 'wrong-key' },
          _meta: metadata,
        })
      ).isError,
    ).toBe(true);
    for (const _meta of [
      {},
      { thread_id: '01a3090e-4f83-7a73-8500-f87c808e0e85' },
      { ...metadata, threadId: 'bad' },
    ]) {
      expect(
        (await c.client.callTool({ name: 'ultra_status', arguments: {}, _meta })).isError,
      ).toBe(true);
    }
    expect(f.runtime).not.toHaveBeenCalled();
  } finally {
    await c.close();
  }
});
