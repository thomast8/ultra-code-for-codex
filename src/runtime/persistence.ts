import { z } from 'zod';
import {
  agentSchema,
  capacitySchema,
  handoffSchema,
  leadResultSchema,
  phaseSchema,
  resourceSchema,
  startSchema,
  taskResultSchema,
  tokenUsageSchema,
} from '../contracts/schema.js';
import type { RunRecord } from './types.js';

const ownerSchema = z.strictObject({ instanceId: z.string().min(1), sessionId: z.string().min(1) });
const contextSchema = z.strictObject({
  instanceId: z.string().min(1),
  sessionId: z.string().min(1),
  turnId: z.string().min(1),
  cwd: z.string(),
  model: z.string(),
  effort: z.string(),
  collaborationMode: z.string(),
  resolutionStatus: z.literal('verified'),
  resolutionReason: z.string(),
});
const handoffRecord = z.strictObject({
  id: z.string(),
  state: z.enum(['pending', 'claimed', 'resolved', 'needs_reconciliation']),
  spec: handoffSchema,
  claimedTurnId: z.string().nullable(),
  result: leadResultSchema.nullable(),
});
const taskRecord = z.strictObject({
  id: z.string(),
  title: z.string(),
  phase: phaseSchema,
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
  assessment: agentSchema.shape.assessment,
  createdAt: z.number(),
  startedAt: z.number().nullable(),
  finishedAt: z.number().nullable(),
  lastActivityAt: z.number(),
  lastActivity: z.string().nullable(),
  usage: tokenUsageSchema.nullable(),
  result: taskResultSchema.nullable(),
});
const callSchema = z.strictObject({
  id: z.string(),
  kind: z.enum(['phase', 'log', 'agent', 'lead']),
  payload: z.json(),
  state: z.enum(['queued', 'dispatched', 'resolved', 'uncertain']),
  settlement: z.number().int().positive().nullable(),
  result: z.json(),
  claims: z.array(resourceSchema),
  task: taskRecord.nullable(),
  handoff: handoffRecord.nullable(),
  threadId: z.string().nullable(),
  turnId: z.string().nullable(),
  instructionSources: z.array(z.string()),
});
const snapshotSchema = z.strictObject({
  id: z.string(),
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
  acceptanceOutcome: z.enum(['satisfied', 'incomplete', 'blocked', 'unverified']),
  phases: z.array(phaseSchema),
  tasks: z.array(taskRecord),
  handoffs: z.array(handoffRecord),
  usage: tokenUsageSchema.nullable(),
  accountingComplete: z.boolean(),
  result: z.json(),
  error: z.string().nullable(),
});
const recordSchema = z.strictObject({
  version: z.literal(1),
  cancelRequested: z.boolean(),
  owner: ownerSchema,
  request: startSchema,
  requestBytes: z.string(),
  authority: z.strictObject({ context: contextSchema, capacity: capacitySchema }),
  snapshot: snapshotSchema,
  calls: z.array(callSchema),
  nextSettlement: z.number().int().positive(),
});
export function parseRecord(serialized: string): RunRecord {
  const result = recordSchema.safeParse(JSON.parse(serialized));
  if (!result.success)
    throw new Error(`Unsupported or corrupt workflow journal: ${result.error.message}`);
  const run = JSON.parse(serialized) as RunRecord;
  const identity = run.authority.context;
  if (
    run.owner.instanceId !== identity.instanceId ||
    run.owner.sessionId !== identity.sessionId ||
    run.requestBytes !== JSON.stringify(run.request)
  )
    throw new Error('Corrupt workflow owner or immutable request');
  const settlements = run.calls.flatMap((call) => (call.settlement ? [call.settlement] : []));
  if (
    new Set(settlements).size !== settlements.length ||
    settlements.length !== run.nextSettlement - 1 ||
    settlements.some((value) => value >= run.nextSettlement)
  )
    throw new Error('Corrupt workflow settlement sequence');
  run.calls.forEach((call, index) => {
    if (call.id !== `${run.snapshot.id}:${index + 1}`)
      throw new Error('Corrupt workflow call identity');
  });
  return run;
}
