import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { localEndpoint } from '../src/local/endpoint.js';
import { startupFailureReason, waitForStartup, writeStartupReceipt } from '../src/local/startup.js';
import { localFixture } from './local-runtime-fixture.js';

it.each([
  [Object.assign(new Error('private-permission-value'), { code: 'EACCES' }), 'permissions'],
  [Object.assign(new Error('private-sql-value'), { code: 'ERR_SQLITE_ERROR' }), 'journal'],
  [new Error('Unsupported or corrupt workflow journal: private-record'), 'journal'],
  [new SyntaxError('private-record-json'), 'journal'],
  [Object.assign(new Error('private-endpoint'), { code: 'EADDRINUSE' }), 'endpoint'],
  [new Error('Ultra Code runtime already running'), 'endpoint'],
  [new Error('Node 26.10.0 or 26.12.0 is required'), 'version'],
  [new Error('private-unknown'), 'initialization'],
  [null, 'initialization'],
])('projects startup errors to an allowlisted category %#', (error, expected) => {
  expect(startupFailureReason(error)).toBe(expected);
});

it('records readiness and a safe journal failure for only the matching attempt', async () => {
  const { dataDir } = localFixture();
  localEndpoint(dataDir);
  const ready = randomUUID();
  writeStartupReceipt(dataDir, ready, 'ready');
  await expect(waitForStartup(dataDir, ready)).resolves.toBeUndefined();
  const failed = randomUUID();
  writeStartupReceipt(dataDir, failed, 'journal');
  await expect(waitForStartup(dataDir, failed)).rejects.toThrow('journal');
  expect(await readFile(join(dataDir, 'runtime', `startup-${failed}.json`), 'utf8')).not.toContain(
    'private',
  );
  writeStartupReceipt(dataDir, undefined, 'ready');
  writeStartupReceipt('/missing-runtime', randomUUID(), 'permissions');
});

it.each(['bad-json', 'wrong-attempt', 'unknown-reason', 'oversized', 'directory'])(
  'rejects a %s receipt without exposing its contents',
  async (kind) => {
    const { dataDir } = localFixture();
    localEndpoint(dataDir);
    const id = randomUUID();
    const path = join(dataDir, 'runtime', `startup-${id}.json`);
    const contents =
      kind === 'bad-json'
        ? 'private-invalid-json'
        : JSON.stringify({
            attemptId: kind === 'wrong-attempt' ? randomUUID() : id,
            reason: kind === 'unknown-reason' ? 'private-invalid-reason' : 'ready',
          });
    if (kind === 'directory') {
      const { mkdir } = await import('node:fs/promises');
      await mkdir(path);
    } else await writeFile(path, kind === 'oversized' ? contents + 'x'.repeat(1025) : contents);
    await expect(waitForStartup(dataDir, id)).rejects.toThrow('diagnostic');
  },
);

it('bounds an absent startup receipt without adopting an earlier attempt', async () => {
  const { dataDir } = localFixture();
  localEndpoint(dataDir);
  writeStartupReceipt(dataDir, randomUUID(), 'ready');
  let tick = 0;
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => (tick += 5001));
  try {
    await expect(waitForStartup(dataDir, randomUUID())).rejects.toThrow('five seconds');
  } finally {
    clock.mockRestore();
  }
});

it('defers an endpoint conflict to authenticated client connection checks', async () => {
  const { dataDir } = localFixture();
  localEndpoint(dataDir);
  const attempt = randomUUID();
  writeStartupReceipt(dataDir, attempt, 'endpoint');
  await expect(waitForStartup(dataDir, attempt)).resolves.toBe('endpoint');
});
