import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { readExactTurn } from '../src/activation/session-source.js';
import { compatibilityLog, fixtureInput } from './activation-compatibility-fixture.js';

it('fails closed when a scan expires even after finding exact metadata', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ultra-scan-deadline-'));
  await mkdir(join(root, 'sessions'));
  const file = join(root, 'sessions', 'large.jsonl');
  await writeFile(
    file,
    compatibilityLog() + ('{ "response":"' + 'x'.repeat(1000) + '" }\n').repeat(500),
  );
  let tick = 0;
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => ++tick);
  try {
    const context = await readExactTurn({ ...fixtureInput, transcript_path: file }, 2);
    expect(context.resolutionStatus).toBe('unknown');
    expect(context.resolutionReason).toContain('scan exceeded its deadline');
    expect(tick).toBeLessThan(10);
  } finally {
    clock.mockRestore();
  }
});
