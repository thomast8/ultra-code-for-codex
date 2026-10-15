import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { z } from 'zod';
import { expect, it } from 'vitest';
import { createPanelServer, type ContextResolver } from '../src/mcp/panel-server.js';
import type { LeadContext } from '../src/activation/types.js';

const verified: LeadContext = {
  instanceId: '/profile-a',
  sessionId: 'session',
  turnId: 'turn',
  cwd: '/repo',
  model: 'gpt-6.1-sol',
  effort: 'ultra',
  collaborationMode: 'default',
  resolutionStatus: 'verified',
  resolutionReason: 'Exact recorded turn',
};

async function connect(resolver: ContextResolver) {
  const server = createPanelServer(resolver, '/tmp/data', async () => '<main>probe</main>');
  const client = new Client({ name: 'failure-test', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const opened = await client.callTool({ name: 'ultra_panel', arguments: {} });
  const { bindingNonce } = z.object({ bindingNonce: z.string() }).parse(opened.structuredContent);
  return { client, server, nonce: bindingNonce };
}

it('never resolves an unknown nonce and reports unknown metadata without activation', async () => {
  let calls = 0;
  const { client, server } = await connect(async () => {
    calls += 1;
    return {
      ...verified,
      resolutionStatus: 'unknown',
      effort: 'unknown',
      resolutionReason: 'Missing record',
    };
  });
  const failed = await client.callTool({
    name: 'ultra_panel_bind',
    arguments: { nonce: 'unknown', contextKey: 'handle' },
  });
  expect(failed.isError).toBe(true);
  expect(calls).toBe(0);
  const unknown = await client.callTool({
    name: 'ultra_context',
    arguments: { contextKey: 'handle' },
  });
  expect(unknown.structuredContent).toMatchObject({
    resolutionStatus: 'unknown',
    effort: 'unknown',
  });
  await Promise.all([client.close(), server.close()]);
});

it('binds only the original profile and rejects unverified follow-up handles', async () => {
  const { client, server, nonce } = await connect(async (key) => {
    if (key === 'unknown')
      return { ...verified, resolutionStatus: 'unknown', resolutionReason: '' };
    if (key === 'throw') throw 'Invalid handle';
    return {
      ...verified,
      instanceId: key === 'other-profile' ? '/profile-b' : verified.instanceId,
    };
  });
  const bind = (contextKey: string) =>
    client.callTool({ name: 'ultra_panel_bind', arguments: { nonce, contextKey } });
  expect((await bind('first')).isError).not.toBe(true);
  expect((await bind('other-profile')).isError).toBe(true);
  expect((await bind('unknown')).isError).toBe(true);
  expect((await bind('throw')).isError).toBe(true);
  await Promise.all([client.close(), server.close()]);
});

it.each(['unknown', 'throw'])('fails closed when first binding resolution is %s', async (mode) => {
  const { client, server, nonce } = await connect(async () => {
    if (mode === 'throw') throw 'Invalid handle';
    return { ...verified, resolutionStatus: 'unknown', resolutionReason: '' };
  });
  const failed = await client.callTool({
    name: 'ultra_panel_bind',
    arguments: { nonce, contextKey: 'handle' },
  });
  expect(failed.isError).toBe(true);
  if (mode === 'throw') {
    const context = await client.callTool({
      name: 'ultra_context',
      arguments: { contextKey: 'handle' },
    });
    expect(context.isError).toBe(true);
  }
  await Promise.all([client.close(), server.close()]);
});
