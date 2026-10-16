import { expect, it } from 'vitest';
import type { TokenUsage } from '../src/contracts/workflow.js';
import { creditLabel, estimateRunCredits } from '../src/ui/credit-estimate.js';
import { runFixture, taskFixture } from './panel-ui-dashboard-fixture.js';

const first: TokenUsage = {
  inputTokens: 168_686,
  cachedInputTokens: 132_608,
  outputTokens: 2_237,
  reasoningOutputTokens: 1_000,
  totalTokens: 170_923,
};
const second: TokenUsage = {
  inputTokens: 135_416,
  cachedInputTokens: 97_024,
  outputTokens: 2_684,
  reasoningOutputTokens: 500,
  totalTokens: 138_100,
};

it('prices the two observed Luna workers without double-counting cached or reasoning tokens', () => {
  const run = runFixture({
    tasks: [
      taskFixture({ id: 'first', usage: first }),
      taskFixture({ id: 'second', usage: second }),
    ],
    usage: {
      inputTokens: 304_102,
      cachedInputTokens: 229_632,
      outputTokens: 4_921,
      reasoningOutputTokens: 1_500,
      totalTokens: 309_023,
    },
  });
  const estimate = estimateRunCredits(run);
  expect(estimate?.minimum).toBeCloseTo(0.1189205, 10);
  expect(estimate?.maximum).toBeCloseTo(0.3050955, 10);
  expect(estimate?.models).toEqual(['GPT-6 Luna']);
  expect(estimate && creditLabel(estimate)).toBe('0.1189205–0.3050955 credits');
});

it('subtracts reported free cache writes for an exact Standard-rate equivalent', () => {
  const usage = { ...first, cacheWriteInputTokens: 10_000 };
  const estimate = estimateRunCredits(runFixture({ usage, tasks: [taskFixture({ usage })] }));
  expect(estimate?.minimum).toBeCloseTo(0.1263095, 10);
  expect(estimate?.maximum).toBe(estimate?.minimum);
  expect(estimate?.cacheWritesKnown).toBe(true);
});

it('refuses an unknown reported model, impossible token subsets, or incomplete task totals', () => {
  const known = runFixture({ usage: first, tasks: [taskFixture({ usage: first })] });
  expect(estimateRunCredits(known)).not.toBeNull();
  expect(
    estimateRunCredits({ ...known, tasks: [taskFixture({ usage: first, reportedModel: null })] }),
  ).toBeNull();
  expect(
    estimateRunCredits({ ...known, usage: { ...first, cachedInputTokens: 168_687 } }),
  ).toBeNull();
  expect(
    estimateRunCredits({ ...known, tasks: [taskFixture({ usage: { ...first, totalTokens: 1 } })] }),
  ).toBeNull();
  expect(
    estimateRunCredits({
      ...known,
      usage: { ...first, cacheWriteInputTokens: 1 },
      tasks: [taskFixture({ usage: { ...first, cacheWriteInputTokens: 2 } })],
    }),
  ).toBeNull();
});
