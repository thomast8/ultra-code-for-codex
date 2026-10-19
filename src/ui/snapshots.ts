import { z } from 'zod';
import type { RunSnapshot } from '../contracts/workflow.js';

function presentFields<T extends Record<string, unknown>>(
  value: T,
): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as {
    [K in keyof T]: Exclude<T[K], undefined>;
  };
}

const phase = z.object({ id: z.string(), label: z.string() });
const artifact = z
  .object({
    id: z.string(),
    description: z.string(),
    uri: z.string().optional(),
    revision: z.string().optional(),
  })
  .transform(presentFields);
const usage = z
  .object({
    inputTokens: z.number().nonnegative(),
    cachedInputTokens: z.number().nonnegative(),
    cacheWriteInputTokens: z.number().nonnegative().optional(),
    outputTokens: z.number().nonnegative(),
    reasoningOutputTokens: z.number().nonnegative(),
    totalTokens: z.number().nonnegative(),
  })
  .transform(presentFields)
  .nullable();
const acceptance = z.enum(['satisfied', 'incomplete', 'blocked', 'unverified']);
const assessment = z.object({
  difficulty: z.string(),
  uncertainty: z.string(),
  consequence: z.string(),
  verificationBurden: z.string(),
  modelRationale: z.string(),
  delegationBenefit: z.string(),
  coordinationOverhead: z.string(),
});
const task = z
  .object({
    id: z.string(),
    title: z.string(),
    phase,
    state: z.enum([
      'queued',
      'waiting',
      'running',
      'completed',
      'failed',
      'cancelled',
      'needs_reconciliation',
    ]),
    waitingReason: z.string().nullable(),
    requestedModel: z.string(),
    reportedModel: z.string().nullable(),
    effort: z.string(),
    reportedEffort: z.string().optional(),
    assessment: assessment.optional(),
    createdAt: z.number(),
    startedAt: z.number().nullable(),
    finishedAt: z.number().nullable(),
    lastActivityAt: z.number(),
    lastActivity: z.string().nullable(),
    usage,
    result: z
      .object({
        execution: z.enum(['completed', 'failed', 'interrupted', 'uncertain']),
        acceptance,
        value: z.json(),
        evidence: z.array(artifact),
        unresolved: z.array(z.string()),
        usage,
        requestedModel: z.string(),
        reportedModel: z.string().nullable(),
        error: z.string().optional(),
      })
      .transform(presentFields)
      .nullable(),
  })
  .transform(presentFields);
const resource = z
  .object({
    key: z.string(),
    mode: z.enum(['read', 'write']),
    path: z.string().optional(),
    identity: z.object({ dev: z.number(), ino: z.number() }).optional(),
  })
  .transform(presentFields);
const handoff = z.object({
  id: z.string(),
  state: z.enum(['pending', 'claimed', 'resolved', 'needs_reconciliation']),
  spec: z
    .object({
      phase,
      objective: z.string(),
      resources: z.array(resource),
      evidence: z.array(artifact),
      revision: z.string().optional(),
    })
    .transform(presentFields),
  claimedTurnId: z.string().nullable(),
  result: z
    .object({
      acceptance: z.enum(['satisfied', 'incomplete', 'blocked']),
      value: z.json(),
      evidence: z.array(artifact),
      revision: z.string().optional(),
    })
    .transform(presentFields)
    .nullable(),
});
const run: z.ZodType<RunSnapshot> = z
  .object({
    id: z.string(),
    attemptKind: z.enum(['follow-up', 'repair']).optional(),
    continuationOf: z
      .object({
        runId: z.string(),
        taskId: z.string(),
        kind: z.enum(['follow-up', 'repair']),
      })
      .optional(),
    title: z.string(),
    objective: z.string(),
    state: z.enum([
      'queued',
      'running',
      'paused',
      'cancelled',
      'completed',
      'failed',
      'needs_reconciliation',
    ]),
    parentRunId: z.string().nullable(),
    createdAt: z.number(),
    updatedAt: z.number(),
    finishedAt: z.number().nullable(),
    acceptance: z.array(z.string()),
    acceptanceOutcome: acceptance,
    phases: z.array(phase),
    tasks: z.array(task),
    handoffs: z.array(handoff),
    leadReviews: z
      .array(
        z.object({
          handoffId: z.string(),
          startedAt: z.number(),
          finishedAt: z.number().nullable(),
        }),
      )
      .optional(),
    usage,
    budget: z.object({ maxObservedTokens: z.number().int().positive() }).optional(),
    accountingComplete: z.boolean(),
    result: z.json(),
    error: z.string().nullable(),
  })
  .transform(presentFields);

export const workflowSnapshot = z.object({
  runs: z.array(run),
  cursor: z.number().int().nonnegative(),
});
