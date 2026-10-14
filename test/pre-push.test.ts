import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

const execute = promisify(execFile);
const gitEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
);

async function fixture(command: string) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'ultra-hook-isolation-')));
  const source = join(root, 'source');
  const bin = join(root, 'bin');
  await mkdir(bin);
  await execute('git', ['init', source], { env: gitEnvironment });
  await writeFile(join(bin, 'just'), `#!/bin/sh\nset -eu\n${command}\n`, { mode: 0o700 });
  return {
    source,
    foreign: join(root, 'foreign'),
    env: {
      ...gitEnvironment,
      PATH: `${bin}:${process.env.PATH}`,
      GIT_DIR: join(source, '.git'),
      GIT_WORK_TREE: source,
      GIT_COMMON_DIR: join(source, '.git'),
      GIT_INDEX_FILE: join(source, '.git', 'fixture-index'),
      QA_FOREIGN: join(root, 'foreign'),
    },
  };
}

it('runs the mandatory check with isolated Git state and leaves the source repository unchanged', async () => {
  const { source, foreign, env } = await fixture(`
test "$1" = check
test -z "\${GIT_DIR+x}\${GIT_WORK_TREE+x}\${GIT_COMMON_DIR+x}\${GIT_INDEX_FILE+x}"
git init "$QA_FOREIGN" >/dev/null
git -C "$QA_FOREIGN" -c user.name=QA -c user.email=qa@example.invalid -c commit.gpgsign=false commit --allow-empty -m Fixture >/dev/null`);
  await execute(resolve('.githooks/pre-push'), [], { cwd: source, env });
  expect(
    (
      await execute('git', ['-C', foreign, 'log', '-1', '--format=%s'], { env: gitEnvironment })
    ).stdout.trim(),
  ).toBe('Fixture');
  expect(
    (
      await execute('git', ['-C', source, 'config', '--get', 'core.bare'], { env: gitEnvironment })
    ).stdout.trim(),
  ).toBe('false');
  await expect(
    execute('git', ['-C', source, 'rev-parse', '--verify', 'HEAD'], { env: gitEnvironment }),
  ).rejects.toMatchObject({ code: 128 });
});

it('still rejects the push when the mandatory check fails', async () => {
  const { source, env } = await fixture('test "$1" = check\nexit 7');
  await expect(
    execute(resolve('.githooks/pre-push'), [], { cwd: source, env }),
  ).rejects.toMatchObject({ code: 7 });
});
