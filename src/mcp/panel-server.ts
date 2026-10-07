import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import type { LeadContext } from '../activation/types.js';

const PANEL_URI = 'ui://ultra-code/panel.html';
const PROBE_LIMIT =
  'Compatibility probe; workflow execution is unavailable until the Desktop gate passes.';

export type ContextResolver = (contextKey: string, dataDir: string) => Promise<LeadContext>;
export type PanelHtmlLoader = () => Promise<string>;

interface PendingBinding {
  state: 'pending' | 'binding' | 'bound' | 'failed';
  owner?: string;
}

export function createPanelServer(
  resolveContext: ContextResolver,
  dataDir: string,
  loadPanelHtml: PanelHtmlLoader = () => readFile(new URL('./panel.html', import.meta.url), 'utf8'),
): McpServer {
  const server = new McpServer({ name: 'ultra-code-for-codex', version: '0.1.2' });
  const bindings = new Map<string, PendingBinding>();

  registerPanelView(server, bindings, loadPanelHtml);

  registerAppTool(
    server,
    'ultra_panel_bind',
    {
      title: 'Bind Ultra Code panel',
      description: 'Bind a panel one-time nonce to an exact verified activation context.',
      inputSchema: { contextKey: z.string().min(1), nonce: z.string().min(1) },
      _meta: { ui: { resourceUri: PANEL_URI } },
    },
    async ({ contextKey, nonce }) => {
      return bindPanel(bindings.get(nonce), contextKey, resolveContext, dataDir);
    },
  );

  registerContextTool(server, resolveContext, dataDir);
  return server;
}

function registerPanelView(
  server: McpServer,
  bindings: Map<string, PendingBinding>,
  loadPanelHtml: PanelHtmlLoader,
) {
  server.registerResource(
    'ultra-panel',
    PANEL_URI,
    {
      title: 'Ultra Code panel',
      description: 'Explicit chat binding control for Ultra Code workflows.',
      mimeType: 'text/html;profile=mcp-app',
    },
    async () => ({
      contents: [
        { uri: PANEL_URI, mimeType: 'text/html;profile=mcp-app', text: await loadPanelHtml() },
      ],
    }),
  );

  registerAppTool(
    server,
    'ultra_panel',
    {
      title: 'Open Ultra Code panel',
      description:
        'Open the local Ultra Code panel. The user must explicitly bind it to this chat.',
      inputSchema: {},
      _meta: {
        ui: { resourceUri: PANEL_URI },
        'openai/ui': { entrypoints: [{ type: 'thread' }] },
      },
    },
    async () => {
      const nonce = randomBytes(24).toString('base64url');
      bindings.set(nonce, { state: 'pending' });
      return {
        content: [
          {
            type: 'text',
            text: `${PROBE_LIMIT} Ask the user to choose “Show this chat’s workflows” to bind this panel.`,
          },
        ],
        structuredContent: {
          bindingNonce: nonce,
          capabilityAvailability: 'unavailable',
          capabilityReason: PROBE_LIMIT,
        },
      };
    },
  );
}

function registerContextTool(server: McpServer, resolveContext: ContextResolver, dataDir: string) {
  server.registerTool(
    'ultra_context',
    {
      title: 'Read exact-turn Ultra Code context',
      description:
        'Resolve the exact-turn activation handle from the current hook. This does not bind a panel or infer another session.',
      inputSchema: { contextKey: z.string().min(1) },
      outputSchema: {
        instanceId: z.string(),
        sessionId: z.string(),
        turnId: z.string(),
        cwd: z.string(),
        model: z.string(),
        effort: z.string(),
        collaborationMode: z.string(),
        resolutionStatus: z.enum(['verified', 'unknown']),
        resolutionReason: z.string(),
        capabilityAvailability: z.literal('unavailable'),
        capabilityReason: z.string(),
      },
    },
    async ({ contextKey }) => {
      try {
        const context = await resolveContext(contextKey, dataDir);
        const message =
          context.resolutionStatus === 'verified'
            ? 'Verified exact-turn context is available.'
            : context.resolutionReason;
        return {
          content: [{ type: 'text', text: `${message} ${PROBE_LIMIT}` }],
          structuredContent: {
            ...context,
            capabilityAvailability: 'unavailable',
            capabilityReason: PROBE_LIMIT,
          },
        };
      } catch (error) {
        return failure(
          error instanceof Error ? error.message : 'Exact-turn context is unavailable.',
        );
      }
    },
  );
}

async function bindPanel(
  binding: PendingBinding | undefined,
  contextKey: string,
  resolveContext: ContextResolver,
  dataDir: string,
) {
  if (!binding) return failure('Unknown or expired panel nonce. Open the panel again.');
  if (binding.state === 'bound')
    return checkExistingBinding(binding, contextKey, resolveContext, dataDir);
  if (binding.state !== 'pending')
    return failure('This panel nonce has already been used. Open the panel again.');
  binding.state = 'binding';
  return createBinding(binding, contextKey, resolveContext, dataDir);
}

async function checkExistingBinding(
  binding: PendingBinding,
  contextKey: string,
  resolveContext: ContextResolver,
  dataDir: string,
) {
  try {
    const context = await resolveContext(contextKey, dataDir);
    if (!isVerified(context))
      return failure(context.resolutionReason || 'This chat context is not verified.');
    if (binding.owner !== ownerOf(context))
      return failure('This panel nonce is already bound to another chat.');
    return boundResult(context, 'Panel is already bound to this chat.');
  } catch (error) {
    return failure(errorMessage(error));
  }
}

async function createBinding(
  binding: PendingBinding,
  contextKey: string,
  resolveContext: ContextResolver,
  dataDir: string,
) {
  try {
    const context = await resolveContext(contextKey, dataDir);
    if (!isVerified(context)) {
      binding.state = 'failed';
      return failure(context.resolutionReason || 'This chat context is not verified.');
    }
    binding.owner = ownerOf(context);
    binding.state = 'bound';
    return boundResult(
      context,
      `Panel bound to verified chat ${context.sessionId}, turn ${context.turnId}.`,
    );
  } catch (error) {
    binding.state = 'failed';
    return failure(errorMessage(error));
  }
}

function ownerOf(context: LeadContext): string {
  return `${context.instanceId}\u0000${context.sessionId}`;
}

function isVerified(context: LeadContext): boolean {
  return context.resolutionStatus === 'verified';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Exact chat context could not be verified.';
}

function boundResult(context: LeadContext, message: string) {
  return {
    content: [{ type: 'text' as const, text: `${message} ${PROBE_LIMIT}` }],
    structuredContent: {
      bound: true,
      sessionId: context.sessionId,
      turnId: context.turnId,
      capabilityAvailability: 'unavailable',
      capabilityReason: PROBE_LIMIT,
    },
  };
}

function failure(message: string) {
  return {
    isError: true,
    content: [{ type: 'text' as const, text: message }],
    structuredContent: { bound: false, reason: message },
  };
}
