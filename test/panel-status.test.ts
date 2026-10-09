import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { z } from 'zod';
import type { LeadContext } from '../src/activation/types.js';
import { createPanelServer, type ContextResolver } from '../src/mcp/panel-server.js';

const context: LeadContext = {
  instanceId: '/profile',
  sessionId: 'chat',
  turnId: 'turn',
  cwd: '/repo',
  model: 'gpt-6.1-sol',
  effort: 'ultra',
  collaborationMode: 'default',
  resolutionStatus: 'verified',
  resolutionReason: 'Verified turn',
};

async function connect(dataDir: string, resolver: ContextResolver) {
  const server = createPanelServer(resolver, dataDir, async () => '<main>panel</main>');
  const client = new Client({ name: 'panel-status-test', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, close: () => Promise.all([client.close(), server.close()]) };
}

it('exposes a private app-only read that observes binding in a separate server', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ultra-panel-status-'));
  let resolutions = 0;
  const panel = await connect(dataDir, async () => {
    resolutions += 1;
    return context;
  });
  const binder = await connect(dataDir, async () => context);
  const statusTool = (await panel.client.listTools()).tools.find(
    (tool) => tool.name === 'ultra_panel_status',
  );
  expect(statusTool?._meta?.ui).toEqual({ visibility: ['app'] });
  const opened = await panel.client.callTool({ name: 'ultra_panel', arguments: {} });
  const { bindingNonce: nonce } = z
    .object({ bindingNonce: z.string() })
    .parse(opened.structuredContent);
  const read = () => panel.client.callTool({ name: 'ultra_panel_status', arguments: { nonce } });
  expect((await read()).structuredContent).toEqual({ state: 'pending' });
  expect(resolutions).toBe(0);
  await binder.client.callTool({
    name: 'ultra_panel_bind',
    arguments: { nonce, contextKey: 'current' },
  });
  expect((await read()).structuredContent).toEqual({ state: 'bound' });
  expect((await read()).structuredContent).toEqual({ state: 'bound' });
  expect(resolutions).toBe(0);
  await Promise.all([panel.close(), binder.close()]);
  const reopened = await connect(dataDir, async () => context);
  expect(
    (await reopened.client.callTool({ name: 'ultra_panel_status', arguments: { nonce } }))
      .structuredContent,
  ).toEqual({ state: 'bound' });
  await reopened.close();
});

it('does not disclose another profile or bind failed and unknown nonces', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ultra-panel-status-'));
  const panel = await connect(dataDir, async () => ({ ...context, resolutionStatus: 'unknown' }));
  const opened = await panel.client.callTool({ name: 'ultra_panel', arguments: {} });
  const { bindingNonce: nonce } = z
    .object({ bindingNonce: z.string() })
    .parse(opened.structuredContent);
  const foreign = await connect(
    await mkdtemp(join(tmpdir(), 'ultra-panel-foreign-')),
    async () => context,
  );
  expect(
    (await foreign.client.callTool({ name: 'ultra_panel_status', arguments: { nonce } })).isError,
  ).toBe(true);
  const read = (value: string) =>
    panel.client.callTool({ name: 'ultra_panel_status', arguments: { nonce: value } });
  expect((await read('missing')).isError).toBe(true);
  await panel.client.callTool({
    name: 'ultra_panel_bind',
    arguments: { nonce, contextKey: 'unverified' },
  });
  expect((await read(nonce)).structuredContent).toEqual({ state: 'failed' });
  await Promise.all([panel.close(), foreign.close()]);
});

it('shows a claimed binding without taking or resolving the claim', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ultra-panel-status-'));
  let complete: ((value: LeadContext) => void) | undefined;
  let entered: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const panel = await connect(
    dataDir,
    () =>
      new Promise((resolve) => {
        complete = resolve;
        entered?.();
      }),
  );
  const opened = await panel.client.callTool({ name: 'ultra_panel', arguments: {} });
  const { bindingNonce: nonce } = z
    .object({ bindingNonce: z.string() })
    .parse(opened.structuredContent);
  const claim = panel.client.callTool({
    name: 'ultra_panel_bind',
    arguments: { nonce, contextKey: 'current' },
  });
  await started;
  expect(
    (await panel.client.callTool({ name: 'ultra_panel_status', arguments: { nonce } }))
      .structuredContent,
  ).toEqual({ state: 'binding' });
  complete?.(context);
  expect((await claim).isError).not.toBe(true);
  await panel.close();
});

it('opens already bound only when the lead supplies a verified exact context', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ultra-panel-auto-'));
  const keys: string[] = [];
  const panel = await connect(dataDir, async (key) => {
    keys.push(key);
    return context;
  });
  const opened = await panel.client.callTool({
    name: 'ultra_panel',
    arguments: { contextKey: 'exact-turn' },
  });
  const { bindingNonce: nonce } = z
    .object({ bindingNonce: z.string() })
    .parse(opened.structuredContent);
  expect(opened.isError).not.toBe(true);
  expect(opened.structuredContent).toMatchObject({ bound: true, sessionId: context.sessionId });
  expect(keys).toEqual(['exact-turn']);
  expect(
    (await panel.client.callTool({ name: 'ultra_panel_status', arguments: { nonce } }))
      .structuredContent,
  ).toEqual({ state: 'bound' });
  await panel.close();
});

it.each(['unknown', 'throw'])('does not open a bound panel for a %s lead context', async (mode) => {
  const panel = await connect(await mkdtemp(join(tmpdir(), 'ultra-panel-auto-')), async () => {
    if (mode === 'throw') throw new Error('Unknown exact context');
    return { ...context, resolutionStatus: 'unknown', resolutionReason: 'Unsupported metadata' };
  });
  const opened = await panel.client.callTool({
    name: 'ultra_panel',
    arguments: { contextKey: 'unverified' },
  });
  const { bindingNonce: nonce } = z
    .object({ bindingNonce: z.string() })
    .parse(opened.structuredContent);
  expect(opened.isError).toBe(true);
  expect(opened.structuredContent).toMatchObject({ bound: false });
  expect(
    (await panel.client.callTool({ name: 'ultra_panel_status', arguments: { nonce } }))
      .structuredContent,
  ).toEqual({ state: 'failed' });
  await panel.close();
});
