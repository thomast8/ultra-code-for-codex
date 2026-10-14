import { realpath } from 'node:fs/promises';
import type { AgentSpec, JsonValue } from '../contracts/workflow.js';
import type { ConfigReadResponse } from './generated/v2/ConfigReadResponse.js';
import type { ConfigRequirementsReadResponse } from './generated/v2/ConfigRequirementsReadResponse.js';
import type { GetAccountResponse } from './generated/v2/GetAccountResponse.js';
import type { GetAccountRateLimitsResponse } from './generated/v2/GetAccountRateLimitsResponse.js';
import type { Model } from './generated/v2/Model.js';
import type { SandboxPolicy } from './generated/v2/SandboxPolicy.js';
import { PROHIBITED_WORKER_FEATURES, verifyProcessFeatures } from './permissions.js';
import { CodexTransport } from './transport.js';
import {
  requireWorker,
  awaitPreflight,
  closeOnAbort,
  workerPages,
  workerRequest,
  type WorkerTransport,
} from './worker-protocol.js';

export const BUNDLED_CODEX = '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex';
export type LaunchWorkerTransport = (
  overrides: readonly string[],
  cwd: string,
  signal?: AbortSignal,
) => Promise<WorkerTransport>;
export const launchWorkerTransport: LaunchWorkerTransport = (configOverrides, cwd, signal) =>
  CodexTransport.launch(BUNDLED_CODEX, 15_000, undefined, {
    configOverrides,
    cwd,
    ...(signal ? { signal } : {}),
  });

type LaunchPolicy = { config: Record<string, JsonValue>; sandbox: SandboxPolicy };

export function workerPolicy(spec: AgentSpec): LaunchPolicy {
  const write = spec.capability === 'workspace-write';
  const sandbox: SandboxPolicy = write
    ? {
        type: 'workspaceWrite',
        writableRoots: [spec.assignment.ownership.cwd],
        networkAccess: false,
        excludeTmpdirEnvVar: true,
        excludeSlashTmp: true,
      }
    : { type: 'readOnly', networkAccess: false };
  const config = restrictedWorkerConfig(spec.assignment.ownership.cwd, spec.capability);
  Object.assign(config, { model: spec.model, model_reasoning_effort: spec.effort });
  return { config, sandbox };
}

export function restrictedWorkerConfig(
  cwd: string,
  capability: AgentSpec['capability'],
): Record<string, JsonValue> {
  const config: Record<string, JsonValue> = Object.fromEntries(
    PROHIBITED_WORKER_FEATURES.map((name) => [`features.${name}`, false]),
  );
  Object.assign(config, {
    approval_policy: 'never',
    sandbox_mode: capability,
    web_search: 'disabled',
    'apps._default.enabled': false,
    'sandbox_workspace_write.writable_roots': [cwd],
    'sandbox_workspace_write.network_access': false,
    'sandbox_workspace_write.exclude_tmpdir_env_var': true,
    'sandbox_workspace_write.exclude_slash_tmp': true,
  });
  return config;
}

export function configArguments(config: Record<string, JsonValue>): string[] {
  return Object.entries(config).map(([key, value]) => `${key}=${JSON.stringify(value)}`);
}

export async function verifyWorkerProfile(
  transport: WorkerTransport,
  instanceId: string,
): Promise<void> {
  const actual = transport.initializeMetadata?.codexHome;
  requireWorker(typeof actual === 'string', 'Worker profile metadata is unavailable');
  const [actualHome, expectedHome] = await Promise.all([realpath(actual), realpath(instanceId)]);
  requireWorker(actualHome === expectedHome, 'Worker profile differs from the lead profile');
}

export async function prepareWorkerTransport(
  spec: AgentSpec,
  instanceId: string,
  launch: LaunchWorkerTransport,
  signal?: AbortSignal,
): Promise<{ transport: WorkerTransport; policy: LaunchPolicy }> {
  const policy = workerPolicy(spec);
  const transport = await openRestrictedBackend(
    instanceId,
    spec.assignment.ownership.cwd,
    policy.config,
    launch,
    signal,
  );
  const detach = closeOnAbort(transport, signal);
  try {
    await awaitPreflight(verifyEligibility(transport, spec), signal);
    requireWorker(!signal?.aborted, 'Worker cancelled during eligibility verification');
    return { transport, policy };
  } catch (error) {
    transport.close();
    throw error;
  } finally {
    detach();
  }
}

async function launchPreflight(
  launch: LaunchWorkerTransport,
  args: string[],
  cwd: string,
  signal?: AbortSignal,
): Promise<WorkerTransport> {
  requireWorker(!signal?.aborted, 'Worker cancelled before backend launch');
  const opening = launch(args, cwd, signal);
  void opening.then(
    (transport) => {
      if (signal?.aborted) transport.close();
    },
    () => {},
  );
  return awaitPreflight(opening, signal);
}

export async function openRestrictedBackend(
  instanceId: string,
  cwd: string,
  overrides: Record<string, JsonValue>,
  launch: LaunchWorkerTransport,
  signal?: AbortSignal,
): Promise<WorkerTransport> {
  const discovery = await launchPreflight(launch, configArguments(overrides), cwd, signal);
  const detachDiscovery = closeOnAbort(discovery, signal);
  try {
    requireWorker(!signal?.aborted, 'Worker cancelled during discovery');
    await awaitPreflight(verifyWorkerProfile(discovery, instanceId), signal);
    const response = await awaitPreflight(
      workerRequest<ConfigReadResponse>(discovery, 'config/read', {
        cwd,
        includeLayers: false,
      }),
      signal,
    );
    const config = response.config as Record<string, unknown>;
    for (const group of ['mcp_servers', 'apps']) {
      for (const name of namedEntries(config[group])) {
        requireWorker(
          /^[A-Za-z0-9_-]+$/.test(name),
          'Configured capability name cannot be safely disabled by public CLI overrides',
        );
        overrides[`${group}.${name}.enabled`] = false;
      }
    }
  } finally {
    detachDiscovery();
    discovery.close();
  }
  requireWorker(!signal?.aborted, 'Worker cancelled during discovery');
  const transport = await launchPreflight(launch, configArguments(overrides), cwd, signal);
  const detach = closeOnAbort(transport, signal);
  try {
    await awaitPreflight(verifyWorkerProfile(transport, instanceId), signal);
    return transport;
  } catch (error) {
    transport.close();
    throw error;
  } finally {
    detach();
  }
}

function namedEntries(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  requireWorker(
    typeof value === 'object' && !Array.isArray(value),
    'Configured capability inventory is unavailable',
  );
  return Object.keys(value);
}

export function verifyWorkerConfiguration(
  response: ConfigReadResponse,
  capability: AgentSpec['capability'],
): void {
  const config = response.config as Record<string, unknown>;
  requireWorker(
    config.default_permissions == null,
    'Default permission profiles require separate verification',
  );
  requireWorker(
    namedEntries(config.permissions).length === 0,
    'Named permission profiles require separate verification',
  );
  requireWorker(
    config.approval_policy === 'never' &&
      config.sandbox_mode === capability &&
      config.web_search === 'disabled',
    'Worker process restrictions were not applied',
  );
  for (const name of namedEntries(config.mcp_servers)) {
    const server = (config.mcp_servers as Record<string, { enabled?: boolean }>)[name];
    requireWorker(server?.enabled === false, 'A named MCP server remains enabled');
  }
}

async function verifyEligibility(transport: WorkerTransport, spec: AgentSpec): Promise<void> {
  const [account, requirements, usage, config, models] = await Promise.all([
    workerRequest<GetAccountResponse>(transport, 'account/read', {}),
    workerRequest<ConfigRequirementsReadResponse>(transport, 'configRequirements/read', {}),
    workerRequest<GetAccountRateLimitsResponse>(transport, 'account/rateLimits/read', {
      excludeResetCreditDetails: true,
    }),
    workerRequest<ConfigReadResponse>(transport, 'config/read', {
      cwd: spec.assignment.ownership.cwd,
      includeLayers: false,
    }),
    workerPages<Model>(transport, 'model/list', { includeHidden: false }),
  ]);
  requireWorker(account.account?.type === 'chatgpt', 'Worker requires the active ChatGPT account');
  requireWorker(
    requirements.requirements === null,
    'Managed requirements require separate verification',
  );
  requireWorker(
    usage.ordinaryUsageAllowed === true,
    'Ordinary included usage is not verified available',
  );
  const model = models.find((entry) => entry.model === spec.model);
  requireWorker(
    model?.supportedReasoningEfforts.some((entry) => entry.reasoningEffort === spec.effort),
    'Requested model and effort are absent from the live catalog',
  );
  verifyWorkerConfiguration(config, spec.capability);
  await verifyProcessFeatures(transport);
}
