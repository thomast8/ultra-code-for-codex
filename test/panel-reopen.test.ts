import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { LeadContext } from '../src/activation/types.js';
import { createPanelServer, type ContextResolver } from '../src/mcp/panel-server.js';

const sessionId = '00000000-0000-7000-8000-000000000001';
const otherSessionId = '00000000-0000-7000-8000-000000000002';
const metadata = { thread_id: sessionId, threadId: sessionId };

function context(instanceId: string): LeadContext {
  return {
    instanceId,
    sessionId,
    turnId: 'old-turn',
    cwd: '/repo',
    model: 'gpt-6.1-sol',
    effort: 'ultra',
    collaborationMode: 'default',
    resolutionStatus: 'verified',
    resolutionReason: 'Exact recorded turn',
  };
}

async function fixture() {
  const profile = await mkdtemp(join(tmpdir(), 'ultra-panel-profile-'));
  return { profile, dataDir: join(profile, 'plugins', 'data', 'ultra-code') };
}

async function connect(dataDir: string, resolver: ContextResolver) {
  const server = createPanelServer(resolver, dataDir, async () => '<main>panel</main>');
  const client = new Client({ name: 'reopen-test', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, close: () => Promise.all([client.close(), server.close()]) };
}

function nonceFrom(structuredContent: unknown): string {
  return z.object({ bindingNonce: z.string() }).parse(structuredContent).bindingNonce;
}

async function seedBinding(dataDir: string, savedContext: LeadContext) {
  const panel = await connect(dataDir, async () => savedContext);
  const opened = await panel.client.callTool({
    name: 'ultra_panel',
    arguments: { contextKey: 'verified-original' },
  });
  expect(opened.structuredContent).toMatchObject({ bound: true });
  await panel.close();
  return nonceFrom(opened.structuredContent);
}

it('restores an exact saved chat through SDK metadata after the server reconnects', async () => {
  const { profile, dataDir } = await fixture();
  const originalNonce = await seedBinding(dataDir, context(profile));
  const resolver = vi.fn(async () => context(profile));
  const reopened = await connect(dataDir, resolver);
  const opened = await reopened.client.callTool({
    name: 'ultra_panel',
    arguments: {},
    _meta: metadata,
  });
  const nonce = nonceFrom(opened.structuredContent);
  expect(nonce).not.toBe(originalNonce);
  expect(opened.structuredContent).toEqual({
    bindingNonce: nonce,
    bound: true,
    panelKey: expect.stringMatching(/^[a-f0-9]{64}$/),
    sessionId,
    capabilityAvailability: 'unavailable',
    capabilityReason: expect.stringContaining('workflow execution is unavailable'),
  });
  expect(resolver).not.toHaveBeenCalled();
  expect(
    (await reopened.client.callTool({ name: 'ultra_panel_status', arguments: { nonce } }))
      .structuredContent,
  ).toEqual({ state: 'bound', panelKey: expect.stringMatching(/^[a-f0-9]{64}$/) });
  await reopened.close();
});

it('does not restore another chat or profile from an existing bound owner', async () => {
  const { profile, dataDir } = await fixture();
  await seedBinding(dataDir, context(profile));
  const panel = await connect(dataDir, async () => context(profile));
  const otherChat = await panel.client.callTool({
    name: 'ultra_panel',
    arguments: {},
    _meta: { thread_id: otherSessionId, threadId: otherSessionId },
  });
  expect(otherChat.structuredContent).not.toHaveProperty('bound');
  const foreign = await fixture();
  const otherProfile = await connect(foreign.dataDir, async () => context(foreign.profile));
  const opened = await otherProfile.client.callTool({
    name: 'ultra_panel',
    arguments: {},
    _meta: metadata,
  });
  expect(opened.structuredContent).not.toHaveProperty('bound');
  await Promise.all([panel.close(), otherProfile.close()]);
});

it('rejects a foreign profile owner even when its nonce is stored in the current database', async () => {
  const { profile, dataDir } = await fixture();
  await seedBinding(dataDir, context(`${profile}-foreign`));
  const panel = await connect(dataDir, async () => context(profile));
  const opened = await panel.client.callTool({
    name: 'ultra_panel',
    arguments: {},
    _meta: metadata,
  });
  expect(opened.structuredContent).not.toHaveProperty('bound');
  await panel.close();
});

it.each([
  {},
  { progressToken: 7 },
  { extension: 'private-value' },
  { thread_id: sessionId },
  { threadId: sessionId },
  { thread_id: sessionId, threadId: otherSessionId },
  { thread_id: 'not-a-uuid', threadId: 'not-a-uuid' },
  { thread_id: 1, threadId: 1 },
])('keeps manual binding for absent, malformed or conflicting host identity: %j', async (_meta) => {
  const { profile, dataDir } = await fixture();
  await seedBinding(dataDir, context(profile));
  const resolver = vi.fn(async () => context(profile));
  const panel = await connect(dataDir, resolver);
  const opened = await panel.client.callTool({ name: 'ultra_panel', arguments: {}, _meta });
  expect(opened.structuredContent).not.toHaveProperty('bound');
  expect(opened.structuredContent).not.toHaveProperty('sessionId');
  expect(resolver).not.toHaveBeenCalled();
  expect(
    (
      await panel.client.callTool({
        name: 'ultra_panel_status',
        arguments: { nonce: nonceFrom(opened.structuredContent) },
      })
    ).structuredContent,
  ).toEqual({ state: 'pending' });
  await panel.close();
});

it('keeps manual binding when request metadata is missing entirely', async () => {
  const { profile, dataDir } = await fixture();
  await seedBinding(dataDir, context(profile));
  const panel = await connect(dataDir, async () => context(profile));
  const opened = await panel.client.callTool({ name: 'ultra_panel', arguments: {} });
  expect(opened.structuredContent).not.toHaveProperty('bound');
  await panel.close();
});

it.each(['plain', 'relative', 'normalized'])(
  'does not infer an owner from a %s data directory',
  async (shape) => {
    const { profile } = await fixture();
    const dataDir =
      shape === 'plain'
        ? join(profile, 'custom-data')
        : shape === 'relative'
          ? relative(process.cwd(), join(profile, 'plugins', 'data', 'ultra-code'))
          : `${profile}/plugins/data/../data/ultra-code`;
    await seedBinding(dataDir, context(profile));
    const panel = await connect(dataDir, async () => context(profile));
    const opened = await panel.client.callTool({
      name: 'ultra_panel',
      arguments: {},
      _meta: metadata,
    });
    expect(opened.structuredContent).not.toHaveProperty('bound');
    await panel.close();
  },
);

it.each(['pending', 'binding', 'failed'])(
  'never restores a %s owner as a completed binding',
  async (state) => {
    const { profile, dataDir } = await fixture();
    const nonce = await seedBinding(dataDir, context(profile));
    const database = new DatabaseSync(join(dataDir, 'panel', 'bindings.sqlite'));
    database.prepare('UPDATE bindings SET state = ? WHERE nonce = ?').run(state, nonce);
    database.close();
    const panel = await connect(dataDir, async () => context(profile));
    const opened = await panel.client.callTool({
      name: 'ultra_panel',
      arguments: {},
      _meta: metadata,
    });
    expect(opened.structuredContent).not.toHaveProperty('bound');
    await panel.close();
  },
);

it('preserves explicit current-turn context precedence over saved host ownership', async () => {
  const { profile, dataDir } = await fixture();
  await seedBinding(dataDir, context(profile));
  const resolver = vi.fn(async () => ({
    ...context(profile),
    resolutionStatus: 'unknown' as const,
  }));
  const panel = await connect(dataDir, resolver);
  const opened = await panel.client.callTool({
    name: 'ultra_panel',
    arguments: { contextKey: 'unverified-current-turn' },
    _meta: metadata,
  });
  expect(opened.isError).toBe(true);
  expect(opened.structuredContent).toMatchObject({ bound: false });
  expect(resolver).toHaveBeenCalledWith('unverified-current-turn', dataDir);
  await panel.close();
});
