import { expect, it } from 'vitest';
import type { ConfigReadResponse } from '../src/codex/generated/v2/ConfigReadResponse.js';
import type { GetAccountResponse } from '../src/codex/generated/v2/GetAccountResponse.js';
import type { ModelListResponse } from '../src/codex/generated/v2/ModelListResponse.js';
import {
  buildRestrictedTurnParams,
  createRestrictedWorkerThread,
  inspectBackend,
  type RestrictedPreflight,
} from '../src/codex/preflight.js';
import type { CodexTransport } from '../src/codex/transport.js';

it('builds explicit named overlays and blocks unverified effective capability state', async () => {
  const result = await inspectBackend(makeFakeTransport());
  expect(result.metadata.namedApps).toEqual(['calendar', 'mail']);
  expect(result.metadata.namedMcpServers).toEqual(['mail', 'repo']);
  expect(result.metadata.namedPlugins).toEqual(['browser@bundled', 'computer-use@bundled']);
  expect(result.metadata.defaultModel).toBe('gpt-6.1-sol');
  expect(JSON.stringify(result.metadata)).not.toContain('private@example.test');
  expect(JSON.stringify(result.metadata)).not.toContain('private-account-id');
  expect(result.configOverlay).toMatchObject({
    features: { apps: false, multi_agent: false, hooks: false },
    agents: { enabled: false },
    web_search: 'disabled',
    apps: {
      _default: { enabled: false },
      calendar: { enabled: false },
      mail: { enabled: false },
    },
    mcp_servers: { mail: { enabled: false }, repo: { enabled: false } },
  });
  expect(result.disabledPluginIds).toEqual(result.metadata.namedPlugins);
  expect(result.eligible).toBe(false);
  expect(result.blockers.join(' ')).toContain('does not filter capabilities');
  expect(result.blockers.join(' ')).toContain('have not yet been verified');
});

it('creates explicit read-only, network-disabled turn params only from a verified preflight and capacity grant', () => {
  const preflight = eligiblePreflight();
  expect(() =>
    buildRestrictedTurnParams(preflight, 'thread', 'gpt-6.1-sol', '/repo', 'inspect only', {
      slots: 1,
      provenance: '',
    }),
  ).toThrow('explicit capacity grant');
  expect(() =>
    buildRestrictedTurnParams(preflight, 'thread', 'gpt-6.1-sol', '/repo', '', {
      slots: 1,
      provenance: 'parent allocation',
    }),
  ).toThrow('non-empty user task');
  expect(
    buildRestrictedTurnParams(preflight, 'thread', 'gpt-6.1-sol', '/repo', 'inspect only', {
      slots: 1,
      provenance: 'parent allocation',
    }),
  ).toMatchObject({
    model: 'gpt-6.1-sol',
    approvalPolicy: 'never',
    sandboxPolicy: { type: 'readOnly', networkAccess: false },
    runtimeWorkspaceRoots: ['/repo'],
    input: [{ type: 'text', text: 'inspect only' }],
  });
  expect(() =>
    buildRestrictedTurnParams(preflight, 'thread', 'other-model', '/repo', 'inspect only', {
      slots: 1,
      provenance: 'parent allocation',
    }),
  ).toThrow('absent from the live catalog');
  expect(() =>
    buildRestrictedTurnParams(
      { ...preflight, eligible: false, blockers: ['profile unknown'] },
      'thread',
      'gpt-6.1-sol',
      '/repo',
      'inspect only',
      {
        slots: 1,
        provenance: 'parent allocation',
      },
    ),
  ).toThrow('profile unknown');
  expect(() =>
    buildRestrictedTurnParams(preflight, 'thread', 'gpt-6.1-sol', '/repo', 'inspect only', {
      slots: 0,
      provenance: 'parent allocation',
    }),
  ).toThrow('explicit capacity grant');
});

it('does not start a thread when effective profile capabilities are unverified', async () => {
  const calls: string[] = [];
  const preflight = await inspectBackend(makeFakeTransport({ calls }));
  await expect(
    createRestrictedWorkerThread(makeFakeTransport({ calls }), preflight, 'gpt-6.1-sol', '/repo', {
      slots: 1,
      provenance: 'parent allocation',
    }),
  ).rejects.toThrow('dedicated worker effective capabilities');
  expect(calls).not.toContain('thread/start');
});

it('enumerates every model page and blocks repeated cursors', async () => {
  const paged = [
    modelPage([{ model: 'gpt-6.1-sol', isDefault: true }], 'next'),
    modelPage([{ model: 'gpt-6-sol', isDefault: false }], null),
  ];
  const inspected = await inspectBackend(makeFakeTransport({ pages: paged }));
  expect(inspected.metadata.availableModels).toEqual(['gpt-6.1-sol', 'gpt-6-sol']);
  expect(inspected.blockers).not.toContain('model catalog pagination did not complete');
  const repeated = [
    modelPage([{ model: 'gpt-6.1-sol', isDefault: true }], 'repeat'),
    modelPage([{ model: 'gpt-6-sol', isDefault: false }], 'repeat'),
  ];
  const blocked = await inspectBackend(makeFakeTransport({ pages: repeated }));
  expect(blocked.blockers).toContain('model catalog pagination did not complete');
});

it('reports missing feature metadata and configured permission profile overrides', async () => {
  const config = fakeConfig({
    features: null,
    permissions: { profile: 'managed' },
    default_permissions: { profile: 'strict' },
  });
  const result = await inspectBackend(makeFakeTransport({ config }));
  expect(result.blockers).toContain('feature settings could not be inspected');
  expect(result.blockers).toContain(
    'managed permission profiles may override the requested sandbox',
  );
  expect(result.blockers).toContain(
    'default permission configuration may override the requested sandbox',
  );
  expect(result.eligible).toBe(false);
});

it('checks selected model and thread permission responses before returning a worker', async () => {
  const preflight = eligiblePreflight();
  const mismatched = threadTransport({ model: 'other-model' });
  await expect(
    createRestrictedWorkerThread(mismatched.transport, preflight, 'gpt-6.1-sol', '/repo', grant()),
  ).rejects.toThrow('different model');
  expect(mismatched.captured[0]).toMatchObject({
    method: 'thread/start',
    params: { allowProviderModelFallback: false },
  });
  const approval = threadTransport({ approvalPolicy: 'on-request' });
  await expect(
    createRestrictedWorkerThread(approval.transport, preflight, 'gpt-6.1-sol', '/repo', grant()),
  ).rejects.toThrow('never-approval');
  const network = threadTransport({ networkAccess: true });
  await expect(
    createRestrictedWorkerThread(network.transport, preflight, 'gpt-6.1-sol', '/repo', grant()),
  ).rejects.toThrow('read-only, network-disabled');
  const accepted = threadTransport({});
  await expect(
    createRestrictedWorkerThread(accepted.transport, preflight, 'gpt-6.1-sol', '/repo', grant()),
  ).resolves.toMatchObject({
    threadId: 'thread-id',
    model: 'gpt-6.1-sol',
    instructionSources: [],
  });
  await expect(
    createRestrictedWorkerThread(accepted.transport, preflight, 'gpt-6.1-sol', '/repo', {
      slots: 0,
      provenance: 'allocation',
    }),
  ).rejects.toThrow('explicit capacity grant');
});

function makeFakeTransport(
  options: { pages?: ModelListResponse[]; config?: ConfigReadResponse; calls?: string[] } = {},
): CodexTransport {
  let page = 0;
  return {
    request: async (method: string) => {
      options.calls?.push(method);
      if (method === 'account/read') return fakeAccount();
      if (method === 'model/list') return (options.pages ?? [fakeModels()])[page++] ?? fakeModels();
      return options.config ?? fakeConfig();
    },
  } as unknown as CodexTransport;
}

function modelPage(
  models: { model: string; isDefault: boolean }[],
  nextCursor: string | null,
): ModelListResponse {
  return { data: models as ModelListResponse['data'], nextCursor };
}

function eligiblePreflight(): RestrictedPreflight {
  return {
    metadata: {
      accountType: 'chatgpt',
      planType: 'pro',
      profileName: null,
      requiresOpenaiAuth: true,
      backendOrigin: 'https://chatgpt.com',
      defaultModel: 'gpt-6.1-sol',
      availableModels: ['gpt-6.1-sol'],
      namedApps: [],
      namedMcpServers: [],
      namedPlugins: [],
      namedHookEvents: [],
    },
    configOverlay: {},
    disabledPluginIds: [],
    blockers: [],
    eligible: true,
  };
}

function grant() {
  return { slots: 1, provenance: 'parent allocation' };
}

function threadTransport(overrides: {
  model?: string;
  approvalPolicy?: string;
  networkAccess?: boolean;
}) {
  const captured: Array<{ method: string; params: unknown }> = [];
  const response = {
    model: overrides.model ?? 'gpt-6.1-sol',
    approvalPolicy: overrides.approvalPolicy ?? 'never',
    sandbox: { type: 'readOnly', networkAccess: overrides.networkAccess ?? false },
    thread: { id: 'thread-id' },
    instructionSources: [],
  };
  return {
    captured,
    transport: {
      request: async (method: string, params: unknown) => {
        captured.push({ method, params });
        return response;
      },
    } as unknown as CodexTransport,
  };
}

function fakeAccount(): GetAccountResponse {
  return {
    account: { type: 'chatgpt', email: 'private@example.test', planType: 'pro' },
    requiresOpenaiAuth: true,
    workspaceRouting: {
      backendOrigin: 'https://chatgpt.com',
      chatgptAccountId: 'private-account-id',
      accountRoutingOverride: 'NO_CONSTRAINT',
    },
  } as unknown as GetAccountResponse;
}

function fakeModels(): ModelListResponse {
  return {
    data: [
      { model: 'gpt-6.1-sol', isDefault: true },
      { model: 'gpt-6-sol', isDefault: false },
    ],
    nextCursor: null,
  } as unknown as ModelListResponse;
}

function fakeConfig(overrides: Record<string, unknown> = {}): ConfigReadResponse {
  return {
    config: {
      apps: {
        _default: { enabled: true },
        calendar: { enabled: true },
        mail: { enabled: true },
      },
      mcp_servers: { mail: { enabled: true }, repo: { enabled: true } },
      plugins: ['browser@bundled', 'computer-use@bundled'],
      hooks: { PreToolUse: [], SessionStart: [] },
      features: { apps: true, multi_agent: true, hooks: true },
      ...overrides,
    },
    origins: {},
    layers: null,
  } as unknown as ConfigReadResponse;
}
