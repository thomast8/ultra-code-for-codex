import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import packageMetadata from '../package.json' with { type: 'json' };

const files = [
  '.agents/plugins/marketplace.json',
  'LICENSE',
  'README.md',
  'acceptance.md',
  'docs/desktop-compatibility.md',
  'docs/panel-design.md',
  'docs/cost-accounting.md',
  'plugin/.codex-plugin/plugin.json',
  'plugin/.mcp.json',
  'plugin/hooks/hooks.json',
  'plugin/assets/ultra.png',
  'plugin/assets/ultra-menu.png',
  'plugin/skills/ultra-code/SKILL.md',
  'plugin/skills/ultra-code/references/authoring.md',
  ...[
    'mcp-entry.js',
    'daemon-entry.js',
    'hook-entry.js',
    'panel.html',
    'quickjs.wasm',
    'THIRD_PARTY_NOTICES.txt',
  ].map((file) => `plugin/dist/${file}`),
];
for (const file of files) {
  const data = await readFile(file);
  assert.ok(data.length > 0, `Missing package file: ${file}`);
  if (file.startsWith('plugin/dist/')) {
    assert.ok(!data.includes(Buffer.from(`${process.cwd()}/`)), `Build path leaked into ${file}`);
    assert.ok(!data.includes(Buffer.from(`${homedir()}/`)), `Home path leaked into ${file}`);
  }
}
const manifest = JSON.parse(await readFile('plugin/.codex-plugin/plugin.json', 'utf8'));
assert.equal(manifest.version, packageMetadata.version);
await mkdir('release', { recursive: true });
const name = `ultra-code-for-codex-${packageMetadata.version}.tar.gz`;
const archive = `release/${name}`;
execFileSync('tar', ['-czf', archive, ...files]);
const listing = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n');
assert.deepEqual(listing.sort(), [...files].sort(), 'Release contents differ from the allowlist');
const hash = createHash('sha256')
  .update(await readFile(archive))
  .digest('hex');
writeFileSync('release/SHA256SUMS', `${hash}  ${name}\n`);
console.log(
  JSON.stringify({ version: manifest.version, archive, files: files.length, sha256: hash }),
);
