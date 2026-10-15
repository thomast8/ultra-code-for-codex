import { describe, expect, it } from 'vitest';
import { verifyReadOnlyWorker } from '../src/codex/permissions.js';
import type { ThreadStartResponse } from '../src/codex/generated/v2/ThreadStartResponse.js';
import { expectedWorker, permissionTransport, workerThread } from './codex-permissions-fixture.js';

it('verifies effective inventories and reports the actual hook inspection scope', async () => {
  const { transport, calls } = permissionTransport();
  const thread = workerThread();
  const evidence = await verifyReadOnlyWorker(transport, thread, expectedWorker);
  expect(evidence).toEqual({
    threadId: 'worker-thread',
    ...expectedWorker,
    instructionSources: ['/workspace/project/AGENTS.md'],
    runtimeWorkspaceRoots: [],
    approvalPolicy: 'never',
    sandbox: 'readOnly',
    networkAccess: false,
    activePermissionProfile: null,
    disabledFeatureCount: 23,
    disabledMcpServerCount: 1,
    disabledAppCount: 1,
    disabledHookCount: 1,
    hookInspectionScope: 'cwd',
  });
  expect(calls).toEqual([
    {
      method: 'experimentalFeature/list',
      params: { threadId: 'worker-thread', cursor: null, limit: 100 },
    },
    {
      method: 'mcpServerStatus/list',
      params: { threadId: 'worker-thread', detail: 'full', cursor: null, limit: 100 },
    },
    { method: 'app/installed', params: { threadId: 'worker-thread', forceRefresh: true } },
    { method: 'hooks/list', params: { cwds: [expectedWorker.cwd] } },
  ]);
  thread.instructionSources.push('/later-change');
  expect(evidence.instructionSources).toEqual(['/workspace/project/AGENTS.md']);
});

it('accepts an empty capability inventory and records non-empty runtime roots without inferring write authority', async () => {
  const { transport } = permissionTransport({
    'mcpServerStatus/list': { data: [], nextCursor: null },
    'app/installed': { apps: [] },
    'hooks/list': { data: [{ cwd: expectedWorker.cwd, hooks: [], errors: [], warnings: [] }] },
  });
  const evidence = await verifyReadOnlyWorker(
    transport,
    workerThread({ runtimeWorkspaceRoots: [expectedWorker.cwd] }),
    expectedWorker,
  );
  expect(evidence).toMatchObject({
    runtimeWorkspaceRoots: [expectedWorker.cwd],
    disabledMcpServerCount: 0,
    disabledAppCount: 0,
    disabledHookCount: 0,
  });
});

describe('exact worker identity and policy', () => {
  const cases: [Partial<ThreadStartResponse>, string][] = [
    [{ model: 'other' }, 'model does not match'],
    [{ reasoningEffort: 'ultra' }, 'effort does not match'],
    [{ reasoningEffort: null }, 'effort does not match'],
    [{ cwd: '/another-project' }, 'cwd does not match'],
    [{ approvalPolicy: 'on-request' }, 'never-approval'],
    [{ sandbox: { type: 'dangerFullAccess' } }, 'read-only network-disabled'],
    [{ sandbox: { type: 'readOnly', networkAccess: true } }, 'read-only network-disabled'],
    [{ activePermissionProfile: { id: ':read-only', extends: null } }, 'permission profile'],
    [{ activePermissionProfile: { id: 'managed', extends: ':workspace' } }, 'permission profile'],
  ];
  it.each(cases)(
    'blocks changed effective thread state %# before inventory queries',
    async (overrides, reason) => {
      const { transport, calls } = permissionTransport();
      await expect(
        verifyReadOnlyWorker(transport, workerThread(overrides), expectedWorker),
      ).rejects.toThrow(reason);
      expect(calls).toEqual([]);
    },
  );

  it.each(['cwd', 'model', 'effort'])('rejects incomplete requested %s', async (field) => {
    const { transport } = permissionTransport();
    await expect(
      verifyReadOnlyWorker(transport, workerThread(), { ...expectedWorker, [field]: '' }),
    ).rejects.toThrow('expected worker identity is incomplete');
  });

  it.each(['thread', 'activePermissionProfile', 'instructionSources', 'runtimeWorkspaceRoots'])(
    'requires observed %s metadata',
    async (field) => {
      const { transport } = permissionTransport();
      const partial = Object.fromEntries(
        Object.entries(workerThread()).filter(([name]) => name !== field),
      );
      await expect(
        verifyReadOnlyWorker(transport, partial as ThreadStartResponse, expectedWorker),
      ).rejects.toThrow('Restricted worker verification failed');
    },
  );

  it('rejects malformed thread and instruction inventories with sanitized blockers', async () => {
    const { transport } = permissionTransport();
    await expect(
      verifyReadOnlyWorker(transport, null as unknown as ThreadStartResponse, expectedWorker),
    ).rejects.toThrow('worker thread metadata is unavailable');
    const thread = workerThread({ instructionSources: [''] });
    await expect(verifyReadOnlyWorker(transport, thread, expectedWorker)).rejects.toThrow(
      'instruction source inventory contains unknown state',
    );
  });
});

it.each(['experimentalFeature/list', 'mcpServerStatus/list', 'app/installed', 'hooks/list'])(
  'sanitizes failed %s reads',
  async (method) => {
    const { transport } = permissionTransport({
      [method]: () => {
        throw new Error('sentinel-private-state');
      },
    });
    await expect(verifyReadOnlyWorker(transport, workerThread(), expectedWorker)).rejects.toThrow(
      `${method} could not be inspected`,
    );
  },
);
