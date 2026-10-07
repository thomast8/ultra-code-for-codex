import './check-runtime.mjs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const cli = '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex';
const cliVersion = execFileSync(cli, ['--version'], { encoding: 'utf8' }).trim();
assert.equal(cliVersion, 'codex-cli 0.160.1');
await mkdir('work', { recursive: true });
const output = resolve('work/backend-probe.mjs');
await build({
  stdin: {
    contents:
      "export { CodexTransport } from './src/codex/transport.ts'; export { inspectBackend } from './src/codex/preflight.ts';",
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node26',
  outfile: output,
});
const { CodexTransport, inspectBackend } = await import(pathToFileURL(output).href);
const transport = await CodexTransport.launch(cli);
try {
  const preflight = await inspectBackend(transport);
  assert.equal(preflight.eligible, false, 'Unsupported capability verification must fail closed');
  const result = {
    scope: 'bundled app-server metadata and admission only; no worker/model dispatch',
    cliVersion,
    eligible: preflight.eligible,
    accountType: preflight.metadata.accountType,
    planType: preflight.metadata.planType,
    defaultModel: preflight.metadata.defaultModel,
    modelCount: preflight.metadata.availableModels.length,
    configuredMcpCount: preflight.metadata.namedMcpServers.length,
    configuredPluginCount: preflight.metadata.namedPlugins.length,
    blockers: preflight.blockers,
  };
  await writeFile('work/backend-qa.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  transport.close();
}
