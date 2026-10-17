import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const cli = '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex';
const version = execFileSync(cli, ['--version'], { encoding: 'utf8' }).trim();
if (version !== 'codex-cli 0.163.0-alpha.10.2') {
  throw new Error(`Unsupported bundled CLI version: ${version}`);
}
const output = resolve('src/codex/generated');
mkdirSync(output, { recursive: true });
execFileSync(cli, ['app-server', 'generate-ts', '--out', output, '--experimental'], {
  stdio: 'inherit',
});
