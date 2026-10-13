import packageMetadata from '../package.json' with { type: 'json' };
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { chmod, lstat, unlink } from 'node:fs/promises';
import { createConnection, createServer, type Server, type Socket } from 'node:net';
import { resolve } from 'node:path';
import { localEndpoint, type Endpoint } from './local/endpoint.js';
import { routeDaemon, type EngineService, type CapabilitiesReader } from './local/router.js';
import { assertPayloadBound } from './contracts/schema.js';
import { acquireDaemonLock } from './local/lock.js';

const requestSchema = z.strictObject({
  id: z.string().min(1).max(512),
  token: z.string().length(64),
  version: z.string().min(1).max(64),
  method: z.string().min(1).max(80),
  params: z.unknown(),
});
type Request = z.infer<typeof requestSchema>;

function checkProfile(request: Request, dataDir: string): void {
  const params = request.params as {
    owner?: { instanceId?: string };
    authority?: { context?: { instanceId?: string } };
  } | null;
  const instance = params?.owner?.instanceId ?? params?.authority?.context?.instanceId;
  if (instance && instance !== resolve(dataDir, '../../..')) {
    throw new Error('Runtime request belongs to another profile');
  }
}

function authorize(value: unknown, endpoint: Endpoint): Request {
  const request = requestSchema.parse(value);
  if (!timingSafeEqual(Buffer.from(endpoint.token), Buffer.from(request.token))) {
    throw new Error('Runtime request denied');
  }
  if (request.version !== packageMetadata.version)
    throw new Error(
      `Runtime version ${packageMetadata.version} differs from installed client ${request.version}; finish active work and restart this plugin runtime`,
    );
  checkProfile(request, endpoint.dataDir);
  return request;
}

function safeError(error: unknown): string {
  if (error instanceof Error && error.name === 'ZodError') return 'Invalid runtime request fields';
  return error instanceof Error ? error.message : 'Ultra Code runtime failed';
}

async function respond(
  socket: Socket,
  line: string,
  endpoint: Endpoint,
  engine: EngineService,
  capabilities?: CapabilitiesReader,
): Promise<void> {
  let id = '';
  try {
    const request = authorize(JSON.parse(line) as unknown, endpoint);
    id = request.id;
    const result = await routeDaemon(engine, request.method, request.params, capabilities);
    const reply = { id, result };
    assertPayloadBound(reply);
    socket.end(`${JSON.stringify(reply)}\n`);
  } catch (error) {
    socket.end(`${JSON.stringify({ id, error: safeError(error) })}\n`);
  }
}

function connectSocket(
  socket: Socket,
  endpoint: Endpoint,
  engine: EngineService,
  capabilities?: CapabilitiesReader,
): void {
  let buffer = '';
  let submitted = false;
  socket.setTimeout(30_000, () => socket.destroy());
  socket.on('error', () => socket.destroy());
  socket.setEncoding('utf8');
  socket.on('data', (chunk: string) => {
    if (submitted) return;
    buffer += chunk;
    if (Buffer.byteLength(buffer) > 1_048_576) {
      socket.destroy();
      return;
    }
    const end = buffer.indexOf('\n');
    if (end < 0) return;
    submitted = true;
    void respond(socket, buffer.slice(0, end), endpoint, engine, capabilities);
  });
}

async function socketIsLive(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection(path);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.setTimeout(1_000, () => {
      socket.destroy();
      resolve(true);
    });
  });
}

async function clearStaleSocket(path: string): Promise<void> {
  try {
    const stat = await lstat(path);
    if (!stat.isSocket() || (process.getuid && stat.uid !== process.getuid()))
      throw new Error('Unowned runtime endpoint');
    if (await socketIsLive(path)) throw new Error('Ultra Code runtime already running');
    const current = await lstat(path);
    if (current.ino !== stat.ino || current.dev !== stat.dev)
      throw new Error('Runtime endpoint changed');
    await unlink(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

export async function serveDaemon<E extends EngineService>(
  dataDir: string,
  createEngine: () => E,
  capabilities?: CapabilitiesReader,
): Promise<{ close(): Promise<void>; server: Server; engine: E }> {
  const endpoint = localEndpoint(dataDir);
  const release = acquireDaemonLock(endpoint.dataDir);
  const server = createServer();
  const sockets = new Set<Socket>();
  try {
    await clearStaleSocket(endpoint.socketPath);
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(endpoint.socketPath, resolve);
    });
    await chmod(endpoint.socketPath, 0o600);
    const engine = createEngine();
    server.on('connection', (socket) => {
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
      connectSocket(socket, endpoint, engine, capabilities);
    });
    return {
      server,
      engine,
      close: () =>
        new Promise((resolve, reject) => {
          for (const socket of sockets) socket.destroy();
          server.close((error) => {
            release();
            if (error) reject(error);
            else resolve();
          });
        }),
    };
  } catch (error) {
    server.close();
    release();
    throw error;
  }
}
