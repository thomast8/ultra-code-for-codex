import packageMetadata from '../../package.json' with { type: 'json' };
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';
import { localEndpoint, type Endpoint } from './endpoint.js';
import { waitForStartup } from './startup.js';
import { ReplyReader } from './reply.js';

export type DaemonCall = (method: string, params: unknown) => Promise<unknown>;
export type LaunchDaemon = (dataDir: string) => Promise<'endpoint' | void>;

async function launchInstalledDaemon(dataDir: string): Promise<'endpoint' | void> {
  const attemptId = randomUUID();
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL('./daemon-entry.js', import.meta.url)), dataDir, attemptId],
    {
      detached: true,
      stdio: 'ignore',
    },
  );
  await new Promise<void>((resolve, reject) => {
    child.once('error', () => reject(new Error('Could not start the Ultra Code runtime')));
    child.once('spawn', resolve);
  });
  child.unref();
  return waitForStartup(dataDir, attemptId);
}

function exchange(endpoint: Endpoint, method: string, params: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(endpoint.socketPath);
    const id = randomUUID();
    const reader = new ReplyReader(id);
    let settled = false;
    const timer = setTimeout(
      () => finish(new Error('Ultra Code runtime request timed out')),
      30_000,
    );
    function finish(error?: Error, result?: unknown): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve(result);
    }
    socket.once('error', finish);
    socket.once('connect', () =>
      socket.write(
        `${JSON.stringify({ id, token: endpoint.token, version: packageMetadata.version, method, params })}\n`,
      ),
    );
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      try {
        const reply = reader.accept(chunk);
        if (reply) finish(undefined, reply.result);
      } catch (error) {
        finish(
          error instanceof SyntaxError
            ? new Error('Invalid Ultra Code runtime response')
            : (error as Error),
        );
      }
    });
    socket.once('end', () => finish(new Error('Ultra Code runtime closed without a response')));
  });
}

function absent(error: unknown): boolean {
  return ['ENOENT', 'ECONNREFUSED'].includes((error as NodeJS.ErrnoException).code ?? '');
}

export function createDaemonClient(
  dataDir: string,
  launch: LaunchDaemon = launchInstalledDaemon,
): DaemonCall {
  let starting: Promise<'endpoint' | void> | undefined;
  return async (method, params) => {
    const endpoint = localEndpoint(dataDir);
    try {
      return await exchange(endpoint, method, params);
    } catch (error) {
      if (!absent(error)) throw error;
    }
    starting ??= launch(endpoint.dataDir).finally(() => {
      starting = undefined;
    });
    const startup = await starting;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      try {
        return await exchange(endpoint, method, params);
      } catch (error) {
        if (!absent(error)) throw error;
      }
    }
    throw new Error(
      startup === 'endpoint'
        ? 'Ultra Code runtime endpoint could not be acquired'
        : 'Ultra Code runtime did not start within five seconds',
    );
  };
}
