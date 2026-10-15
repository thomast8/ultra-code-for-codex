import { expect, it } from 'vitest';
import { workerHarness, workerSpec, workerThread } from './codex-worker-fixture.js';
import { outputContract, parseWorkerOutput, workerPrompt } from '../src/codex/worker-output.js';
import { workerPolicy } from '../src/codex/launch-policy.js';

it.each([
  ['account/read', { account: null }, 'ChatGPT'],
  ['configRequirements/read', { requirements: {} }, 'Managed requirements'],
  ['account/rateLimits/read', { ordinaryUsageAllowed: null }, 'included usage'],
  ['model/list', { data: [], nextCursor: null }, 'model and effort'],
  ['model/list', { data: [], nextCursor: 'again' }, 'pagination'],
  ['model/list', { data: [], nextCursor: '' }, 'pagination'],
  ['model/list', { data: null, nextCursor: null }, 'unavailable'],
])('blocks unverifiable admission at %s %#', async (method, reply, message) => {
  const h = workerHarness();
  h.backend.overrides[method as string] = reply;
  expect(await h.execute(workerSpec(), h.options)).toMatchObject({
    acceptance: 'blocked',
    error: expect.stringContaining(message as string),
  });
  expect(h.backend.calls.some((call) => call.method === 'thread/start')).toBe(false);
  expect(h.backend.close).toHaveBeenCalledOnce();
});

it.each([
  { default_permissions: ':custom' },
  { permissions: { custom: {} } },
  { approval_policy: 'on-request' },
  { sandbox_mode: 'danger-full-access' },
  { web_search: 'live' },
  { mcp_servers: { inherited: { enabled: true } } },
  { mcp_servers: [] },
])('blocks an unverified effective process configuration %#', async (changes) => {
  const h = workerHarness();
  h.backend.overrides['config/read'] = {
    config: {
      approval_policy: 'never',
      sandbox_mode: 'read-only',
      web_search: 'disabled',
      ...changes,
    },
  };
  expect(await h.execute(workerSpec(), h.options)).toMatchObject({ acceptance: 'blocked' });
  expect(h.backend.calls.some((call) => call.method === 'thread/start')).toBe(false);
});

it.each(['discovery', 'backend'] as const)(
  'rejects profile mismatch in %s without exposing RPC data',
  async (phase) => {
    const h = workerHarness();
    h[phase].initializeMetadata.codexHome = '/';
    expect(await h.execute(workerSpec(), h.options)).toMatchObject({
      acceptance: 'blocked',
      error: expect.stringContaining('profile differs'),
    });
    expect(h.backend.calls.some((call) => call.method === 'thread/start')).toBe(false);
  },
);

it('sanitizes request and transport launch errors and closes started processes', async () => {
  const h = workerHarness();
  h.discovery.overrides['config/read'] = () => {
    throw new Error('secret-config');
  };
  const result = await h.execute(workerSpec(), h.options);
  expect(result.error).toBe('Worker backend request failed: config/read');
  expect(h.discovery.close).toHaveBeenCalledOnce();
  const other = workerHarness();
  other.launch.mockRejectedValueOnce(new Error('secret-launch'));
  expect(JSON.stringify(await other.execute(workerSpec(), other.options))).not.toContain(
    'secret-launch',
  );
});

it.each([
  ['environment/status', { status: 'disconnected' }],
  ['environment/info', { shell: { path: 'unknown' }, cwd: null }],
  ['environment/info', { shell: { path: '/bin/zsh' }, cwd: 'file:///other' }],
  ['thread/start', workerThread({ thread: { id: 'worker-thread', ephemeral: false } })],
  [
    'thread/start',
    workerThread({ thread: { id: 'worker-thread', ephemeral: true, environments: [] } }),
  ],
  [
    'thread/start',
    workerThread({
      thread: {
        id: 'worker-thread',
        ephemeral: true,
        environments: [
          { environmentId: 'remote', cwd: '/private/tmp', runtimeWorkspaceRoots: ['/private/tmp'] },
        ],
      },
    }),
  ],
  [
    'thread/start',
    workerThread({
      thread: {
        id: 'worker-thread',
        ephemeral: true,
        environments: [
          { environmentId: 'local', cwd: '/private/tmp', runtimeWorkspaceRoots: ['/other'] },
        ],
      },
    }),
  ],
])('blocks unavailable local environment %#', async (method, reply) => {
  const h = workerHarness();
  h.backend.overrides[method as string] = reply;
  expect(await h.execute(workerSpec(), h.options)).toMatchObject({ acceptance: 'blocked' });
  expect(h.backend.calls.some((call) => call.method === 'turn/start')).toBe(false);
});

it('requires local tool features independently of the disabled inherited capability gate', async () => {
  const h = workerHarness();
  const response = h.backend.response('experimentalFeature/list') as {
    data: { name: string; enabled: boolean }[];
    nextCursor: null;
  };
  response.data.find((feature) => feature.name === 'shell_tool')!.enabled = false;
  h.backend.overrides['experimentalFeature/list'] = response;
  expect(await h.execute(workerSpec(), h.options)).toMatchObject({
    error: 'Worker local file tools are unavailable',
  });
});

it('checks aborts during discovery before launching the worker', async () => {
  const h = workerHarness();
  h.discovery.overrides['config/read'] = () => {
    h.controller.abort();
    return { config: {} };
  };
  expect(await h.execute(workerSpec(), h.options)).toMatchObject({
    execution: 'interrupted',
    error: 'Worker cancelled during preflight',
  });
  expect(h.launch).toHaveBeenCalledTimes(1);
});

it('excludes all temp writes from the workspace policy', () => {
  expect(workerPolicy(workerSpec({ capability: 'workspace-write' })).sandbox).toEqual({
    type: 'workspaceWrite',
    writableRoots: ['/private/tmp'],
    networkAccess: false,
    excludeTmpdirEnvVar: true,
    excludeSlashTmp: true,
  });
});

it('serializes exactly the six assignment fields without lead or assessment data', () => {
  const spec = workerSpec();
  const text = workerPrompt(spec);
  expect(JSON.parse(text.split('\n')[1]!)).toEqual(spec.assignment);
  expect(text).not.toContain(spec.assessment.modelRationale);
  expect(() =>
    workerPrompt(workerSpec({ assignment: { ...spec.assignment, inputs: 'x'.repeat(65_537) } })),
  ).toThrow('64 KiB');
});

it('rejects invalid or oversized schemas, output, and timeouts before launch', async () => {
  expect(() => outputContract(workerSpec({ outputSchema: { type: 'bad-type' } }))).toThrow(
    'compiled',
  );
  expect(() =>
    outputContract(workerSpec({ outputSchema: { description: 'x'.repeat(65_537) } })),
  ).toThrow('64 KiB');
  expect(() => parseWorkerOutput('x'.repeat(262_145), outputContract(workerSpec()))).toThrow(
    'bound',
  );
  const h = workerHarness();
  for (const timeoutMs of [0, -1, 3_600_001, 1.5])
    expect(await h.execute(workerSpec({ timeoutMs }), h.options)).toMatchObject({
      acceptance: 'blocked',
    });
  expect(h.launch).not.toHaveBeenCalled();
});

it.each(['dotted.name', 'quoted"name', '', 'line\nbreak'])(
  'blocks unsupported named capability override keys: %s',
  async (name) => {
    const h = workerHarness();
    h.discovery.overrides['config/read'] = {
      config: { mcp_servers: { [name]: { enabled: true } } },
    };
    expect(await h.execute(workerSpec(), h.options)).toMatchObject({
      acceptance: 'blocked',
      error: 'Configured capability name cannot be safely disabled by public CLI overrides',
    });
    expect(h.launch).toHaveBeenCalledTimes(1);
    expect(h.discovery.close).toHaveBeenCalledOnce();
  },
);
