import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';

const usage = {
  inputTokens: 100,
  cachedInputTokens: 60,
  outputTokens: 20,
  reasoningOutputTokens: 10,
  totalTokens: 120,
};
const attempt = { model: 'fixture', usage, actualCharge: null, evidence: 'fixture.json' };
const arm = {
  acceptancePassed: true,
  missedFindings: 0,
  retries: 0,
  rework: '',
  elapsedMs: 100,
  attempts: [attempt],
  coordinationUsage: null,
};
function report(direct: unknown, orchestrated: unknown) {
  const directory = mkdtempSync(join(tmpdir(), 'ultra-routing-'));
  const path = join(directory, 'pair.json');
  writeFileSync(
    path,
    JSON.stringify({
      frozenTask: 'fixture',
      protocol: 'same immutable input',
      direct,
      orchestrated,
    }),
  );
  return JSON.parse(
    execFileSync(process.execPath, [resolve('scripts/evaluate-routing.mjs'), path], {
      encoding: 'utf8',
    }),
  ) as Record<string, unknown>;
}

it('reports subsets and missing usage honestly without pricing or savings claims', () => {
  const result = report(arm, {
    ...arm,
    retries: 1,
    attempts: [attempt, { ...attempt, usage: null }],
  });
  expect(result.direct).toMatchObject({
    observedWorkerTokens: 120,
    workerAccountingComplete: true,
    totalAccountingComplete: false,
    observedCharge: null,
  });
  expect(result.orchestrated).toMatchObject({
    observedWorkerTokens: 120,
    workerAccountingComplete: false,
  });
  expect(result.decision).toContain('do not establish cheaper routing');
});

it('makes failed acceptance disqualifying even when token use is lower', () => {
  expect(report(arm, { ...arm, acceptancePassed: false }).decision).toContain('Quality bar failed');
});
