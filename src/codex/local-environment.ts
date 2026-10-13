import { execFile } from 'node:child_process';
import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import type { AgentSpec } from '../contracts/workflow.js';
import type { ThreadStartResponse } from './generated/v2/ThreadStartResponse.js';
import type { ThreadEnvironment } from './generated/v2/ThreadEnvironment.js';
import type { EnvironmentInfoResponse } from './generated/v2/EnvironmentInfoResponse.js';
import type { EnvironmentStatusResponse } from './generated/v2/EnvironmentStatusResponse.js';
import {
  requireWorker,
  workerPages,
  workerRequest,
  type WorkerTransport,
} from './worker-protocol.js';

const runFile = promisify(execFile);

export async function verifyAssignmentRoot(spec: AgentSpec): Promise<void> {
  const cwd = spec.assignment.ownership.cwd;
  requireWorker(isAbsolute(cwd), 'Worker cwd must be an absolute canonical directory');
  requireWorker(
    (await realpath(cwd)) === cwd && (await stat(cwd)).isDirectory(),
    'Worker cwd must be an absolute canonical directory',
  );
  for (const path of spec.assignment.ownership.paths) {
    requireWorker(
      isAbsolute(path) && within(cwd, path),
      'Assigned paths must remain inside the worker root',
    );
  }
  if (spec.capability === 'workspace-write') await verifyLinkedWorktree(cwd);
}

function within(root: string, path: string): boolean {
  const part = relative(root, path);
  return part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part);
}

async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await runFile('git', ['-C', cwd, ...args], {
      timeout: 10_000,
      maxBuffer: 1_048_576,
    });
    return stdout.trim();
  } catch {
    throw new Error('Assigned writer root Git identity could not be verified');
  }
}

export async function verifyLinkedWorktree(cwd: string): Promise<void> {
  requireWorker(
    (await stat(join(cwd, '.git'))).isFile(),
    'Writer root must be a linked Git worktree',
  );
  const [top, directory, common, listing] = await Promise.all([
    git(cwd, ['rev-parse', '--show-toplevel']),
    git(cwd, ['rev-parse', '--absolute-git-dir']),
    git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']),
    git(cwd, ['worktree', 'list', '--porcelain']),
  ]);
  requireWorker((await realpath(top)) === cwd, 'Writer cwd must be the worktree root');
  const [gitDirectory, commonDirectory] = await Promise.all([
    realpath(directory),
    realpath(common),
  ]);
  requireWorker(
    within(join(commonDirectory, 'worktrees'), gitDirectory) && gitDirectory !== commonDirectory,
    'Writer Git directory is not an isolated linked worktree',
  );
  requireWorker(
    listing.split('\n').includes(`worktree ${cwd}`),
    'Assigned root is absent from the Git worktree inventory',
  );
}

export async function verifyLocalEnvironment(
  transport: WorkerTransport,
  started: ThreadStartResponse,
  cwd: string,
): Promise<ThreadEnvironment> {
  requireWorker(started.thread.ephemeral === true, 'Worker thread is not ephemeral');
  const environments = started.thread.environments;
  requireWorker(environments?.length === 1, 'Worker needs one verified local environment');
  const environment = environments[0];
  requireWorker(
    environment?.environmentId === 'local' && environment.cwd === cwd,
    'Worker local environment identity differs',
  );
  requireWorker(
    environment.runtimeWorkspaceRoots.length === 1 && environment.runtimeWorkspaceRoots[0] === cwd,
    'Worker environment roots differ from the assignment',
  );
  const [info, status, features] = await Promise.all([
    workerRequest<EnvironmentInfoResponse>(transport, 'environment/info', {
      environmentId: 'local',
    }),
    workerRequest<EnvironmentStatusResponse>(transport, 'environment/status', {
      environmentId: 'local',
    }),
    workerPages<{ name: string; enabled: boolean }>(transport, 'experimentalFeature/list', {
      threadId: started.thread.id,
    }),
  ]);
  requireWorker(status.status === 'ready', 'Worker local environment is not ready');
  requireWorker(isAbsolute(info.shell.path), 'Worker local shell is unavailable');
  requireWorker(
    info.cwd === null || info.cwd === pathToFileURL(cwd).href,
    'Worker environment native cwd differs',
  );
  requireWorker(
    ['shell_tool', 'unified_exec'].every(
      (name) => features.find((feature) => feature.name === name)?.enabled === true,
    ),
    'Worker local file tools are unavailable',
  );
  return environment;
}
