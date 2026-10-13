import { createConnection, createServer, type Socket } from 'node:net';
import { chmodSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { localEndpoint } from '../src/local/endpoint.js';
import { createDaemonClient } from '../src/local/client.js';
import { routeDaemon } from '../src/local/router.js';
import { withRuntimeCapability } from '../src/mcp/capability.js';
import { localFixture, runningFixture } from './local-runtime-fixture.js';

async function brokenEndpoint(reply: (socket: Socket, request: { id: string }) => void) {
  const f = localFixture();
  const endpoint = localEndpoint(f.dataDir);
  const server = createServer((socket) => {
    socket.setEncoding('utf8');
    socket.once('data', (data: string) => reply(socket, JSON.parse(data) as { id: string }));
  });
  await new Promise<void>((resolve) => server.listen(endpoint.socketPath, resolve));
  const launch = vi.fn(async () => {});
  return {
    call: createDaemonClient(f.dataDir, launch),
    launch,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

it.each(['lost-ack', 'bad-json', 'wrong-id', 'oversized'])(
  'never retries a dispatched %s request',
  async (mode) => {
    const f = await brokenEndpoint((socket, request) => {
      if (mode === 'lost-ack') socket.end();
      if (mode === 'bad-json') socket.end('not-json\n');
      if (mode === 'wrong-id') socket.end('{"id":"other","result":true}\n');
      if (mode === 'oversized')
        socket.end(JSON.stringify({ id: request.id, result: 'x'.repeat(1_048_576) }) + '\n');
    });
    try {
      await expect(f.call('start', {})).rejects.toThrow();
      expect(f.launch).not.toHaveBeenCalled();
    } finally {
      await f.close();
    }
  },
);

it('keeps a multibyte character intact across socket chunks', async () => {
  const f = await brokenEndpoint((socket, request) => {
    const data = Buffer.from(JSON.stringify({ id: request.id, result: 'résultat' }) + '\n');
    const index = data.indexOf(Buffer.from('é')) + 1;
    socket.write(data.subarray(0, index));
    setImmediate(() => socket.end(data.subarray(index)));
  });
  try {
    expect(await f.call('result', {})).toBe('résultat');
  } finally {
    await f.close();
  }
});

it('surfaces startup rejection without dispatching or changing credentials', async () => {
  const f = localFixture();
  const launch = vi.fn(async () => {
    throw new Error('Pinned runtime missing');
  });
  await expect(createDaemonClient(f.dataDir, launch)('health', {})).rejects.toThrow(
    'Pinned runtime missing',
  );
  expect(launch).toHaveBeenCalledOnce();
  chmodSync(`${f.dataDir}/runtime`, 0o755);
  expect(() => localEndpoint(f.dataDir)).toThrow('private');
});

it('waits without model calls and returns empty event batches after the bounded timeout', async () => {
  const f = await runningFixture();
  try {
    expect(
      await routeDaemon(f.daemon.engine, 'wait', { owner: f.owner, afterCursor: 0, timeoutMs: 5 }),
    ).toEqual({ cursor: 0, events: [] });
    expect(
      await routeDaemon(f.daemon.engine, 'events', { owner: f.owner, afterCursor: 0 }),
    ).toEqual({ cursor: 0, events: [] });
  } finally {
    await f.close();
  }
});

it('does not advertise a runtime whose health request fails', async () => {
  const value = {
    content: [{ type: 'text' as const, text: 'Context' }],
    structuredContent: { bound: true },
  };
  const failed = await withRuntimeCapability(value, async () => {
    throw new Error('Pinned runtime missing');
  });
  expect(failed.structuredContent).toMatchObject({
    bound: true,
    capabilityAvailability: 'unavailable',
    capabilityReason: 'Pinned runtime missing',
  });
  expect(
    (
      await withRuntimeCapability(value, async () => {
        throw 'unknown';
      })
    ).structuredContent?.capabilityReason,
  ).toBe('Workflow runtime is unavailable.');
  expect(await withRuntimeCapability(value)).toBe(value);
});

it('rejects an oversized socket request before parsing it', async () => {
  const f = await runningFixture();
  try {
    await new Promise<void>((resolve, reject) => {
      const socket = createConnection(localEndpoint(f.dataDir).socketPath);
      socket.on('error', (error: NodeJS.ErrnoException) =>
        error.code === 'EPIPE' || error.code === 'ECONNRESET' ? resolve() : reject(error),
      );
      socket.once('connect', () => socket.end('x'.repeat(1_048_577)));
      socket.once('close', () => resolve());
    });
    expect(f.daemon.engine.status(f.owner)).toEqual([]);
  } finally {
    await f.close();
  }
});
