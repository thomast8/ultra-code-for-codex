import { z } from 'zod';
import { createHash } from 'node:crypto';
import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DatabaseSync } from 'node:sqlite';
import packageMetadata from '../../package.json' with { type: 'json' };
import type { LeadContext } from '../activation/types.js';
import { agentV2CallDescription, leadResultSchema, startV2Schema } from '../contracts/schema.js';
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
  registerInspectTool(options);
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
          compact: !input.nonce,
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
      result(async () => {
        const saved = await options.call('result', {
          owner: await owner(options, input, extra._meta),
          runId: input.runId,
          taskId: input.taskId,
        });
        if (!input.taskId || !saved || typeof saved !== 'object') return saved;
        return {
          ...saved,
          savedReference: {
            id: input.taskId,
            description: 'Saved worker result',
            uri: `ultra://run/${input.runId}/task/${input.taskId}`,
          },
        };
      }),
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

function registerInspectTool(options: WorkflowTools): void {
  options.server.registerTool(
    'ultra_inspect',
    {
      title: 'Inspect one saved worker history',
      description:
        'Read the newest local tool history for a worker owned by this chat. Pass nextCursor to read older events; omit cursor to refresh current activity.',
      inputSchema: {
        contextKey: z.string(),
        runId: z.string(),
        taskId: z.string(),
        cursor: z.string().optional(),
      },
    },
    (input, extra) =>
      result(async () =>
        options.call('inspect', {
          owner: await owner(options, input, extra._meta),
          ...input,
        }),
      ),
  );
}

function registerStart(options: WorkflowTools): void {
  options.server.registerTool(
    'ultra_start',
    {
      title: 'Start an Ultra Code workflow',
      description: `Create a workflow; a returned run ID confirms creation only, not worker dispatch. Read ultra_status before claiming workers launched. ${agentV2CallDescription} Workers inherit verified lead model/effort unless overridden. Put local CSV and source paths in worker prompts. savedTaskRefs accepts only saved Ultra task results from ultra_result. A failed, truncated or locally sandbox-denied command inside a running worker is recoverable and is not a workflow execution or dispatch failure unless required task authority itself is unavailable. Ultra controls shared capacity and verifies worker readiness before admission.`,
      inputSchema: startV2Schema.omit({ evidenceRefs: true, reviewAfterWorkers: true }).shape,
    },
    (input, extra) =>
      result(async () => {
        const context = await lead(options, input.contextKey, extra._meta);
        await workerReady(options, context);
        const request = {
          ...input,
          contractVersion: 2 as const,
          args: input.args ?? null,
          reviewAfterWorkers: true,
        };
        return options.call('start', { request, authority: { context, capacity: hostCapacity } });
      }),
  );
  options.server.registerTool(
    'ultra_continue',
    {
      title: 'Continue a saved Ultra worker',
      description:
        'Continue one owned worker in its saved local thread. A continuation of failed work is visibly a repair.',
      inputSchema: {
        contextKey: z.string(),
        runId: z.string(),
        taskId: z.string(),
        prompt: z.string().trim().min(1).max(32_768),
      },
    },
    (input, extra) =>
      result(async () => {
        const context = await lead(options, input.contextKey, extra._meta);
        await workerReady(options, context);
        const request = {
          contractVersion: 2 as const,
          reviewAfterWorkers: true,
          requestId: createHash('sha256')
            .update(JSON.stringify([context.sessionId, input.runId, input.taskId, input.prompt]))
            .digest('hex'),
          contextKey: input.contextKey,
          title: 'Continue worker',
          objective: input.prompt,
          acceptance: ['Lead verifies continuation'],
          script: 'return await agent(args.prompt);',
          args: { prompt: input.prompt },
          maxAgentCalls: 1,
          parentRunId: input.runId,
          continuationOf: { runId: input.runId, taskId: input.taskId },
        };
        return options.call('start', { request, authority: { context, capacity: hostCapacity } });
      }),
  );
}

const hostCapacity = {
  source: 'host-profile' as const,
  totalSlots: 3 as const,
  reservedSlots: 0 as const,
  evidence: 'Ultra profile limit' as const,
};

async function workerReady(options: WorkflowTools, context: LeadContext): Promise<void> {
  const health = (await options.call('health', {})) as { version?: string };
  if (health.version !== packageMetadata.version)
    throw new Error('Ultra client and daemon versions differ; refresh the plugin connection');
  const capabilities = (await options.call('capabilities', {
    owner: { instanceId: context.instanceId, sessionId: context.sessionId },
    cwd: context.cwd,
  })) as {
    status?: string;
    blockers?: string[];
    models?: { model: string; reasoningEfforts: string[] }[];
  };
  if (capabilities.status !== 'verified-metadata')
    throw new Error(
      `Ultra workers are not ready: ${capabilities.blockers?.join('; ') || 'capability verification failed'}`,
    );
  if (
    !capabilities.models?.some(
      (item) => item.model === context.model && item.reasoningEfforts.includes(context.effort),
    )
  )
    throw new Error('Selected lead model and effort are unavailable to Ultra workers');
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
