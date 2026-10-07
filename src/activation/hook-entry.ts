import { runUserPromptHook } from './hook.js';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { StringDecoder } from 'node:string_decoder';

export interface HookEntryIO {
  stdin: AsyncIterable<string | Uint8Array>;
  environment: NodeJS.ProcessEnv;
  writeStdout(value: string): void;
  writeStderr(value: string): void;
  setExitCode(value: number): void;
}

interface HookProcess {
  stdin: AsyncIterable<string | Uint8Array>;
  env: NodeJS.ProcessEnv;
  stdout: { write(value: string): unknown };
  stderr: { write(value: string): unknown };
  exitCode: NodeJS.Process['exitCode'];
}

export function createProcessHookIO(host: HookProcess): HookEntryIO {
  return {
    stdin: host.stdin,
    environment: host.env,
    writeStdout: (value) => host.stdout.write(value),
    writeStderr: (value) => host.stderr.write(value),
    setExitCode: (value) => {
      host.exitCode = value;
    },
  };
}

function failureReason(error: unknown): string {
  if (error instanceof SyntaxError) return 'Invalid hook JSON input';
  if (!(error instanceof Error)) return 'Unknown hook failure';
  const safeMessages = [
    'Invalid hook input',
    'Unexpected hook event',
    'Incomplete hook input',
    'Plugin data directory is unavailable or ambiguous',
    'Missing plugin data directory',
    'Missing absolute transcript_path',
    'Transcript path is not a Codex session log',
    'Transcript resolves outside the Codex sessions directory',
  ];
  if (safeMessages.includes(error.message)) return error.message;
  const { code, syscall } = error as NodeJS.ErrnoException;
  const codes = [
    'ENOENT',
    'EACCES',
    'EPERM',
    'ENOTDIR',
    'EISDIR',
    'EEXIST',
    'ENOSPC',
    'EDQUOT',
    'EIO',
    'EMFILE',
    'ENFILE',
    'EROFS',
    'ENAMETOOLONG',
    'ELOOP',
    'EINVAL',
  ];
  if (code && codes.includes(code)) {
    const operations = ['open', 'realpath', 'stat', 'read', 'write', 'mkdir', 'rename', 'fsync'];
    const operation = syscall && operations.includes(syscall) ? ` during ${syscall}` : '';
    return `Filesystem error (${code}${operation})`;
  }
  return 'Unexpected hook failure';
}

export async function runHookEntry(io: HookEntryIO): Promise<void> {
  try {
    let input = '';
    const decoder = new StringDecoder('utf8');
    for await (const chunk of io.stdin)
      input +=
        typeof chunk === 'string' ? `${decoder.end()}${chunk}` : decoder.write(Buffer.from(chunk));
    input += decoder.end();
    const output = await runUserPromptHook(JSON.parse(input) as unknown, io.environment);
    io.writeStdout(`${JSON.stringify(output)}\n`);
  } catch (error) {
    io.writeStderr(`Ultra Code hook failed: ${failureReason(error)}\n`);
    io.setExitCode(1);
  }
}

export async function runIfDirectExecution(
  io: HookEntryIO,
  moduleUrl: string,
  scriptPath: string | undefined,
): Promise<boolean> {
  if (!scriptPath || moduleUrl !== pathToFileURL(resolve(scriptPath)).href) return false;
  await runHookEntry(io);
  return true;
}

if (process.argv[1]) {
  await runIfDirectExecution(createProcessHookIO(process), import.meta.url, process.argv[1]);
}
