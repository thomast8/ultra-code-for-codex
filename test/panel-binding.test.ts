import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { LeadContext } from '../src/activation/types.js';
import { createPanelServer } from '../src/mcp/panel-server.js';

const context: LeadContext = {
  instanceId: '/codex',
  sessionId: 'session-a',
  turnId: 'turn-a',
  cwd: '/repo',
  model: 'gpt-6',
  effort: 'high',
  collaborationMode: 'default',
  resolutionStatus: 'verified',
  resolutionReason: '',
};

async function connected(
  resolveContext: (key: string, dataDir: string) => Promise<LeadContext>,
  loadPanelHtml = async () => '<main>panel test</main>',
) {
  const server = createPanelServer(resolveContext, '/codex', loadPanelHtml);
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { server, client };
}

async function nonceFrom(client: Client): Promise<string> {
  const result = await client.callTool({ name: 'ultra_panel', arguments: {} });
  const { bindingNonce: nonce } = z
    .object({ bindingNonce: z.string() })
    .parse(result.structuredContent);
  if (typeof nonce !== 'string') throw new Error('Panel did not return its binding nonce');
  return nonce;
}

describe('panel chat binding', () => {
  it('publishes the thread side-panel entrypoint and inline MCP App resource', async () => {
    const { server, client } = await connected(async () => context);
    const listed = await client.listTools();
    const panelTool = listed.tools.find((tool) => tool.name === 'ultra_panel');
    expect(panelTool?._meta?.ui).toEqual({ resourceUri: 'ui://ultra-code/panel.html' });
    expect(panelTool?._meta?.['openai/ui']).toEqual({
      entrypoints: [{ type: 'thread' }],
    });
    expect(panelTool?._meta?.['ui/resourceUri']).toBe('ui://ultra-code/panel.html');
    const bindingTool = listed.tools.find((tool) => tool.name === 'ultra_panel_bind');
    expect(bindingTool?._meta?.ui).toEqual({ resourceUri: 'ui://ultra-code/panel.html' });
    const resource = await client.readResource({ uri: 'ui://ultra-code/panel.html' });
    expect(resource.contents[0]).toMatchObject({
      mimeType: 'text/html;profile=mcp-app',
      text: '<main>panel test</main>',
    });
    await Promise.all([client.close(), server.close()]);
  });

  it('resolves only the explicitly supplied exact-turn context handle', async () => {
    let resolutions = 0;
    const { server, client } = await connected(async (contextKey) => {
      resolutions += 1;
      if (contextKey !== 'verified-a') throw new Error('unknown handle');
      return context;
    });
    const before = await client.callTool({
      name: 'ultra_context',
      arguments: { contextKey: 'unknown' },
    });
    expect(before.isError).toBe(true);
    expect(resolutions).toBe(1);
    const after = await client.callTool({
      name: 'ultra_context',
      arguments: { contextKey: 'verified-a' },
    });
    expect(after.structuredContent).toMatchObject({
      ...context,
      capabilityAvailability: 'unavailable',
    });
    expect(after.structuredContent).toMatchObject({
      capabilityReason: expect.stringContaining('workflow execution is unavailable'),
    });
    const nonce = await nonceFrom(client);
    await client.callTool({
      name: 'ultra_panel_bind',
      arguments: { nonce, contextKey: 'verified-a' },
    });
    await Promise.all([client.close(), server.close()]);
  });
});

describe('panel ownership', () => {
  it('locks a nonce to one verified chat, including concurrent binding attempts', async () => {
    let finishResolution: ((value: LeadContext) => void) | undefined;
    let firstResolution = true;
    const { server, client } = await connected(
      (key) =>
        new Promise((resolve) => {
          if (key === 'verified-b') resolve({ ...context, sessionId: 'session-b' });
          else if (firstResolution) {
            firstResolution = false;
            finishResolution = resolve;
          } else resolve(context);
        }),
    );
    const nonce = await nonceFrom(client);
    const first = client.callTool({
      name: 'ultra_panel_bind',
      arguments: { nonce, contextKey: 'verified-a' },
    });
    const second = await client.callTool({
      name: 'ultra_panel_bind',
      arguments: { nonce, contextKey: 'verified-b' },
    });
    expect(second.isError).toBe(true);
    finishResolution?.(context);
    expect((await first).isError).not.toBe(true);
    const other = await client.callTool({
      name: 'ultra_panel_bind',
      arguments: { nonce, contextKey: 'verified-b' },
    });
    expect(other.isError).toBe(true);
    const same = await client.callTool({
      name: 'ultra_panel_bind',
      arguments: { nonce, contextKey: 'verified-a' },
    });
    expect(same.isError).not.toBe(true);
    const sameChatNextTurn = await client.callTool({
      name: 'ultra_panel_bind',
      arguments: { nonce, contextKey: 'verified-a-next-turn' },
    });
    expect(sameChatNextTurn.isError).not.toBe(true);
    await Promise.all([client.close(), server.close()]);
  });
});

describe('unverified panel contexts', () => {
  it('burns a nonce when the exact context cannot be verified', async () => {
    const { server, client } = await connected(async () => {
      throw new Error('turn metadata missing');
    });
    const nonce = await nonceFrom(client);
    const bind = await client.callTool({
      name: 'ultra_panel_bind',
      arguments: { nonce, contextKey: 'unverified' },
    });
    expect(bind.isError).toBe(true);
    const retry = await client.callTool({
      name: 'ultra_panel_bind',
      arguments: { nonce, contextKey: 'verified-later' },
    });
    expect(retry.isError).toBe(true);
    await Promise.all([client.close(), server.close()]);
  });

  it('does not bind a context explicitly marked unknown', async () => {
    const unknown = {
      ...context,
      resolutionStatus: 'unknown' as const,
      resolutionReason: 'CLI log schema is not verified.',
    };
    const { server, client } = await connected(async () => unknown);
    const nonce = await nonceFrom(client);
    const bind = await client.callTool({
      name: 'ultra_panel_bind',
      arguments: { nonce, contextKey: 'unverified' },
    });
    expect(bind.isError).toBe(true);
    expect(bind.structuredContent).toMatchObject({
      bound: false,
      reason: unknown.resolutionReason,
    });
    await Promise.all([client.close(), server.close()]);
  });
});
