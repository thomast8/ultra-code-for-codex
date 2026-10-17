import { randomBytes } from 'node:crypto';
import packageMetadata from '../../package.json' with { type: 'json' };
import { readFile } from 'node:fs/promises';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import type { LeadContext } from '../activation/types.js';
import {
  assertRoutedContext,
  requestMetadataKind,
  restorePanelOwner,
  currentPanelContextKey,
} from './panel-owner.js';
import type { DaemonCall } from '../local/client.js';
import { registerWorkflowTools } from './workflow-tools.js';
import {
  withRuntimeCapability,
  withContextCapabilities,
  RUNTIME_UNVERIFIED,
} from './capability.js';

const PANEL_URI = 'ui://ultra-code/panel.html';

export type ContextResolver = (contextKey: string, dataDir: string) => Promise<LeadContext>;
export type PanelHtmlLoader = () => Promise<string>;

function resolveForCaller(resolver: ContextResolver, metadata: unknown): ContextResolver {
  return async (key, dataDir) => {
    const context = await resolver(key, dataDir);
    assertRoutedContext(metadata, context.sessionId);
    return context;
  };
}

const bindingSchema = z.object({
  nonce: z.string(),
  state: z.enum(['pending', 'binding', 'bound', 'failed']),
  owner: z.string().nullable(),
});
type PendingBinding = z.infer<typeof bindingSchema>;

function openBindings(dataDir: string): DatabaseSync {
  const directory = join(dataDir, 'panel');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, 'bindings.sqlite');
  closeSync(openSync(path, 'a', 0o600));
  const database = new DatabaseSync(path, { timeout: 5_000 });
  database.exec(`CREATE TABLE IF NOT EXISTS bindings (
    nonce TEXT PRIMARY KEY,
    state TEXT NOT NULL CHECK (state IN ('pending', 'binding', 'bound', 'failed')),
    owner TEXT
  )`);
  return database;
}

export function createPanelServer(
  resolveContext: ContextResolver,
  dataDir: string,
  loadPanelHtml: PanelHtmlLoader = () => readFile(new URL('./panel.html', import.meta.url), 'utf8'),
  runtime?: DaemonCall,
): McpServer {
  const server = new McpServer({ name: 'ultra-code-for-codex', version: packageMetadata.version });
  const bindings = openBindings(dataDir);
  const close = server.server.onclose;
  server.server.onclose = () => {
    close?.();
    if (bindings.isOpen) bindings.close();
  };

  registerPanelView(server, bindings, loadPanelHtml, resolveContext, dataDir, runtime);
  registerPanelStatus(server, bindings);

  registerAppTool(
    server,
    'ultra_panel_bind',
    {
      title: 'Bind Ultra Code panel',
      description: 'Bind a panel one-time nonce to an exact verified activation context.',
      inputSchema: { contextKey: z.string().min(1), nonce: z.string().min(1) },
      _meta: { ui: { resourceUri: PANEL_URI } },
    },
    async ({ contextKey, nonce }, extra) => {
      const bound = await bindPanel(
        bindings,
        nonce,
        contextKey,
        resolveForCaller(resolveContext, extra._meta),
        dataDir,
      );
      return withRuntimeCapability(
        {
          ...bound,
          structuredContent: { ...bound.structuredContent, bindingNonce: nonce },
        },
        runtime,
      );
    },
  );

  registerContextTool(server, resolveContext, dataDir, runtime);
  if (runtime)
    registerWorkflowTools({ server, bindings, resolver: resolveContext, dataDir, call: runtime });
  return server;
}

function registerPanelResource(server: McpServer, loadPanelHtml: PanelHtmlLoader): void {
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
}

function registerPanelView(
  server: McpServer,
  bindings: DatabaseSync,
  loadPanelHtml: PanelHtmlLoader,
  resolveContext: ContextResolver,
  dataDir: string,
  runtime?: DaemonCall,
) {
  registerPanelResource(server, loadPanelHtml);

  registerAppTool(
    server,
    'ultra_panel',
    {
      title: 'Open Ultra Code panel',
      description:
        'Open Ultra Code beside the chat with its verified contextKey. Manual launches also bind automatically when exact verified chat routing is available.',
      inputSchema: { contextKey: z.string().min(1).optional() },
      _meta: {
        ui: { resourceUri: PANEL_URI },
        'openai/ui': { entrypoints: [{ type: 'thread' }] },
      },
    },
    async ({ contextKey }, extra) => {
      const nonce = randomBytes(24).toString('base64url');
      bindings.prepare("INSERT INTO bindings (nonce, state) VALUES (?, 'pending')").run(nonce);
      const openInPanel = Boolean(contextKey);
      contextKey ??= await currentPanelContextKey(dataDir, extra._meta, resolveContext);
      if (contextKey) {
        const result = await withRuntimeCapability(
          await bindPanel(
            bindings,
            nonce,
            contextKey,
            resolveForCaller(resolveContext, extra._meta),
            dataDir,
          ),
          runtime,
        );
        return {
          ...result,
          structuredContent: { ...result.structuredContent, bindingNonce: nonce, openInPanel },
        };
      }
      const sessionId = restorePanelOwner(bindings, nonce, dataDir, extra._meta);
      if (sessionId) {
        return withRuntimeCapability(
          {
            content: [{ type: 'text', text: 'Panel restored to this chat’s saved binding.' }],
            structuredContent: {
              bindingNonce: nonce,
              bound: true,
              sessionId,
              capabilityAvailability: 'unavailable',
              capabilityReason: RUNTIME_UNVERIFIED,
            },
          },
          runtime,
        );
      }
      return withRuntimeCapability(
        {
          content: [
            {
              type: 'text',
              text: `${RUNTIME_UNVERIFIED} Ask the user to choose “Show this chat’s workflows” to bind this panel.`,
            },
          ],
          structuredContent: {
            bindingNonce: nonce,
            capabilityAvailability: 'unavailable',
            capabilityReason: RUNTIME_UNVERIFIED,
          },
        },
        runtime,
      );
    },
  );
}

function registerPanelStatus(server: McpServer, bindings: DatabaseSync) {
  registerAppTool(
    server,
    'ultra_panel_status',
    {
      title: 'Read Ultra Code panel binding',
      description: 'Read this panel nonce state without binding it or exposing chat metadata.',
      inputSchema: { nonce: z.string().min(1) },
      _meta: { ui: { visibility: ['app'] } },
    },
    async ({ nonce }) => {
      const row = bindings
        .prepare('SELECT nonce, state, owner FROM bindings WHERE nonce = ?')
        .get(nonce);
      if (!row) return failure('Unknown or expired panel nonce. Open the panel again.');
      const { state } = bindingSchema.parse(row);
      return {
        content: [{ type: 'text', text: `Panel binding state: ${state}.` }],
        structuredContent: { state },
      };
    },
  );
}

function registerContextTool(
  server: McpServer,
  resolveContext: ContextResolver,
  dataDir: string,
  runtime?: DaemonCall,
) {
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
        capabilityAvailability: z.enum(['available', 'unavailable']),
        capabilityReason: z.string(),
        executionCapabilities: z.unknown().optional(),
        requestMetadataKind: z.enum(['absent', 'generic', 'routed']),
      },
    },
    async ({ contextKey }, extra) => {
      try {
        const context = await resolveForCaller(resolveContext, extra._meta)(contextKey, dataDir);
        const message =
          context.resolutionStatus === 'verified'
            ? 'Verified exact-turn context is available.'
            : context.resolutionReason;
        return withContextCapabilities(
          {
            content: [{ type: 'text', text: `${message} ${RUNTIME_UNVERIFIED}` }],
            structuredContent: {
              ...context,
              requestMetadataKind: requestMetadataKind(extra._meta),
              capabilityAvailability: 'unavailable',
              capabilityReason: RUNTIME_UNVERIFIED,
            },
          },
          context,
          runtime,
        );
      } catch (error) {
        return failure(
          error instanceof Error ? error.message : 'Exact-turn context is unavailable.',
        );
      }
    },
  );
}

async function bindPanel(
  bindings: DatabaseSync,
  nonce: string,
  contextKey: string,
  resolveContext: ContextResolver,
  dataDir: string,
) {
  const row = bindings
    .prepare('SELECT nonce, state, owner FROM bindings WHERE nonce = ?')
    .get(nonce);
  if (!row) return failure('Unknown or expired panel nonce. Open the panel again.');
  const binding = bindingSchema.parse(row);
  if (binding.state === 'bound')
    return checkExistingBinding(binding, contextKey, resolveContext, dataDir);
  const claim = bindings
    .prepare(
      "UPDATE bindings SET state = 'binding' WHERE nonce = ? AND state = 'pending' RETURNING nonce",
    )
    .get(nonce);
  if (!claim) return failure('This panel nonce has already been used. Open the panel again.');
  return createBinding(bindings, binding, contextKey, resolveContext, dataDir);
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
  bindings: DatabaseSync,
  binding: PendingBinding,
  contextKey: string,
  resolveContext: ContextResolver,
  dataDir: string,
) {
  try {
    const context = await resolveContext(contextKey, dataDir);
    if (!isVerified(context)) {
      bindings
        .prepare("UPDATE bindings SET state = 'failed' WHERE nonce = ? AND state = 'binding'")
        .run(binding.nonce);
      return failure(context.resolutionReason || 'This chat context is not verified.');
    }
    bindings
      .prepare(
        "UPDATE bindings SET state = 'bound', owner = ? WHERE nonce = ? AND state = 'binding'",
      )
      .run(ownerOf(context), binding.nonce);
    return boundResult(
      context,
      `Panel bound to verified chat ${context.sessionId}, turn ${context.turnId}.`,
    );
  } catch (error) {
    bindings
      .prepare("UPDATE bindings SET state = 'failed' WHERE nonce = ? AND state = 'binding'")
      .run(binding.nonce);
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
    content: [{ type: 'text' as const, text: `${message} ${RUNTIME_UNVERIFIED}` }],
    structuredContent: {
      bound: true,
      sessionId: context.sessionId,
      turnId: context.turnId,
      capabilityAvailability: 'unavailable',
      capabilityReason: RUNTIME_UNVERIFIED,
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
