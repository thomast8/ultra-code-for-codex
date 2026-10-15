import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createProcessHookIO,
  runHookEntry,
  runIfDirectExecution,
} from '../src/activation/hook-entry.js';

const sessionId = '01a1090e-4f83-7a73-8500-f87c808e0e85';
const turnId = '01a1090e-4f83-7a73-8500-f87c808e0e86';
const cwd = '/workspace/naïve';
const directories: string[] = [];

async function makeFixture(): Promise<{ dataDir: string; transcriptPath: string }> {
  const root = await mkdtemp(join(tmpdir(), 'activation-hook-entry-'));
  directories.push(root);
  const transcriptPath = join(root, 'sessions', '2026', '10', '05', 'session.jsonl');
  await mkdir(join(transcriptPath, '..'), { recursive: true });
  const rows = [
    {
      timestamp: '2026-10-05T00:00:00Z',
      ordinal: 0,
      type: 'session_meta',
      payload: { id: sessionId, session_id: sessionId, cli_version: '0.160.0' },
    },
    {
      timestamp: '2026-10-05T00:00:01Z',
      ordinal: 1,
      type: 'turn_context',
      payload: {
        turn_id: turnId,
        cwd,
        model: 'gpt-6.1-sol',
        effort: 'ultra',
        collaboration_mode: { mode: 'default', settings: { model: 'gpt-6.1-sol' } },
      },
    },
  ];
  await writeFile(transcriptPath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
  return { dataDir: join(root, 'plugin-data'), transcriptPath };
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('hook process entry', () => {
  it('bridges hook output and failures through the process interface', async () => {
    const { dataDir, transcriptPath } = await makeFixture();
    const output: string[] = [];
    const diagnostics: string[] = [];
    const input = JSON.stringify({
      hook_event_name: 'UserPromptSubmit',
      session_id: sessionId,
      turn_id: turnId,
      cwd,
      transcript_path: transcriptPath,
    });
    const host = {
      stdin: (async function* () {
        yield input;
      })(),
      env: { CODEX_PLUGIN_DATA: dataDir },
      stdout: { write: (value: string) => output.push(value) },
      stderr: { write: (value: string) => diagnostics.push(value) },
      exitCode: 0,
    };
    await runHookEntry(createProcessHookIO(host));
    expect(host.exitCode).toBe(0);
    expect(JSON.parse(output.join(''))).toMatchObject({
      hookSpecificOutput: { hookEventName: 'UserPromptSubmit' },
    });
  });

  it('sets process exitCode for malformed input without writing stdout', async () => {
    const output: string[] = [];
    const diagnostics: string[] = [];
    const host = {
      stdin: (async function* () {
        yield '{';
      })(),
      env: {},
      stdout: { write: (value: string) => output.push(value) },
      stderr: { write: (value: string) => diagnostics.push(value) },
      exitCode: 0,
    };
    await runHookEntry(createProcessHookIO(host));
    expect({ exitCode: host.exitCode, output }).toEqual({ exitCode: 1, output: [] });
    expect(diagnostics).toEqual(['Ultra Code hook failed: Invalid hook JSON input\n']);
  });
});

describe('direct hook execution guard', () => {
  it('runs only for its matching script URL and delegates stdin handling', async () => {
    const written: string[] = [];
    const diagnostics: string[] = [];
    let exitCode = 0;
    async function* stdin(): AsyncGenerator<string> {
      yield '{';
    }
    const io = {
      stdin: stdin(),
      environment: {},
      writeStdout: (value: string) => written.push(value),
      writeStderr: (value: string) => diagnostics.push(value),
      setExitCode: (value: number) => (exitCode = value),
    };
    const script = '/tmp/activation-hook-entry.js';
    expect(await runIfDirectExecution(io, 'file:///different.js', script)).toBe(false);
    expect(await runIfDirectExecution(io, pathToFileURL(script).href, undefined)).toBe(false);
    expect(await runIfDirectExecution(io, pathToFileURL(script).href, script)).toBe(true);
    expect({ exitCode, written }).toEqual({ exitCode: 1, written: [] });
  });
});

describe('hook stdin decoding', () => {
  it('reads stdin and writes one valid hook JSON result', async () => {
    const { dataDir, transcriptPath } = await makeFixture();
    const input = JSON.stringify({
      hook_event_name: 'UserPromptSubmit',
      session_id: sessionId,
      turn_id: turnId,
      cwd,
      transcript_path: transcriptPath,
    });
    const written: string[] = [];
    const diagnostics: string[] = [];
    let exitCode = 0;
    async function* stdin(): AsyncGenerator<Uint8Array> {
      const bytes = Buffer.from(input);
      const split = bytes.indexOf(Buffer.from('ï')) + 1;
      yield bytes.subarray(0, split);
      yield bytes.subarray(split);
    }
    await runHookEntry({
      stdin: stdin(),
      environment: { CODEX_PLUGIN_DATA: dataDir },
      writeStdout: (value) => written.push(value),
      writeStderr: (value) => diagnostics.push(value),
      setExitCode: (value) => (exitCode = value),
    });
    expect(exitCode).toBe(0);
    expect(JSON.parse(written.join(''))).toMatchObject({
      hookSpecificOutput: { hookEventName: 'UserPromptSubmit' },
    });
  });

  it.each(['{', JSON.stringify({ hook_event_name: 'Stop' })])(
    'sets failure status without output for invalid hook input',
    async (input) => {
      const written: string[] = [];
      const diagnostics: string[] = [];
      let exitCode = 0;
      async function* stdin(): AsyncGenerator<string> {
        yield input;
      }
      await runHookEntry({
        stdin: stdin(),
        environment: {},
        writeStdout: (value) => written.push(value),
        writeStderr: (value) => diagnostics.push(value),
        setExitCode: (value) => (exitCode = value),
      });
      expect({ exitCode, written }).toEqual({ exitCode: 1, written: [] });
    },
  );
});

describe('safe failure diagnostics', () => {
  it.each([
    ['{"credential":"sentinel-secret",', {}, 'Invalid hook JSON input'],
    ['{}', {}, 'Unexpected hook event'],
    [
      JSON.stringify({
        hook_event_name: 'UserPromptSubmit',
        session_id: sessionId,
        turn_id: turnId,
        cwd,
      }),
      {},
      'Plugin data directory is unavailable or ambiguous',
    ],
    [
      JSON.stringify({
        hook_event_name: 'UserPromptSubmit',
        session_id: sessionId,
        turn_id: turnId,
        cwd,
      }),
      { PLUGIN_DATA: '/tmp' },
      'Missing absolute transcript_path',
    ],
  ])('reports the failure without exposing input', async (input, environment, reason) => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    let exitCode = 0;
    await runHookEntry({
      stdin: (async function* () {
        yield input;
      })(),
      environment,
      writeStdout: (value) => stdout.push(value),
      writeStderr: (value) => stderr.push(value),
      setExitCode: (value) => {
        exitCode = value;
      },
    });
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: [],
      stderr: [`Ultra Code hook failed: ${reason}\n`],
      exitCode: 1,
    });
    expect(stderr.join('')).not.toContain('sentinel-secret');
  });
});

describe('filesystem and transport diagnostics', () => {
  it('reports storage failures without exposing the filesystem path', async () => {
    const { dataDir, transcriptPath } = await makeFixture();
    await writeFile(dataDir, 'sentinel-secret');
    const stderr: string[] = [];
    let exitCode = 0;
    await runHookEntry({
      stdin: (async function* () {
        yield JSON.stringify({
          hook_event_name: 'UserPromptSubmit',
          session_id: sessionId,
          turn_id: turnId,
          cwd,
          transcript_path: transcriptPath,
        });
      })(),
      environment: { PLUGIN_DATA: dataDir },
      writeStdout: () => {
        throw new Error('Unexpected success');
      },
      writeStderr: (value) => stderr.push(value),
      setExitCode: (value) => {
        exitCode = value;
      },
    });
    expect(exitCode).toBe(1);
    expect(stderr).toEqual(['Ultra Code hook failed: Filesystem error (ENOTDIR during mkdir)\n']);
    expect(stderr.join('')).not.toContain(dataDir);
  });

  it('sanitizes unexpected stdin failures', async () => {
    const stderr: string[] = [];
    let exitCode = 0;
    await runHookEntry({
      stdin: (async function* () {
        yield '{';
        throw new Error('sentinel-secret');
      })(),
      environment: {},
      writeStdout: () => {
        throw new Error('Unexpected success');
      },
      writeStderr: (value) => stderr.push(value),
      setExitCode: (value) => {
        exitCode = value;
      },
    });
    expect({ stderr, exitCode }).toEqual({
      stderr: ['Ultra Code hook failed: Unexpected hook failure\n'],
      exitCode: 1,
    });
  });
});
