import type { ThreadStartResponse } from '../src/codex/generated/v2/ThreadStartResponse.js';
import type { CodexTransport } from '../src/codex/transport.js';

export const expectedWorker = { cwd: '/workspace/project', model: 'gpt-6-luna', effort: 'medium' };
export const disabledFeatures = [
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
];

export function workerThread(overrides: Partial<ThreadStartResponse> = {}): ThreadStartResponse {
  return {
    thread: { id: 'worker-thread' },
    model: expectedWorker.model,
    reasoningEffort: expectedWorker.effort,
    cwd: expectedWorker.cwd,
    approvalPolicy: 'never',
    sandbox: { type: 'readOnly', networkAccess: false },
    activePermissionProfile: null,
    instructionSources: ['/workspace/project/AGENTS.md'],
    runtimeWorkspaceRoots: [],
    ...overrides,
  } as ThreadStartResponse;
}

export function featurePage(enabledName?: string) {
  return {
    data: disabledFeatures.map((name) => ({ name, enabled: name === enabledName })),
    nextCursor: null,
  };
}

type Reply = unknown | ((params: unknown) => unknown);

export function permissionTransport(overrides: Record<string, Reply> = {}) {
  const calls: { method: string; params: unknown }[] = [];
  const responses: Record<string, Reply> = {
    'experimentalFeature/list': featurePage(),
    'mcpServerStatus/list': {
      data: [{ runtimeStatus: 'disabled', tools: {}, toolsError: null }],
      nextCursor: null,
    },
    'app/installed': { apps: [{ enabled: false, callable: false }] },
    'hooks/list': {
      data: [{ cwd: expectedWorker.cwd, hooks: [{ enabled: false }], errors: [], warnings: [] }],
    },
    ...overrides,
  };
  const transport: Pick<CodexTransport, 'request'> = {
    async request<T>(method: string, params?: unknown): Promise<T> {
      calls.push({ method, params });
      const response = responses[method];
      return (typeof response === 'function' ? response(params) : response) as T;
    },
  };
  return { transport, calls };
}
