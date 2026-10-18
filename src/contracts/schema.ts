import { isAbsolute } from 'node:path';
import { z } from 'zod';

const text = z.string().trim().min(1).max(32_768);
const identifier = z.string().min(1).max(512);
const json = z.json();
const path = text.refine(isAbsolute, 'An absolute path is required');
export const phaseSchema = z.strictObject({ id: identifier, label: text });
export const artifactSchema = z.strictObject({
  id: identifier,
  description: text,
  uri: text.optional(),
  revision: identifier.optional(),
});
export const resourceSchema = z.strictObject({
  key: identifier,
  mode: z.enum(['read', 'write']),
  path: path.optional(),
  identity: z.strictObject({ dev: z.number().int(), ino: z.number().int() }).optional(),
});
const assessmentSchema = z.strictObject({
  difficulty: text,
  uncertainty: text,
  consequence: text,
  verificationBurden: text,
  modelRationale: text,
  delegationBenefit: text,
  coordinationOverhead: text,
});
export const agentSchema = z.strictObject({
  phase: phaseSchema,
  title: text,
  assignment: z.strictObject({
    outcome: text,
    inputs: json,
    ownership: z.strictObject({ cwd: path, paths: z.array(text).max(1_000) }),
    constraints: z.array(text).max(1_000),
    acceptance: z.array(text).min(1).max(1_000),
    stopConditions: z.array(text).min(1).max(1_000),
  }),
  assessment: assessmentSchema,
  model: identifier,
  effort: identifier,
  capability: z.enum(['read-only', 'workspace-write']),
  resources: z.array(resourceSchema).max(100),
  outputSchema: z.record(z.string(), json),
  timeoutMs: z.number().int().min(1_000).max(3_600_000).optional(),
});
export const agentRequestSchema = agentSchema.extend({
  model: identifier.optional(),
  effort: identifier.optional(),
});
export const handoffSchema = z
  .strictObject({
    kind: z.enum(['action', 'planning']).optional(),
    phase: phaseSchema,
    objective: text,
    resources: z.array(resourceSchema).max(100),
    evidence: z.array(artifactSchema).max(1_000),
    revision: identifier.optional(),
  })
  .refine(
    (value) => value.kind !== 'planning' || value.resources.every((claim) => claim.mode === 'read'),
    'Planning handoffs require read-only resource claims',
  );
export const leadResultSchema = z.strictObject({
  acceptance: z.enum(['satisfied', 'incomplete', 'blocked']),
  value: json,
  evidence: z.array(artifactSchema).max(1_000),
  revision: identifier.optional(),
});
export const startSchema = z.strictObject({
  requestId: identifier,
  contextKey: identifier,
  title: text,
  objective: text,
  acceptance: z.array(text).min(1).max(1_000),
  script: z.string().min(1).max(262_144),
  args: json,
  maxAgentCalls: z.number().int().min(1).max(1_000),
  authorityRef: identifier,
  parentRunId: identifier.optional(),
  evidenceRefs: z.array(artifactSchema).max(1_000).optional(),
  budget: z.strictObject({ maxObservedTokens: z.number().int().positive() }).optional(),
});
export const capacitySchema = z
  .strictObject({
    source: z.literal('lead-session'),
    totalSlots: z.number().int().positive(),
    reservedSlots: z.number().int().min(1),
    evidence: text,
  })
  .refine((value) => value.totalSlots > value.reservedSlots, 'No worker capacity remains');

export function assertPayloadBound(value: unknown): void {
  const serialized = JSON.stringify(value);
  if (serialized === undefined || Buffer.byteLength(serialized) > 1_048_576) {
    throw new Error('Payload exceeds the one MiB limit or is not JSON');
  }
}

export const tokenUsageSchema = z.strictObject({
  inputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative(),
  cacheWriteInputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative(),
  reasoningOutputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
});
export const taskResultSchema = z.strictObject({
  execution: z.enum(['completed', 'failed', 'interrupted', 'uncertain']),
  acceptance: z.enum(['satisfied', 'incomplete', 'blocked', 'unverified']),
  value: json,
  evidence: z.array(artifactSchema).max(1_000),
  unresolved: z.array(text).max(1_000),
  usage: tokenUsageSchema.nullable(),
  requestedModel: identifier,
  reportedModel: identifier.nullable(),
  error: text.optional(),
});
