import './check-runtime.mjs';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';

const usage = z.object({
  inputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  reasoningOutputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
});
const attempt = z.object({
  model: z.string().min(1),
  usage: usage.nullable(),
  actualCharge: z.number().nonnegative().nullable(),
  evidence: z.string().min(1),
});
const arm = z.object({
  acceptancePassed: z.boolean(),
  missedFindings: z.number().int().nonnegative(),
  retries: z.number().int().nonnegative(),
  rework: z.string(),
  elapsedMs: z.number().nonnegative(),
  attempts: z.array(attempt).min(1),
  coordinationUsage: usage.nullable(),
});
const schema = z.object({
  frozenTask: z.string().min(1),
  protocol: z.string().min(1),
  direct: arm,
  orchestrated: arm,
});

function summarize(value) {
  const observations = value.attempts.map((item) => item.usage);
  const known = observations.filter((item) => item !== null);
  const charges = value.attempts.map((item) => item.actualCharge);
  return {
    ...value,
    observedWorkerTokens: known.reduce((sum, item) => sum + item.totalTokens, 0),
    workerAccountingComplete: known.length === observations.length,
    totalAccountingComplete:
      known.length === observations.length && value.coordinationUsage !== null,
    observedCharge: charges.every((charge) => charge !== null)
      ? charges.reduce((sum, charge) => sum + charge, 0)
      : null,
  };
}

export function evaluate(value) {
  const parsed = schema.parse(value);
  const direct = summarize(parsed.direct);
  const orchestrated = summarize(parsed.orchestrated);
  const qualified = [direct, orchestrated].every(
    (arm) => arm.acceptancePassed && arm.missedFindings === 0,
  );
  return {
    frozenTask: parsed.frozenTask,
    protocol: parsed.protocol,
    direct,
    orchestrated,
    decision: qualified
      ? 'Both meet this case quality bar. A single pair and partial or model-dependent usage do not establish cheaper routing; keep selective delegation and repeat uncertain comparisons.'
      : 'Quality bar failed for at least one arm. Do not adopt that routing based on token count.',
    billingNote:
      'Cached input is included in input; reasoning output is included in output. Token totals are not billed money. Shared lead overhead remains separate.',
  };
}

if (process.argv[2]) {
  console.log(
    JSON.stringify(evaluate(JSON.parse(await readFile(process.argv[2], 'utf8'))), null, 2),
  );
} else {
  console.error(
    'Provide a frozen paired-results JSON file: just evaluate-routing path/to/results.json. This command validates and reports evidence; it never starts model calls.',
  );
  process.exitCode = 2;
}
