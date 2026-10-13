import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, realpath, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { verifyAssignmentRoot, verifyLinkedWorktree } from '../src/codex/local-environment.js';
import { workerSpec } from './codex-worker-fixture.js';
const execute = promisify(execFile);

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'ultra-worker-root-')));
  await execute('git', ['init', root]);
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

it('verifies a real isolated linked Git worktree and rejects its primary checkout', async () => {
  const main = await fixture();
  const linked = `${main}-linked`;
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
});

it('rejects a fake worktree marker rather than trusting .git file presence', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'ultra-worker-fake-')));
  await writeFile(join(root, '.git'), 'gitdir: /nonexistent\n');
  await expect(verifyLinkedWorktree(root)).rejects.toThrow('identity could not be verified');
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
