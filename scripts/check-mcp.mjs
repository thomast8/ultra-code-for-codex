import './check-runtime.mjs';
import packageMetadata from '../package.json' with { type: 'json' };
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { cp, lstat, mkdir, mkdtemp, readFile, realpath } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const fixture = await realpath(await mkdtemp(join(tmpdir(), 'ultra-mcp-launch-')));
const pluginRoot = join(
  fixture,
  'plugins/cache/ultra-code-for-codex-local/ultra-code-for-codex/qa',
);
await mkdir(pluginRoot, { recursive: true });
await cp(resolve('plugin/dist'), join(pluginRoot, 'dist'), { recursive: true });
const { mcpServers } = JSON.parse(await readFile('plugin/.mcp.json', 'utf8'));
const config = mcpServers['ultra-code'];
const dataDir = join(fixture, 'plugins/data/ultra-code-for-codex-ultra-code-for-codex-local');
const client = new Client({ name: 'ultra-code-protocol-qa', version: packageMetadata.version });
const transport = new StdioClientTransport({
  command: config.command,
  args: config.args,
  cwd: resolve(pluginRoot, config.cwd),
  env: { PATH: process.env.PATH ?? '' },
  stderr: 'pipe',
});
let report;
let daemonPid;
try {
  await client.connect(transport);
  const tools = await client.listTools();
  const panel = tools.tools.find((tool) => tool.name === 'ultra_panel');
  assert.ok(panel, 'ultra_panel was not registered');
  const statusTool = tools.tools.find((tool) => tool.name === 'ultra_panel_status');
  assert.deepEqual(statusTool?._meta?.ui?.visibility, ['app']);
  const opened = await client.callTool({ name: 'ultra_panel', arguments: {} });
  daemonPid = await fixtureDaemonPid();
  assert.equal(opened.isError, undefined);
  assert.equal(opened.structuredContent?.capabilityAvailability, 'available');
  assert.ok(daemonPid, 'Isolated fixture daemon did not start');
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
  report = {
    status: 'passed',
    scope: 'actual plugin manifest launch in an isolated cache; not Desktop rendering QA',
    tools: tools.tools.map((tool) => tool.name),
    uiResource: uri,
  };
} finally {
  try {
    await client.close();
  } finally {
    await stopFixtureDaemon(daemonPid ?? (await fixtureDaemonPid()));
  }
}
console.log(JSON.stringify({ ...report, fixture, fixtureDaemonStopped: true }));

function fixtureSocket() {
  const digest = createHash('sha256').update(dataDir).digest('hex').slice(0, 20);
  return `/private/tmp/ultra-code-${process.getuid?.() ?? 'local'}-${digest}/daemon.sock`;
}

async function fixtureDaemonPid() {
  let token;
  try {
    token = await readFile(join(dataDir, 'runtime/daemon.key'), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
  assert.ok(/^[a-f0-9]{64}$/.test(token), 'Invalid fixture runtime credential');
  const id = randomUUID();
  const response = await new Promise((resolve, reject) => {
    const socket = createConnection(fixtureSocket());
    let buffer = '';
    socket.setEncoding('utf8');
    socket.setTimeout(3_000, () => socket.destroy(new Error('Fixture daemon health timed out')));
    socket.once('error', reject);
    socket.once('connect', () =>
      socket.end(
        `${JSON.stringify({
          id,
          token,
          version: packageMetadata.version,
          method: 'health',
          params: {},
        })}\n`,
      ),
    );
    socket.on('data', (chunk) => {
      buffer += chunk;
      if (buffer.length > 4096)
        socket.destroy(new Error('Fixture daemon health exceeded its bound'));
    });
    socket.once('end', () => {
      try {
        resolve(JSON.parse(buffer));
      } catch {
        reject(new Error('Invalid fixture daemon health response'));
      }
    });
  });
  assert.equal(response.id, id, 'Fixture daemon response identity mismatch');
  assert.equal(response.result?.protocol, 'ultra-daemon-v1');
  assert.equal(response.result?.version, packageMetadata.version);
  const pid = response.result?.pid;
  assert.ok(
    Number.isSafeInteger(pid) && pid > 1 && pid !== process.pid,
    'Invalid fixture daemon PID',
  );
  return pid;
}

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

async function stopFixtureDaemon(pid) {
  if (pid === undefined) return;
  const runtime = JSON.parse(await readFile(join(pluginRoot, 'dist/runtime.json'), 'utf8'));
  const expected = `${runtime.nodeExecutable} ${join(pluginRoot, 'dist/daemon-entry.js')} ${dataDir}`;
  const command = execFileSync('ps', ['-p', String(pid), '-o', 'command='], {
    encoding: 'utf8',
  }).trim();
  assert.ok(command === expected, 'Refusing to stop a process outside the isolated fixture');
  process.kill(pid, 'SIGTERM');
  const deadline = Date.now() + 5_000;
  while (isRunning(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(isRunning(pid), false, 'Isolated fixture daemon did not stop');
  await assert.rejects(lstat(fixtureSocket()), { code: 'ENOENT' });
}
