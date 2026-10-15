import { expect, it } from 'vitest';
import { verifyRestrictedWorker } from '../src/codex/permissions.js';
import type { SandboxPolicy } from '../src/codex/generated/v2/SandboxPolicy.js';
import { expectedWorker, permissionTransport, workerThread } from './codex-permissions-fixture.js';

const writePolicy: SandboxPolicy = {
  type: 'workspaceWrite',
  writableRoots: [expectedWorker.cwd],
  networkAccess: false,
  excludeSlashTmp: true,
  excludeTmpdirEnvVar: true,
};

it('verifies only the assigned workspace root with both temp grants excluded', async () => {
  const { transport } = permissionTransport();
  const thread = workerThread({
    sandbox: writePolicy,
    runtimeWorkspaceRoots: [expectedWorker.cwd],
  });
  expect(
    await verifyRestrictedWorker(transport, thread, expectedWorker, 'workspace-write'),
  ).toMatchObject({ sandbox: 'workspaceWrite', networkAccess: false });
});

it.each([
  { networkAccess: true },
  { excludeSlashTmp: false },
  { excludeTmpdirEnvVar: false },
  { writableRoots: ['/other'] },
  { writableRoots: [expectedWorker.cwd, '/other'] },
])('rejects broader or unknown workspace write grants %#', async (change) => {
  const { transport } = permissionTransport();
  const thread = workerThread({ sandbox: { ...writePolicy, ...change } });
  await expect(
    verifyRestrictedWorker(transport, thread, expectedWorker, 'workspace-write'),
  ).rejects.toThrow('verification failed');
});

it.each(['read-only', 'workspace-write'] as const)(
  'rejects unknown runtime roots for %s',
  async (capability) => {
    const { transport } = permissionTransport();
    const thread = workerThread({
      sandbox:
        capability === 'workspace-write' ? writePolicy : { type: 'readOnly', networkAccess: false },
      runtimeWorkspaceRoots: ['/other'],
    });
    await expect(
      verifyRestrictedWorker(transport, thread, expectedWorker, capability),
    ).rejects.toThrow('runtime workspace roots differ');
  },
);

it('retains observed empty additional roots when cwd is the only implicit writable root', async () => {
  const { transport } = permissionTransport();
  const thread = workerThread({
    sandbox: { ...writePolicy, writableRoots: [] },
    runtimeWorkspaceRoots: [expectedWorker.cwd],
  });
  const evidence = await verifyRestrictedWorker(
    transport,
    thread,
    expectedWorker,
    'workspace-write',
  );
  expect(evidence).toMatchObject({
    cwd: expectedWorker.cwd,
    writableRoots: [],
    runtimeWorkspaceRoots: [expectedWorker.cwd],
  });
});

it('retains the explicit redundant cwd root without inventing normalized readback', async () => {
  const { transport } = permissionTransport();
  const evidence = await verifyRestrictedWorker(
    transport,
    workerThread({ sandbox: writePolicy }),
    expectedWorker,
    'workspace-write',
  );
  expect(evidence.writableRoots).toEqual([expectedWorker.cwd]);
});
