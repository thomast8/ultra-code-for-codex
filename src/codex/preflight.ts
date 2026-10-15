import type { JsonValue } from './generated/serde_json/JsonValue.js';
import type { GetAccountResponse } from './generated/v2/GetAccountResponse.js';
import type { ConfigReadResponse } from './generated/v2/ConfigReadResponse.js';
import type { ModelListParams } from './generated/v2/ModelListParams.js';
import type { ModelListResponse } from './generated/v2/ModelListResponse.js';
import type { ThreadStartParams } from './generated/v2/ThreadStartParams.js';
import type { ThreadStartResponse } from './generated/v2/ThreadStartResponse.js';
import type { TurnStartParams } from './generated/v2/TurnStartParams.js';
import { CodexTransport } from './transport.js';

type ConfigRecord = Record<string, unknown>;
export type CapacityGrant = { slots: number; provenance: string };
export type SafeBackendMetadata = {
  accountType: string | null;
  planType: string | null;
  profileName: string | null;
  requiresOpenaiAuth: boolean;
  backendOrigin: string | null;
  defaultModel: string | null;
  availableModels: string[];
  namedApps: string[];
  namedMcpServers: string[];
  namedPlugins: string[];
  namedHookEvents: string[];
};
export type RestrictedPreflight = {
  metadata: SafeBackendMetadata;
  configOverlay: Record<string, JsonValue>;
  disabledPluginIds: string[];
  blockers: string[];
  eligible: boolean;
};
export type RestrictedWorker = { threadId: string; model: string; instructionSources: string[] };

export async function inspectBackend(transport: CodexTransport): Promise<RestrictedPreflight> {
  const [account, catalog, configResult] = await Promise.all([
    transport.request<GetAccountResponse>('account/read', {}),
    listModels(transport),
    transport.request<ConfigReadResponse>('config/read', { includeLayers: false }),
  ]);
  const config = configResult.config as ConfigRecord;
  const apps = namedKeys(config.apps, '_default');
  const mcps = namedKeys(config.mcp_servers);
  const plugins = namedKeys(config.plugins);
  const hooks = namedKeys(config.hooks);
  const features = config.features;
  const overlay = makeOverlay(apps, mcps);
  const blockers = getUnknownCapabilityBlockers(config, features, plugins);
  if (!catalog.complete) blockers.push('model catalog pagination did not complete');
  const metadata = buildMetadata(account, config, catalog.models, apps, mcps, plugins, hooks);
  return {
    metadata,
    configOverlay: overlay,
    disabledPluginIds: plugins,
    blockers,
    eligible: blockers.length === 0,
  };
}

function buildMetadata(
  account: GetAccountResponse,
  config: ConfigRecord,
  models: ModelListResponse['data'],
  apps: string[],
  mcps: string[],
  plugins: string[],
  hooks: string[],
): SafeBackendMetadata {
  const defaultModel = models.find((model) => model.isDefault)?.model ?? null;
  const plan = account.account?.type === 'chatgpt' ? account.account.planType : null;
  return {
    accountType: account.account?.type ?? null,
    planType: plan,
    profileName: typeof config.profile === 'string' ? config.profile : null,
    requiresOpenaiAuth: account.requiresOpenaiAuth,
    backendOrigin: account.workspaceRouting?.backendOrigin ?? null,
    defaultModel,
    availableModels: models.map((model) => model.model),
    namedApps: apps,
    namedMcpServers: mcps,
    namedPlugins: plugins,
    namedHookEvents: hooks,
  };
}

async function listModels(
  transport: CodexTransport,
): Promise<{ models: ModelListResponse['data']; complete: boolean }> {
  const models: ModelListResponse['data'] = [];
  const cursors = new Set<string>();
  let cursor: string | null = null;
  for (let page = 0; page < 100; page += 1) {
    const params: ModelListParams = { cursor, includeHidden: false };
    const response = await transport.request<ModelListResponse>('model/list', params);
    models.push(...response.data);
    if (response.nextCursor === null) return { models, complete: true };
    if (cursors.has(response.nextCursor)) return { models, complete: false };
    cursors.add(response.nextCursor);
    cursor = response.nextCursor;
  }
  return { models, complete: false };
}

export async function createRestrictedWorkerThread(
  transport: CodexTransport,
  preflight: RestrictedPreflight,
  requestedModel: string,
  cwd: string,
  capacity: CapacityGrant,
): Promise<RestrictedWorker> {
  if (!preflight.eligible)
    throw new Error(`Restricted worker preflight failed: ${preflight.blockers.join('; ')}`);
  if (!Number.isInteger(capacity.slots) || capacity.slots < 1 || !capacity.provenance.trim()) {
    throw new Error('An explicit capacity grant with provenance is required');
  }
  if (!preflight.metadata.availableModels.includes(requestedModel))
    throw new Error('Requested model is absent from the live catalog');
  const params: ThreadStartParams = {
    model: requestedModel,
    allowProviderModelFallback: false,
    cwd,
    approvalPolicy: 'never',
    sandbox: 'read-only',
    ephemeral: true,
    config: preflight.configOverlay,
  };
  const started = await transport.request<ThreadStartResponse>('thread/start', params);
  if (started.model !== requestedModel)
    throw new Error(`Codex selected a different model: ${started.model}`);
  if (started.approvalPolicy !== 'never')
    throw new Error('Codex did not apply the never-approval policy');
  if (started.sandbox.type !== 'readOnly' || started.sandbox.networkAccess) {
    throw new Error('Codex did not apply read-only, network-disabled sandboxing');
  }
  return {
    threadId: started.thread.id,
    model: started.model,
    instructionSources: started.instructionSources,
  };
}

export function buildRestrictedTurnParams(
  preflight: RestrictedPreflight,
  threadId: string,
  requestedModel: string,
  cwd: string,
  userPrompt: string,
  capacity: CapacityGrant,
): TurnStartParams {
  if (!preflight.eligible)
    throw new Error(`Restricted worker preflight failed: ${preflight.blockers.join('; ')}`);
  if (!Number.isInteger(capacity.slots) || capacity.slots < 1 || !capacity.provenance.trim()) {
    throw new Error('An explicit capacity grant with provenance is required');
  }
  if (!userPrompt.trim()) throw new Error('A non-empty user task is required');
  if (!preflight.metadata.availableModels.includes(requestedModel))
    throw new Error('Requested model is absent from the live catalog');
  return {
    threadId,
    input: [{ type: 'text', text: userPrompt, text_elements: [] }],
    model: requestedModel,
    approvalPolicy: 'never',
    sandboxPolicy: { type: 'readOnly', networkAccess: false },
    disabledPluginIds: preflight.disabledPluginIds,
    runtimeWorkspaceRoots: [cwd],
  };
}

function makeOverlay(apps: string[], mcps: string[]): Record<string, JsonValue> {
  const appConfig = Object.fromEntries(apps.map((name) => [name, { enabled: false }]));
  const mcpConfig = Object.fromEntries(mcps.map((name) => [name, { enabled: false }]));
  return {
    features: { apps: false, multi_agent: false, hooks: false },
    agents: { enabled: false },
    web_search: 'disabled',
    apps: { ...appConfig, _default: { enabled: false } },
    mcp_servers: mcpConfig,
  } as unknown as Record<string, JsonValue>;
}

function getUnknownCapabilityBlockers(
  config: ConfigRecord,
  features: unknown,
  plugins: string[],
): string[] {
  const blockers: string[] = [];
  if (!isRecord(features)) blockers.push('feature settings could not be inspected');
  if (plugins.length)
    blockers.push(
      'configured plugin IDs require effective-state verification; disabledPluginIds does not filter capabilities',
    );
  if (config.permissions != null)
    blockers.push('managed permission profiles may override the requested sandbox');
  if (config.default_permissions != null)
    blockers.push('default permission configuration may override the requested sandbox');
  blockers.push(
    'dedicated worker effective capabilities and managed policy have not yet been verified',
  );
  return blockers;
}

function namedKeys(value: unknown, omit?: string): string[] {
  if (Array.isArray(value))
    return value.filter((item): item is string => typeof item === 'string').sort();
  if (!isRecord(value)) return [];
  return Object.keys(value)
    .filter((key) => key !== omit)
    .sort();
}

function isRecord(value: unknown): value is ConfigRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
