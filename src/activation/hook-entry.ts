import { runUserPromptHook } from './hook.js';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { StringDecoder } from 'node:string_decoder';

export interface HookEntryIO {
  stdin: AsyncIterable<string | Uint8Array>;
  environment: NodeJS.ProcessEnv;
  writeStdout(value: string): void;
  setExitCode(value: number): void;
}

interface HookProcess {
  stdin: AsyncIterable<string | Uint8Array>;
  env: NodeJS.ProcessEnv;
  stdout: { write(value: string): unknown };
  exitCode: NodeJS.Process['exitCode'];
}

export function createProcessHookIO(host: HookProcess): HookEntryIO {
  return {
    stdin: host.stdin,
    environment: host.env,
    writeStdout: (value) => host.stdout.write(value),
    setExitCode: (value) => {
      host.exitCode = value;
    },
  };
}

export async function runHookEntry(io: HookEntryIO): Promise<void> {
  let input = '';
  const decoder = new StringDecoder('utf8');
  for await (const chunk of io.stdin)
    input +=
      typeof chunk === 'string' ? `${decoder.end()}${chunk}` : decoder.write(Buffer.from(chunk));
  input += decoder.end();
  try {
    const output = await runUserPromptHook(JSON.parse(input) as unknown, io.environment);
    io.writeStdout(`${JSON.stringify(output)}\n`);
  } catch {
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
