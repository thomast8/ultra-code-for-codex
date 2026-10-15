import packageMetadata from '../../package.json' with { type: 'json' };
import { z } from 'zod';
import type { StartRequest, LeadResult } from '../contracts/workflow.js';
import type { LeadContext } from '../activation/types.js';
import { capacitySchema, leadResultSchema, startSchema } from '../contracts/schema.js';
import type { WorkflowEngine } from '../runtime/engine.js';

const ownerSchema = z.object({ instanceId: z.string().min(1), sessionId: z.string().min(1) });
const contextSchema = ownerSchema.extend({
  turnId: z.string().min(1),
  cwd: z.string().min(1),
  model: z.string().min(1),
  effort: z.string().min(1),
  collaborationMode: z.enum(['default', 'plan', 'unknown']),
  resolutionStatus: z.literal('verified'),
  resolutionReason: z.string(),
});
const selectSchema = z.object({
  owner: ownerSchema,
  runIds: z.array(z.string()).max(1_000).optional(),
});
const eventSchema = selectSchema.extend({
  afterCursor: z.number().int().nonnegative(),
  timeoutMs: z.number().int().min(0).max(25_000).optional(),
});
const taskSchema = z.object({
  owner: ownerSchema,
  runId: z.string(),
  taskId: z.string().optional(),
});
const controlSchema = taskSchema.extend({ action: z.enum(['pause', 'resume', 'cancel']) });
const handoffSchema = z.object({
  owner: ownerSchema,
  id: z.string(),
  action: z.enum(['claim', 'resolve']),
  context: contextSchema,
  resolution: leadResultSchema.optional(),
});
const createSchema = z.object({
  request: startSchema,
  authority: z.object({ context: contextSchema, capacity: capacitySchema }),
});
export type CapabilitiesReader = (instanceId: string, cwd: string) => Promise<unknown>;
const capabilitiesSchema = z.object({ owner: ownerSchema, cwd: z.string().min(1) });

export type EngineService = Pick<
  WorkflowEngine,
  'start' | 'status' | 'result' | 'control' | 'events' | 'currentCursor' | 'handoff'
>;

async function waitForEvents(engine: EngineService, value: unknown): Promise<unknown> {
  const { owner, runIds, afterCursor, timeoutMs = 15_000 } = eventSchema.parse(value);
  const deadline = Date.now() + timeoutMs;
  let cursor = afterCursor;
  do {
    const batch = engine.events(owner, cursor, runIds);
    cursor = batch.cursor;
    const events = batch.events.filter(
      (event) => !['worker.activity', 'worker.usage'].includes(event.type),
    );
    if (events.length || Date.now() >= deadline) return { cursor, events };
    await new Promise((resolve) => setTimeout(resolve, Math.min(200, deadline - Date.now())));
  } while (Date.now() <= deadline);
  return { cursor, events: [] };
}

function read(engine: EngineService, method: string, params: unknown): unknown {
  if (method === 'status') {
    const { owner, runIds } = selectSchema.parse(params);
    return { runs: engine.status(owner, runIds), cursor: engine.currentCursor(owner, runIds) };
  }
  if (method === 'result') {
    const { owner, runId, taskId } = taskSchema.parse(params);
    return engine.result(owner, runId, taskId);
  }
  const { owner, runIds, afterCursor } = eventSchema.parse(params);
  return engine.events(owner, afterCursor, runIds);
}

function mutate(engine: EngineService, method: string, params: unknown): unknown {
  if (method === 'start') {
    const { request, authority } = createSchema.parse(params);
    return engine.start(request as StartRequest, authority);
  }
  if (method === 'control') {
    const { owner, runId, action } = controlSchema.parse(params);
    return engine.control(owner, runId, action);
  }
  const { owner, id, action, context, resolution } = handoffSchema.parse(params);
  return engine.handoff(
    owner,
    id,
    action,
    context as LeadContext,
    resolution as LeadResult | undefined,
  );
}

export function routeDaemon(
  engine: EngineService,
  method: string,
  params: unknown,
  capabilities?: CapabilitiesReader,
): Promise<unknown> {
  if (method === 'capabilities') {
    if (!capabilities) return Promise.reject(new Error('Worker capability reader unavailable'));
    const { owner, cwd } = capabilitiesSchema.parse(params);
    return capabilities(owner.instanceId, cwd);
  }
  if (method === 'health')
    return Promise.resolve({
      protocol: 'ultra-daemon-v1',
      version: packageMetadata.version,
      pid: process.pid,
    });
  if (method === 'wait') return waitForEvents(engine, params);
  if (['status', 'result', 'events'].includes(method))
    return Promise.resolve(read(engine, method, params));
  if (['start', 'control', 'handoff'].includes(method))
    return Promise.resolve(mutate(engine, method, params));
  return Promise.reject(new Error('Unknown Ultra Code runtime operation'));
}
