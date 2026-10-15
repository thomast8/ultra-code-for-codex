import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { expect, it } from 'vitest';
import { pluginDataDirectory, startPanel } from '../src/mcp/bootstrap.js';

it.each([
  {},
  { CODEX_PLUGIN_DATA: 'relative' },
  { CODEX_PLUGIN_DATA: '/tmp/../not-canonical' },
  { CODEX_PLUGIN_DATA: '/tmp/${PLUGIN_DATA}' },
  { CODEX_PLUGIN_DATA: '/tmp/a', PLUGIN_DATA: '/tmp/b' },
])('rejects unresolved or conflicting plugin data directories: %j', (environment) => {
  expect(() => pluginDataDirectory(environment)).toThrow();
});

it('accepts either documented alias and rejects absent startup data before connecting', async () => {
  expect(pluginDataDirectory({ CODEX_PLUGIN_DATA: '/tmp/a' })).toBe('/tmp/a');
  expect(pluginDataDirectory({ PLUGIN_DATA: '/tmp/a' })).toBe('/tmp/a');
  expect(pluginDataDirectory({ CODEX_PLUGIN_DATA: '/tmp/a', PLUGIN_DATA: '/tmp/a' })).toBe(
    '/tmp/a',
  );
  await expect(startPanel({})).rejects.toThrow('absolute');
});

it('starts the actual MCP server handshake through an injected transport', async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'startup-test', version: '1' });
  const [server] = await Promise.all([
    startPanel({ PLUGIN_DATA: '/tmp/startup' }, serverTransport),
    client.connect(clientTransport),
  ]);
  expect((await client.listTools()).tools.map((tool) => tool.name)).toContain('ultra_context');
  await Promise.all([server.close(), client.close()]);
});
