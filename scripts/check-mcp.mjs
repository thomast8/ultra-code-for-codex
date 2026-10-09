import './check-runtime.mjs';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const fixture = await mkdtemp(join(tmpdir(), 'ultra-mcp-launch-'));
const pluginRoot = join(
  fixture,
  'plugins/cache/ultra-code-for-codex-local/ultra-code-for-codex/qa',
);
await mkdir(pluginRoot, { recursive: true });
await cp(resolve('plugin/dist'), join(pluginRoot, 'dist'), { recursive: true });
const { mcpServers } = JSON.parse(await readFile('plugin/.mcp.json', 'utf8'));
const config = mcpServers['ultra-code'];
const client = new Client({ name: 'ultra-code-protocol-qa', version: '0.1.4' });
const transport = new StdioClientTransport({
  command: config.command,
  args: config.args,
  cwd: resolve(pluginRoot, config.cwd),
  env: { PATH: process.env.PATH ?? '' },
  stderr: 'pipe',
});
try {
  await client.connect(transport);
  const tools = await client.listTools();
  const panel = tools.tools.find((tool) => tool.name === 'ultra_panel');
  assert.ok(panel, 'ultra_panel was not registered');
  const statusTool = tools.tools.find((tool) => tool.name === 'ultra_panel_status');
  assert.deepEqual(statusTool?._meta?.ui?.visibility, ['app']);
  const opened = await client.callTool({ name: 'ultra_panel', arguments: {} });
  assert.equal(opened.isError, undefined);
  assert.equal(typeof opened.structuredContent?.bindingNonce, 'string');
  const status = () =>
    client.callTool({
      name: 'ultra_panel_status',
      arguments: { nonce: opened.structuredContent.bindingNonce },
    });
  assert.deepEqual((await status()).structuredContent, { state: 'pending' });
  const uri = panel._meta?.ui?.resourceUri;
  assert.equal(typeof uri, 'string');
  const resource = await client.readResource({ uri });
  assert.equal(resource.contents[0]?.mimeType, 'text/html;profile=mcp-app');
  assert.ok(resource.contents[0]?.text.includes('<div id="root">'));
  const unbound = await client.callTool({
    name: 'ultra_panel_bind',
    arguments: { nonce: opened.structuredContent.bindingNonce, contextKey: 'invalid' },
  });
  assert.equal(unbound.isError, true, 'Invalid context must not bind a panel');
  assert.deepEqual((await status()).structuredContent, { state: 'failed' });
  console.log(
    JSON.stringify({
      status: 'passed',
      scope: 'actual plugin manifest launch in an isolated cache; not Desktop rendering QA',
      tools: tools.tools.map((tool) => tool.name),
      uiResource: uri,
    }),
  );
} finally {
  await client.close();
}
