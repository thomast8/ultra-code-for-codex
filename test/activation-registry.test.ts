import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveContext } from '../src/activation/registry.js';
import type { LeadContext, StoredContext } from '../src/activation/types.js';

const contextKey = 'uctx_01a1090e-4f83-7a73-8500-f87c808e0e85';
const directories: string[] = [];

async function makeStore(): Promise<{ dataDir: string; file: string }> {
  const dataDir = await mkdtemp(join(tmpdir(), 'activation-registry-'));
  directories.push(dataDir);
  const activationDir = join(dataDir, 'activation');
  await mkdir(activationDir);
  return { dataDir, file: join(activationDir, `${contextKey}.json`) };
}

function verifiedContext(): LeadContext {
  return {
    instanceId: '/fake-codex',
    sessionId: '01a1090e-4f83-7a73-8500-f87c808e0e85',
    turnId: '01a1090e-4f83-7a73-8500-f87c808e0e86',
    cwd: '/workspace/project',
    model: 'gpt-6.1-sol',
    effort: 'ultra',
    collaborationMode: 'default',
    resolutionStatus: 'verified',
    resolutionReason: 'Exact session and turn metadata verified.',
  };
}

function record(context: LeadContext): StoredContext {
  return {
    schema: 'ultra-context-v1',
    resolutionStatus: context.resolutionStatus,
    resolutionReason: context.resolutionReason,
    context,
  };
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('registry polling and corruption', () => {
  it('resolves a valid record that appears during the bounded wait', async () => {
    const { dataDir, file } = await makeStore();
    const pending = resolveContext(contextKey, dataDir, { timeoutMs: 500 });
    setTimeout(() => writeFile(file, JSON.stringify(record(verifiedContext()))), 30);
    await expect(pending).resolves.toMatchObject({
      resolutionStatus: 'verified',
      model: 'gpt-6.1-sol',
    });
  });

  it('rejects a current-schema record with a non-object context', async () => {
    const { dataDir, file } = await makeStore();
    await writeFile(
      file,
      JSON.stringify({
        schema: 'ultra-context-v1',
        resolutionStatus: 'verified',
        resolutionReason: 'fixture',
        context: null,
      }),
    );
    await expect(resolveContext(contextKey, dataDir, { timeoutMs: 0 })).rejects.toThrow(
      'Exact-turn context is unavailable',
    );
  });

  it('surfaces filesystem read errors rather than treating them as a missing record', async () => {
    const { dataDir, file } = await makeStore();
    await mkdir(file);
    await expect(resolveContext(contextKey, dataDir, { timeoutMs: 0 })).rejects.toMatchObject({
      code: 'EISDIR',
    });
  });
});
