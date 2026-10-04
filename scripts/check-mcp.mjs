import './check-runtime.mjs';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const dataDir = resolve('work/mcp-protocol-qa');
await mkdir(dataDir, { recursive: true, mode: 0o700 });
const client = new Client({ name: 'ultra-code-protocol-qa', version: '0.1.0' });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [resolve('plugin/dist/mcp-entry.js')],
  env: { PATH: process.env.PATH ?? '', CODEX_PLUGIN_DATA: dataDir },
  stderr: 'pipe',
});
try {
  await client.connect(transport);
  const tools = await client.listTools();
  const panel = tools.tools.find((tool) => tool.name === 'ultra_panel');
  assert.ok(panel, 'ultra_panel was not registered');
  const opened = await client.callTool({ name: 'ultra_panel', arguments: {} });
  assert.equal(opened.isError, undefined);
  assert.equal(typeof opened.structuredContent?.bindingNonce, 'string');
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
  console.log(
    JSON.stringify({
      status: 'passed',
      scope: 'local stdio protocol only; not Codex Desktop QA',
      tools: tools.tools.map((tool) => tool.name),
      uiResource: uri,
    }),
  );
} finally {
  await client.close();
}
