import { cpSync, mkdtempSync, appendFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import packageMetadata from '../package.json' with { type: 'json' };

it('packages real bundles with a root home but rejects an actual home-subtree path', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'ultra-release-'));
  for (const file of ['.agents', 'plugin', 'docs', 'README.md', 'LICENSE', 'acceptance.md'])
    cpSync(new URL(`../${file}`, import.meta.url), join(fixture, file), { recursive: true });
  if (process.platform === 'darwin')
    execFileSync('xattr', [
      '-w',
      'com.ultracode.package-fixture',
      'test',
      join(fixture, 'LICENSE'),
    ]);
  const script = new URL('../scripts/package-release.mjs', import.meta.url).href;
  const source = `
    import os from 'node:os';
    import { syncBuiltinESMExports } from 'node:module';
    os.homedir = () => '/root';
    syncBuiltinESMExports();
    await import(${JSON.stringify(script)});
  `;
  const run = () =>
    execFileSync(process.execPath, ['--input-type=module', '-e', source], {
      cwd: fixture,
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 15_000,
    });
  expect(JSON.parse(run())).toMatchObject({ version: packageMetadata.version, files: 20 });
  const archive = join(
    fixture,
    'release',
    `ultra-code-for-codex-${packageMetadata.version}.tar.gz`,
  );
  expect(gunzipSync(readFileSync(archive)).includes(Buffer.from('._LICENSE'))).toBe(false);
  appendFileSync(join(fixture, 'plugin/dist/mcp-entry.js'), '\n// /root/private-runtime/node\n');
  try {
    run();
    throw new Error('Expected the actual leaked path to be rejected');
  } catch (error) {
    expect(String((error as { stderr?: string }).stderr)).toContain(
      'Home path leaked into plugin/dist/mcp-entry.js',
    );
  }
});
