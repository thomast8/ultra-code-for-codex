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
  format: z.enum(['plain', 'json']).optional(),
  prompt: text.optional(),
  resumeThreadId: identifier.optional(),
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
  script: z
    .string()
    .min(1)
    .max(262_144)
    .describe(
      'Complete plain JavaScript function body executed in QuickJS, not prose, a path, imports or Markdown fences. Use the Ultra authoring reference. Host calls include log(message: string), phase(label: string), agent(spec) and lead(spec). Serialize structured logs with JSON.stringify(plan).',
    ),
  args: json,
  maxAgentCalls: z.number().int().min(1).max(1_000),
  authorityRef: identifier,
  parentRunId: identifier.optional(),
  evidenceRefs: z.array(artifactSchema).max(1_000).optional(),
  budget: z.strictObject({ maxObservedTokens: z.number().int().positive() }).optional(),
});
export const startV2Schema = startSchema
  .omit({ maxAgentCalls: true, authorityRef: true, args: true })
  .extend({
    contractVersion: z.literal(2).default(2),
    script: z
      .string()
      .min(1)
      .max(262_144)
      .describe(
        'JavaScript function body. Use agent(prompt, options?) with optional label, phase, cwd, access, schema, model and effort; phase(label), log(value), parallel(factories), pipeline(items, ...stages) and lead(objective, evidence?).',
      ),
    args: json.optional(),
    maxAgentCalls: z.number().int().min(1).max(1_000).optional(),
    continuationOf: z.strictObject({ runId: identifier, taskId: identifier }).optional(),
    savedTaskRefs: z
      .array(
        z.strictObject({
          id: identifier,
          description: text,
          uri: z
            .string()
            .regex(
              /^ultra:\/\/run\/[^/]+\/task\/[^/]+$/,
              'Use a saved Ultra task URI returned by ultra_result; put local files in an agent prompt',
            ),
        }),
      )
      .max(1_000)
      .optional()
      .describe(
        'Only saved results from prior Ultra tasks in this chat. Copy savedReference from ultra_result. Put CSV paths, source files, and web URLs in the agent prompt instead.',
      ),
  });
export const agentV2OptionsSchema = z.strictObject({
  label: text.optional(),
  phase: text.optional(),
  cwd: path.optional(),
  access: z.enum(['read-only', 'workspace-write']).optional(),
  schema: z.record(z.string(), json).optional(),
  model: identifier.optional(),
  effort: identifier.optional(),
});
export const agentV2Schema = z.strictObject({
  prompt: text,
  options: agentV2OptionsSchema.optional(),
});
export const leadV2Schema = z.strictObject({
  objective: text,
  evidence: z.array(artifactSchema).max(1_000).optional(),
});
export const capacitySchema = z
  .strictObject({
    source: z.literal('lead-session'),
    totalSlots: z.number().int().positive(),
    reservedSlots: z.number().int().min(1),
    evidence: text,
  })
  .refine((value) => value.totalSlots > value.reservedSlots, 'No worker capacity remains');
export const hostCapacitySchema = z.strictObject({
  source: z.literal('host-profile'),
  totalSlots: z.literal(3),
  reservedSlots: z.literal(0),
  evidence: z.literal('Ultra profile limit'),
});

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
