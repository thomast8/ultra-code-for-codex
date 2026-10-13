import { isAbsolute } from 'node:path';
import type { ReasoningEffort } from './generated/ReasoningEffort.js';
import type { AppsInstalledParams } from './generated/v2/AppsInstalledParams.js';
import type { ExperimentalFeatureListParams } from './generated/v2/ExperimentalFeatureListParams.js';
import type { HooksListParams } from './generated/v2/HooksListParams.js';
import type { ListMcpServerStatusParams } from './generated/v2/ListMcpServerStatusParams.js';
import type { ThreadStartResponse } from './generated/v2/ThreadStartResponse.js';
import type { CodexTransport } from './transport.js';

export const PROHIBITED_WORKER_FEATURES = [
  'apps',
  'plugins',
  'remote_plugin',
  'hooks',
  'multi_agent',
  'multi_agent_v2',
  'multi_agent_v2_dynamic_tools',
  'goals',
  'agent_message_board',
  'browser_use',
  'browser_use_external',
  'browser_use_full_cdp_access',
  'browser_annotation_api',
  'computer_use',
  'in_app_browser',
  'in_app_local_automation',
  'worktrees',
  'workspace_dependencies',
  'request_permissions_tool',
  'image_generation',
  'memories',
  'skill_search',
  'skill_mcp_dependency_install',
] as const;

type InspectionTransport = Pick<CodexTransport, 'request'>;
type InspectionMethod =
  'experimentalFeature/list' | 'mcpServerStatus/list' | 'app/installed' | 'hooks/list';
export type ExpectedReadOnlyWorker = { cwd: string; model: string; effort: ReasoningEffort };
export type ReadOnlyWorkerEvidence = {
  threadId: string;
  model: string;
  effort: ReasoningEffort;
  cwd: string;
  instructionSources: string[];
  runtimeWorkspaceRoots: string[];
  approvalPolicy: 'never';
  sandbox: 'readOnly' | 'workspaceWrite';
  writableRoots?: string[];
  networkAccess: false;
  activePermissionProfile: ThreadStartResponse['activePermissionProfile'];
  disabledFeatureCount: number;
  disabledMcpServerCount: number;
  disabledAppCount: number;
  disabledHookCount: number;
  hookInspectionScope: 'cwd';
};

function block(reason: string): never {
  throw new Error(`Restricted worker verification failed: ${reason}`);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return block(`${label} metadata is unavailable`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) return block(`${label} inventory is unavailable`);
  return value;
}

function strings(value: unknown, label: string): string[] {
  const values = array(value, label);
  if (!values.every((entry): entry is string => typeof entry === 'string' && entry.length > 0)) {
    return block(`${label} inventory contains unknown state`);
  }
  return [...values];
}

async function inspect(
  transport: InspectionTransport,
  method: InspectionMethod,
  params: unknown,
): Promise<Record<string, unknown>> {
  let response: unknown;
  try {
    response = await transport.request<unknown>(method, params);
  } catch {
    return block(`${method} could not be inspected`);
  }
  return record(response, method);
}

async function pages(
  transport: InspectionTransport,
  method: 'experimentalFeature/list' | 'mcpServerStatus/list',
  params: ExperimentalFeatureListParams | ListMcpServerStatusParams,
): Promise<unknown[]> {
  const rows: unknown[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  for (let page = 0; page < 100; page += 1) {
    const response = await inspect(transport, method, { ...params, cursor, limit: 100 });
    const currentRows = array(response.data, method);
    if (rows.length + currentRows.length > 10_000) {
      return block(`${method} inventory exceeds the verification bound`);
    }
    rows.push(...currentRows);
    if (response.nextCursor === null) return rows;
    if (typeof response.nextCursor !== 'string' || response.nextCursor.length === 0) {
      return block(`${method} pagination state is unavailable`);
    }
    if (seen.has(response.nextCursor)) return block(`${method} pagination cursor repeated`);
    seen.add(response.nextCursor);
    cursor = response.nextCursor;
  }
  return block(`${method} pagination exceeds the verification bound`);
}

function verifyFeatures(rows: unknown[]): void {
  const features = new Map<string, boolean>();
  for (const value of rows) {
    const feature = record(value, 'feature');
    if (typeof feature.name !== 'string' || typeof feature.enabled !== 'boolean') {
      return block('feature inventory contains unknown state');
    }
    if (features.has(feature.name)) return block('feature inventory contains duplicate state');
    features.set(feature.name, feature.enabled);
  }
  for (const name of PROHIBITED_WORKER_FEATURES) {
    if (!features.has(name)) return block(`required feature state is missing: ${name}`);
    if (features.get(name) !== false) return block(`prohibited feature remains enabled: ${name}`);
  }
}

function verifyMcpServers(rows: unknown[]): void {
  for (const value of rows) {
    const server = record(value, 'MCP server');
    if (server.runtimeStatus !== 'disabled') return block('MCP server is not verified disabled');
    if (server.toolsError !== null) return block('MCP tool discovery is incomplete');
    if (Object.keys(record(server.tools, 'MCP tools')).length !== 0) {
      return block('inherited MCP tools remain available');
    }
  }
}

function verifyApps(response: Record<string, unknown>): number {
  const apps = array(response.apps, 'app');
  for (const value of apps) {
    const app = record(value, 'app');
    if (app.enabled !== false || app.callable !== false) {
      return block('inherited app is not verified disabled and non-callable');
    }
  }
  return apps.length;
}

function verifyHooks(response: Record<string, unknown>, cwd: string): number {
  const entries = array(response.data, 'hook');
  if (entries.length !== 1) return block('exact-cwd hook inventory is unavailable');
  const entry = record(entries[0], 'hook');
  if (entry.cwd !== cwd) return block('hook inventory does not match the worker cwd');
  if (array(entry.errors, 'hook errors').length > 0) return block('hook inspection has errors');
  const hooks = array(entry.hooks, 'hook');
  for (const value of hooks) {
    if (record(value, 'hook').enabled !== false)
      return block('inherited hook is not verified disabled');
  }
  return hooks.length;
}

function verifyIdentity(thread: ThreadStartResponse, expected: ExpectedReadOnlyWorker): void {
  record(thread, 'worker thread');
  if (!isAbsolute(expected.cwd) || !expected.model || !expected.effort) {
    return block('expected worker identity is incomplete');
  }
  if (typeof thread.thread?.id !== 'string' || thread.thread.id.length === 0) {
    return block('worker thread identity is unavailable');
  }
  if (thread.model !== expected.model) return block('worker model does not match the request');
  if (thread.reasoningEffort !== expected.effort)
    return block('worker effort does not match the request');
  if (thread.cwd !== expected.cwd) return block('worker cwd does not match the request');
}

function verifyPolicy(
  thread: ThreadStartResponse,
  capability: 'read-only' | 'workspace-write',
  cwd: string,
): void {
  if (thread.approvalPolicy !== 'never') return block('never-approval policy was not applied');
  if (capability === 'read-only') {
    if (thread.sandbox?.type !== 'readOnly' || thread.sandbox.networkAccess !== false) {
      return block('read-only network-disabled sandbox was not applied');
    }
  } else {
    verifyWritePolicy(thread.sandbox, cwd);
  }
  if (thread.activePermissionProfile !== null) {
    return block('active permission profile is named, conflicting, or unknown');
  }
}

function verifyWritePolicy(policy: ThreadStartResponse['sandbox'], cwd: string): void {
  if (
    policy?.type !== 'workspaceWrite' ||
    policy.networkAccess !== false ||
    policy.excludeSlashTmp !== true ||
    policy.excludeTmpdirEnvVar !== true
  ) {
    return block('workspace-write network-disabled temp-excluding sandbox was not applied');
  }
  // Public workspaceWrite roots are additional to cwd. The server may remove
  // a redundant explicit cwd from its legacy-policy response.
  if (policy.writableRoots.length > 1 || policy.writableRoots.some((root) => root !== cwd)) {
    return block('effective writable roots differ from the assigned worktree');
  }
}

export async function verifyReadOnlyWorker(
  transport: InspectionTransport,
  thread: ThreadStartResponse,
  expected: ExpectedReadOnlyWorker,
): Promise<ReadOnlyWorkerEvidence> {
  return verifyRestrictedWorker(transport, thread, expected, 'read-only');
}

export async function verifyRestrictedWorker(
  transport: InspectionTransport,
  thread: ThreadStartResponse,
  expected: ExpectedReadOnlyWorker,
  capability: 'read-only' | 'workspace-write',
): Promise<ReadOnlyWorkerEvidence> {
  verifyIdentity(thread, expected);
  verifyPolicy(thread, capability, expected.cwd);
  const instructionSources = strings(thread.instructionSources, 'instruction source');
  const runtimeWorkspaceRoots = strings(thread.runtimeWorkspaceRoots, 'runtime workspace root');
  if (runtimeWorkspaceRoots.some((root) => root !== expected.cwd)) {
    return block('runtime workspace roots differ from the assigned root');
  }
  const threadId = thread.thread.id;
  const features = await pages(transport, 'experimentalFeature/list', { threadId });
  verifyFeatures(features);
  const servers = await pages(transport, 'mcpServerStatus/list', { threadId, detail: 'full' });
  verifyMcpServers(servers);
  const appParams: AppsInstalledParams = { threadId, forceRefresh: true };
  const disabledAppCount = verifyApps(await inspect(transport, 'app/installed', appParams));
  // hooks/list is cwd-scoped; the thread's hooks feature was independently verified above.
  const hookParams: HooksListParams = { cwds: [expected.cwd] };
  const disabledHookCount = verifyHooks(
    await inspect(transport, 'hooks/list', hookParams),
    expected.cwd,
  );
  return {
    threadId,
    model: expected.model,
    effort: expected.effort,
    cwd: expected.cwd,
    instructionSources,
    runtimeWorkspaceRoots,
    approvalPolicy: 'never',
    sandbox: capability === 'read-only' ? 'readOnly' : 'workspaceWrite',
    ...(thread.sandbox.type === 'workspaceWrite'
      ? { writableRoots: [...thread.sandbox.writableRoots] }
      : {}),
    networkAccess: false,
    activePermissionProfile: thread.activePermissionProfile,
    disabledFeatureCount: PROHIBITED_WORKER_FEATURES.length,
    disabledMcpServerCount: servers.length,
    disabledAppCount,
    disabledHookCount,
    hookInspectionScope: 'cwd',
  };
}

export async function verifyProcessFeatures(transport: InspectionTransport): Promise<void> {
  verifyFeatures(await pages(transport, 'experimentalFeature/list', {}));
}
