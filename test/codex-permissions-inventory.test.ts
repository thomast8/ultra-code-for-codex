import { describe, expect, it } from 'vitest';
import { verifyReadOnlyWorker } from '../src/codex/permissions.js';
import {
  disabledFeatures,
  expectedWorker,
  featurePage,
  permissionTransport,
  workerThread,
} from './codex-permissions-fixture.js';

it.each(disabledFeatures)(
  'rejects inherited capability %s even when sandbox is read-only',
  async (name) => {
    const { transport } = permissionTransport({ 'experimentalFeature/list': featurePage(name) });
    await expect(verifyReadOnlyWorker(transport, workerThread(), expectedWorker)).rejects.toThrow(
      `prohibited feature remains enabled: ${name}`,
    );
  },
);

describe('complete feature evidence', () => {
  it('requires every prohibited flag and tolerates unrelated enabled features', async () => {
    const missing = featurePage();
    missing.data = missing.data.filter(({ name }) => name !== 'hooks');
    const { transport } = permissionTransport({ 'experimentalFeature/list': missing });
    await expect(verifyReadOnlyWorker(transport, workerThread(), expectedWorker)).rejects.toThrow(
      'required feature state is missing: hooks',
    );
    const extra = featurePage();
    extra.data.push({ name: 'unrelated_display_feature', enabled: true });
    await expect(
      verifyReadOnlyWorker(
        permissionTransport({ 'experimentalFeature/list': extra }).transport,
        workerThread(),
        expectedWorker,
      ),
    ).resolves.toMatchObject({ disabledFeatureCount: 23 });
  });

  it.each([
    [{ name: 'hooks' }],
    [{ name: 123, enabled: false }],
    [
      { name: 'hooks', enabled: false },
      { name: 'hooks', enabled: false },
    ],
    [null],
  ])('rejects unknown or duplicate feature states %#', async (...data) => {
    const { transport } = permissionTransport({
      'experimentalFeature/list': { data, nextCursor: null },
    });
    await expect(verifyReadOnlyWorker(transport, workerThread(), expectedWorker)).rejects.toThrow(
      'Restricted worker verification failed',
    );
  });
});

describe('inherited MCP tools', () => {
  it.each([
    'notStarted',
    'starting',
    'connected',
    'authenticationRequired',
    'failed',
    'cancelled',
    null,
    'future',
  ])('rejects MCP runtime state %s', async (runtimeStatus) => {
    const { transport } = permissionTransport({
      'mcpServerStatus/list': {
        data: [{ runtimeStatus, tools: {}, toolsError: null }],
        nextCursor: null,
      },
    });
    await expect(verifyReadOnlyWorker(transport, workerThread(), expectedWorker)).rejects.toThrow(
      'MCP server is not verified disabled',
    );
  });

  it.each([
    [{ tools: { inherited: {} }, toolsError: null }, 'inherited MCP tools'],
    [{ tools: {}, toolsError: 'sentinel-private-error' }, 'discovery is incomplete'],
    [{ tools: {} }, 'discovery is incomplete'],
    [{ tools: null, toolsError: null }, 'MCP tools metadata'],
  ])('rejects tools and unverified discovery %#', async (fields, reason) => {
    const { transport } = permissionTransport({
      'mcpServerStatus/list': {
        data: [{ runtimeStatus: 'disabled', ...fields }],
        nextCursor: null,
      },
    });
    await expect(verifyReadOnlyWorker(transport, workerThread(), expectedWorker)).rejects.toThrow(
      reason,
    );
  });
});

it.each([
  { enabled: true, callable: false },
  { enabled: false, callable: true },
  { enabled: false },
  { callable: false },
  { enabled: null, callable: false },
])('rejects inherited or unknown installed app state %#', async (app) => {
  const { transport } = permissionTransport({ 'app/installed': { apps: [app] } });
  await expect(verifyReadOnlyWorker(transport, workerThread(), expectedWorker)).rejects.toThrow(
    'app is not verified disabled and non-callable',
  );
});

describe('cwd-scoped hook inspection', () => {
  it.each([
    [[], 'exact-cwd hook inventory'],
    [[{ cwd: '/other', hooks: [], errors: [] }], 'does not match'],
    [
      [{ cwd: expectedWorker.cwd, hooks: [], errors: [{ message: 'private' }] }],
      'inspection has errors',
    ],
    [
      [{ cwd: expectedWorker.cwd, hooks: [{ enabled: true }], errors: [] }],
      'hook is not verified disabled',
    ],
    [[{ cwd: expectedWorker.cwd, hooks: [{}], errors: [] }], 'hook is not verified disabled'],
    [[{ cwd: expectedWorker.cwd, hooks: [] }], 'hook errors inventory'],
  ])('rejects incomplete or enabled hooks %#', async (data, reason) => {
    const { transport } = permissionTransport({ 'hooks/list': { data } });
    await expect(verifyReadOnlyWorker(transport, workerThread(), expectedWorker)).rejects.toThrow(
      reason,
    );
  });
});

it.each([
  ['experimentalFeature/list', null],
  ['mcpServerStatus/list', { data: null, nextCursor: null }],
  ['app/installed', {}],
  ['hooks/list', []],
])('rejects missing or malformed %s inventory', async (method, response) => {
  const { transport } = permissionTransport({ [method as string]: response });
  await expect(verifyReadOnlyWorker(transport, workerThread(), expectedWorker)).rejects.toThrow(
    'Restricted worker verification failed',
  );
});
