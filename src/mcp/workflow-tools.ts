import { z } from 'zod';
import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DatabaseSync } from 'node:sqlite';
import type { LeadContext } from '../activation/types.js';
import { capacitySchema, leadResultSchema, startSchema } from '../contracts/schema.js';
import type { DaemonCall } from '../local/client.js';
import type { ContextResolver } from './panel-server.js';
import { assertRoutedContext } from './panel-owner.js';

export type WorkflowTools = {
  server: McpServer;
  dataDir: string;
  resolver: ContextResolver;
  bindings: DatabaseSync;
  call: DaemonCall;
};
type Access = { contextKey?: string | undefined; nonce?: string | undefined };
const accessShape = {
  contextKey: z.string().min(1).optional(),
  nonce: z.string().min(1).optional(),
};

async function lead(
  options: WorkflowTools,
  contextKey: string,
  metadata?: unknown,
): Promise<LeadContext> {
  const context = await options.resolver(contextKey, options.dataDir);
  assertRoutedContext(metadata, context.sessionId);
  if (context.resolutionStatus !== 'verified') throw new Error(context.resolutionReason);
  return context;
}

async function owner(options: WorkflowTools, access: Access, metadata?: unknown) {
  if (Boolean(access.contextKey) === Boolean(access.nonce))
    throw new Error('Supply exactly one chat context or panel nonce');
  if (access.contextKey) {
    const { instanceId, sessionId } = await lead(options, access.contextKey, metadata);
    return { instanceId, sessionId };
  }
  const row = options.bindings
    .prepare("SELECT owner FROM bindings WHERE nonce=? AND state='bound'")
    .get(access.nonce!);
  if (!row || typeof row.owner !== 'string')
    throw new Error('Panel is not bound to a verified chat');
  const [instanceId, sessionId, extra] = row.owner.split('\u0000');
  if (!instanceId || !sessionId || extra !== undefined) throw new Error('Invalid panel ownership');
  return { instanceId, sessionId };
}

async function result(action: () => Promise<unknown>) {
  try {
    const data = await action();
    const structuredContent =
      data && typeof data === 'object' && !Array.isArray(data)
        ? (data as Record<string, unknown>)
        : { result: data };
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(structuredContent) }],
      structuredContent,
    };
  } catch (error) {
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: error instanceof Error ? error.message : 'Workflow request failed',
        },
      ],
    };
  }
}

function registerReadTools(options: WorkflowTools): void {
  registerAppTool(
    options.server,
    'ultra_status',
    {
      title: 'Read workflow progress',
      description: 'Read compact workflow state for this verified chat without model calls.',
      inputSchema: { ...accessShape, runIds: z.array(z.string()).max(1_000).optional() },
      _meta: { ui: { visibility: ['model', 'app'] } },
    },
    (input, extra) =>
      result(async () =>
        options.call('status', {
          owner: await owner(options, input, extra._meta),
          runIds: input.runIds,
        }),
      ),
  );
  registerAppTool(
    options.server,
    'ultra_result',
    {
      title: 'Read workflow results',
      description:
        'Read selected saved results, evidence and usage; completion does not imply acceptance.',
      inputSchema: { ...accessShape, runId: z.string(), taskId: z.string().optional() },
      _meta: { ui: { visibility: ['model', 'app'] } },
    },
    (input, extra) =>
      result(async () =>
        options.call('result', {
          owner: await owner(options, input, extra._meta),
          runId: input.runId,
          taskId: input.taskId,
        }),
      ),
  );
  options.server.registerTool(
    'ultra_wait',
    {
      title: 'Wait for workflow changes',
      description:
        'Wait up to 25 seconds across this chat’s workflows for meaningful events. Idle waits require no worker or inference calls.',
      inputSchema: {
        contextKey: z.string(),
        afterCursor: z.number().int().nonnegative(),
        runIds: z.array(z.string()).max(1_000).optional(),
        timeoutMs: z.number().int().min(0).max(25_000).optional(),
      },
    },
    (input, extra) =>
      result(async () =>
        options.call('wait', {
          owner: await owner(options, input, extra._meta),
          afterCursor: input.afterCursor,
          runIds: input.runIds,
          timeoutMs: input.timeoutMs,
        }),
      ),
  );
}

function registerStart(options: WorkflowTools): void {
  options.server.registerTool(
    'ultra_start',
    {
      title: 'Start an Ultra Code workflow',
      description:
        'Start a quality-first dynamic workflow for substantive Ultra work. Workers inherit the captured lead model/effort unless overridden. Supply observed session capacity, reserving the lead and occupied slots; this is local admission, not a host-wide reservation. Keep conversation and trivial mechanical edits direct.',
      inputSchema: { ...startSchema.shape, capacity: capacitySchema },
    },
    (input, extra) =>
      result(async () => {
        const { capacity, ...request } = input;
        const context = await lead(options, request.contextKey, extra._meta);
        return options.call('start', { request, authority: { context, capacity } });
      }),
  );
}

async function controlOwner(
  options: WorkflowTools,
  contextKey: string,
  action: string,
  metadata?: unknown,
) {
  const context = await lead(options, contextKey, metadata);
  if (action === 'resume' && context.collaborationMode !== 'default')
    throw new Error('A verified Default-mode turn is required to resume execution');
  return { instanceId: context.instanceId, sessionId: context.sessionId };
}

function registerPanelControl(options: WorkflowTools): void {
  registerAppTool(
    options.server,
    'ultra_panel_control',
    {
      title: 'Control one workflow from its panel',
      description: 'Apply an explicit panel action to its bound chat’s workflow.',
      inputSchema: {
        nonce: z.string().min(1),
        runId: z.string(),
        action: z.enum(['pause', 'resume', 'cancel']),
      },
      _meta: { ui: { visibility: ['app'] } },
    },
    (input) =>
      result(async () =>
        options.call('control', {
          owner: await owner(options, { nonce: input.nonce }),
          runId: input.runId,
          action: input.action,
        }),
      ),
  );
}

function registerControl(options: WorkflowTools): void {
  registerPanelControl(options);
  registerAppTool(
    options.server,
    'ultra_control',
    {
      title: 'Control one workflow',
      description:
        'Pause new dispatch, resume, or cancel only this run. Cancellation preserves edits and uncertain writes.',
      inputSchema: {
        contextKey: z.string().min(1),
        runId: z.string(),
        action: z.enum(['pause', 'resume', 'cancel']),
      },
      _meta: { ui: { visibility: ['model'] } },
    },
    (input, extra) =>
      result(async () =>
        options.call('control', {
          owner: await controlOwner(options, input.contextKey, input.action, extra._meta),
          runId: input.runId,
          action: input.action,
        }),
      ),
  );
  options.server.registerTool(
    'ultra_handoff',
    {
      title: 'Claim or resolve a lead decision',
      description:
        'Atomically claim a handoff for the current verified turn, or resolve with evidence. An uncertain external action requires readback before resolution; never repeat it automatically.',
      inputSchema: {
        contextKey: z.string(),
        id: z.string(),
        action: z.enum(['claim', 'resolve']),
        resolution: leadResultSchema.optional(),
      },
    },
    (input, extra) =>
      result(async () => {
        const context = await lead(options, input.contextKey, extra._meta);
        return options.call('handoff', {
          owner: { instanceId: context.instanceId, sessionId: context.sessionId },
          id: input.id,
          action: input.action,
          context,
          resolution: input.resolution,
        });
      }),
  );
}

export function registerWorkflowTools(options: WorkflowTools): void {
  registerStart(options);
  registerReadTools(options);
  registerControl(options);
}
