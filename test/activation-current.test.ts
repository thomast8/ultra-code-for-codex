import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it } from 'vitest';
import {
  registerContext,
  resolveContext,
  resolveCurrentContext,
} from '../src/activation/registry.js';
import {
  compatibilityRows,
  fixtureInput,
  serializeRows,
} from './activation-compatibility-fixture.js';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function fixture() {
  const dataDir = await mkdtemp(join(tmpdir(), 'ultra-current-turn-'));
  directories.push(dataDir);
  await mkdir(join(dataDir, 'sessions'));
  const transcript_path = join(dataDir, 'sessions', 'current.jsonl');
  const rows = compatibilityRows();
  const input = { ...fixtureInput, transcript_path };
  await writeFile(transcript_path, serializeRows(rows.session, rows.turn));
  const first = await registerContext(input, dataDir);
  return { dataDir, input, rows, first };
}

it('rejects an old Default handle after a Plan turn without changing historical metadata', async () => {
  const f = await fixture();
  await expect(resolveCurrentContext(f.first.contextKey, f.dataDir)).resolves.toMatchObject({
    collaborationMode: 'default',
  });
  const next = { ...f.input, turn_id: '01a2090e-4f83-7a73-8500-f87c808e0e86' };
  f.rows.turn.payload.turn_id = next.turn_id;
  f.rows.turn.payload.collaboration_mode.mode = 'plan';
  await writeFile(f.input.transcript_path, serializeRows(f.rows.session, f.rows.turn));
  const plan = await registerContext(next, f.dataDir);
  await expect(resolveCurrentContext(f.first.contextKey, f.dataDir)).rejects.toThrow('superseded');
  await expect(resolveCurrentContext(plan.contextKey, f.dataDir)).resolves.toMatchObject({
    collaborationMode: 'plan',
    turnId: next.turn_id,
  });
  await expect(resolveContext(f.first.contextKey, f.dataDir)).resolves.toMatchObject({
    collaborationMode: 'default',
  });
});

it('revokes the prior handle even when the new hook cannot read its transcript', async () => {
  const f = await fixture();
  await expect(
    registerContext({ ...f.input, transcript_path: '/missing' }, f.dataDir),
  ).rejects.toThrow();
  await expect(resolveCurrentContext(f.first.contextKey, f.dataDir)).rejects.toThrow('superseded');
});

it('keeps each explicitly identified chat current independently', async () => {
  const f = await fixture();
  const other = {
    ...f.input,
    session_id: '01a3090e-4f83-7a73-8500-f87c808e0e85',
    turn_id: '01a3090e-4f83-7a73-8500-f87c808e0e86',
  };
  f.rows.session.payload.id = other.session_id;
  f.rows.session.payload.session_id = other.session_id;
  f.rows.turn.payload.turn_id = other.turn_id;
  await writeFile(f.input.transcript_path, serializeRows(f.rows.session, f.rows.turn));
  const second = await registerContext(other, f.dataDir);
  await expect(resolveCurrentContext(f.first.contextKey, f.dataDir)).resolves.toMatchObject({
    sessionId: f.input.session_id,
  });
  await expect(resolveCurrentContext(second.contextKey, f.dataDir)).resolves.toMatchObject({
    sessionId: other.session_id,
    resolutionStatus: 'verified',
  });
});

it('fails closed for legacy handles without a current-turn registration', async () => {
  const f = await fixture();
  const otherDirectory = await mkdtemp(join(tmpdir(), 'ultra-legacy-turn-'));
  directories.push(otherDirectory);
  await mkdir(join(otherDirectory, 'activation'));
  const context = await resolveContext(f.first.contextKey, f.dataDir);
  await writeFile(
    join(otherDirectory, 'activation', `${f.first.contextKey}.json`),
    JSON.stringify({
      schema: 'ultra-context-v1',
      resolutionStatus: context.resolutionStatus,
      resolutionReason: context.resolutionReason,
      context,
    }),
  );
  await expect(resolveCurrentContext(f.first.contextKey, otherDirectory)).rejects.toThrow(
    'Current-turn registration',
  );
});
