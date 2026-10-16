import type { RunSnapshot, TokenUsage } from '../contracts/workflow.js';

export const RATE_CARD_URL =
  'https://help.openai.com/en/articles/11481834-chatgpt-rate-card-business-enterpriseedu-credit-based-pricing';

const rates: Record<string, { name: string; input: number; cached: number; output: number }> = {
  'gpt-6-luna': { name: 'GPT-6 Luna', input: 2.5, cached: 0.25, output: 12.5 },
  'gpt-6-sol': { name: 'GPT-6 Sol', input: 50, cached: 5, output: 250 },
  'gpt-6.1-sol': { name: 'GPT-6.1 Sol', input: 50, cached: 2.5, output: 250 },
  'gpt-6-astra': { name: 'GPT-6 Astra', input: 250, cached: 25, output: 1250 },
  'gpt-5.6-sol': { name: 'GPT-5.6 Sol', input: 100, cached: 10, output: 500 },
  'gpt-5.6-terra': { name: 'GPT-5.6 Terra', input: 50, cached: 5, output: 300 },
  'gpt-5.6-luna': { name: 'GPT-5.6 Luna', input: 5, cached: 0.5, output: 30 },
};

const usageFields = [
  'inputTokens',
  'cachedInputTokens',
  'outputTokens',
  'reasoningOutputTokens',
  'totalTokens',
] as const;

export type CreditEstimate = {
  minimum: number;
  maximum: number;
  models: string[];
  cacheWritesKnown: boolean;
};

export function validUsage(usage: TokenUsage): boolean {
  const writes = usage.cacheWriteInputTokens;
  return (
    usageFields.every((field) => Number.isSafeInteger(usage[field]) && usage[field] >= 0) &&
    (writes === undefined || (Number.isSafeInteger(writes) && writes >= 0)) &&
    usage.cachedInputTokens <= usage.inputTokens &&
    usage.reasoningOutputTokens <= usage.outputTokens &&
    (writes ?? 0) <= usage.inputTokens - usage.cachedInputTokens &&
    usage.totalTokens === usage.inputTokens + usage.outputTokens
  );
}

function estimateWorker(usage: TokenUsage, model: string | null): CreditEstimate | null {
  const rate = model ? rates[model] : undefined;
  if (!rate || !validUsage(usage)) return null;
  const uncached = usage.inputTokens - usage.cachedInputTokens;
  const common = usage.cachedInputTokens * rate.cached + usage.outputTokens * rate.output;
  const writes = usage.cacheWriteInputTokens;
  return {
    minimum: (common + (writes === undefined ? 0 : uncached - writes) * rate.input) / 1e6,
    maximum: (common + (uncached - (writes ?? 0)) * rate.input) / 1e6,
    models: [rate.name],
    cacheWritesKnown: writes !== undefined,
  };
}

function writesMatch(run: RunSnapshot, allKnown: boolean): boolean {
  const expected = run.usage?.cacheWriteInputTokens;
  if (expected === undefined) return true;
  if (!allKnown) return false;
  return (
    run.tasks.reduce((total, task) => total + (task.usage?.cacheWriteInputTokens ?? 0), 0) ===
    expected
  );
}

function totalsMatch(
  run: RunSnapshot,
  sum: Record<(typeof usageFields)[number], number>,
  allWritesKnown: boolean,
): boolean {
  const usage = run.usage;
  return (
    Boolean(usage) &&
    usageFields.every((field) => sum[field] === usage?.[field]) &&
    writesMatch(run, allWritesKnown)
  );
}

export function estimateRunCredits(run: RunSnapshot): CreditEstimate | null {
  const runUsage = run.usage;
  if (!runUsage || !validUsage(runUsage)) return null;
  const sum = Object.fromEntries(usageFields.map((field) => [field, 0])) as Record<
    (typeof usageFields)[number],
    number
  >;
  const estimate: CreditEstimate = {
    minimum: 0,
    maximum: 0,
    models: [],
    cacheWritesKnown: true,
  };
  for (const task of run.tasks) {
    if (!task.usage) continue;
    const worker = estimateWorker(task.usage, task.reportedModel);
    if (!worker) return null;
    for (const field of usageFields) sum[field] += task.usage[field];
    estimate.minimum += worker.minimum;
    estimate.maximum += worker.maximum;
    estimate.cacheWritesKnown &&= worker.cacheWritesKnown;
    if (!estimate.models.includes(worker.models[0]!)) estimate.models.push(worker.models[0]!);
  }
  if (!totalsMatch(run, sum, estimate.cacheWritesKnown)) return null;
  return estimate;
}

export function creditLabel(estimate: CreditEstimate): string {
  const format = (value: number) => value.toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
  const minimum = format(estimate.minimum);
  const maximum = format(estimate.maximum);
  return `${minimum}${minimum === maximum ? '' : `–${maximum}`} credits`;
}
