import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, realpath, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { verifyAssignmentRoot, verifyLinkedWorktree } from '../src/codex/local-environment.js';
import { createWorkerExecutor } from '../src/codex/worker.js';
import { workerSpec } from './codex-worker-fixture.js';
import { requireWorkerAuthority } from '../src/runtime/resources.js';
import { authority } from './runtime-fixture.js';
const execute = promisify(execFile);

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'ultra-worker-root-')));
  await execute('git', ['init', root]);
  await execute('git', ['-C', root, 'config', 'core.quotePath', 'true']);
  await execute('git', [
    '-C',
    root,
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '--allow-empty',
    '-m',
    'Fixture',
  ]);
  return root;
}

it('requires a canonical existing directory and bounded assignment paths', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'ultra-worker-cwd-')));
  const assignment = {
    ...workerSpec().assignment,
    ownership: { cwd: root, paths: [join(root, 'new.txt')] },
  };
  await expect(verifyAssignmentRoot(workerSpec({ assignment }))).resolves.toBeUndefined();
  assignment.ownership.paths = ['/outside'];
  await expect(verifyAssignmentRoot(workerSpec({ assignment }))).rejects.toThrow('inside');
  assignment.ownership.cwd = 'relative';
  await expect(verifyAssignmentRoot(workerSpec({ assignment }))).rejects.toThrow('canonical');
  const link = `${root}-link`;
  await symlink(root, link);
  assignment.ownership.cwd = link;
  await expect(verifyAssignmentRoot(workerSpec({ assignment }))).rejects.toThrow('canonical');
});

it.each(['-linked', '-lié', '-quote"\ttab\nline '])(
  'verifies a real isolated linked Git worktree %j and rejects its primary checkout',
  async (suffix) => {
    const main = await fixture();
    const linked = `${main}${suffix}`;
    await execute('git', ['-C', main, 'worktree', 'add', '--detach', linked]);
    await expect(verifyLinkedWorktree(linked)).resolves.toBeUndefined();
    await expect(verifyLinkedWorktree(main)).rejects.toThrow('linked Git worktree');
    const assignment = {
      ...workerSpec().assignment,
      ownership: { cwd: linked, paths: [join(linked, 'new.txt')] },
    };
    await expect(
      verifyAssignmentRoot(workerSpec({ assignment, capability: 'workspace-write' })),
    ).resolves.toBeUndefined();
  },
);

it('rejects a fake worktree marker rather than trusting .git file presence', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'ultra-worker-fake-')));
  await writeFile(join(root, '.git'), 'gitdir: /nonexistent\n');
  await expect(verifyLinkedWorktree(root)).rejects.toThrow('identity could not be verified');
});

it('does not confuse a valid linked worktree with authority to write it', async () => {
  const main = await fixture();
  const linked = `${main}-ungranted`;
  await execute('git', ['-C', main, 'worktree', 'add', '--detach', linked]);
  await verifyLinkedWorktree(linked);
  const spec = workerSpec({ capability: 'workspace-write' });
  spec.assignment.ownership.cwd = linked;
  const context = {
    ...authority.context,
    filesystem: { readAll: true as const, writableRoots: [main] },
  };
  expect(() => requireWorkerAuthority(spec, context)).toThrow('not authorized');
  context.filesystem.writableRoots = [linked];
  expect(() => requireWorkerAuthority(spec, context)).not.toThrow();
});

it('rejects a subdirectory whose marker redirects to a different root', async () => {
  const main = await fixture();
  const linked = `${main}-linked`;
  const nested = join(linked, 'nested');
  await execute('git', ['-C', main, 'worktree', 'add', '--detach', linked]);
  await mkdir(nested);
  const { stdout } = await execute('git', ['-C', linked, 'rev-parse', '--absolute-git-dir']);
  await writeFile(join(nested, '.git'), `gitdir: ${stdout.trim()}\n`);
  await expect(verifyLinkedWorktree(nested)).rejects.toThrow('worktree inventory');
});

it.each(['missing', 'invalid'])(
  'retains the safe %s writer-root failure through the actual executor',
  async (kind) => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'ultra-worker-invalid-')));
    if (kind === 'invalid') await writeFile(join(root, '.git'), 'gitdir: /nonexistent\n');
    const assignment = { ...workerSpec().assignment, ownership: { cwd: root, paths: [] } };
    const result = await createWorkerExecutor()(
      workerSpec({ assignment, capability: 'workspace-write' }),
      { instanceId: '/unused', signal: new AbortController().signal, onEvent: async () => {} },
    );
    expect(result.acceptance).toBe('blocked');
    expect(result.error).toContain(kind === 'missing' ? 'linked Git worktree' : 'Git identity');
  },
);

it.each(['read-only', 'workspace-write'] as const)(
  'preserves the missing %s root failure before backend launch',
  async (capability) => {
    const parent = await realpath(await mkdtemp(join(tmpdir(), 'ultra-missing-root-')));
    const result = await createWorkerExecutor()(
      workerSpec({
        capability,
        assignment: {
          ...workerSpec().assignment,
          ownership: { cwd: join(parent, 'never-created'), paths: [] },
        },
      }),
      { instanceId: '/unused', signal: new AbortController().signal, onEvent: async () => {} },
    );
    expect(result.error).toContain('canonical directory');
    expect(result.reportedModel).toBeNull();
  },
);
