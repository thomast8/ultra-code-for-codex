import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { localEndpoint } from '../src/local/endpoint.js';
import { createDaemonClient } from '../src/local/client.js';
import { serveDaemon } from '../src/daemon.js';
import { request, until } from './runtime-fixture.js';
import { localFixture, runningFixture } from './local-runtime-fixture.js';

it('serves immutable workflows over the private socket and keeps owners separate', async () => {
  const f = await runningFixture();
  try {
    expect(await f.call('health', {})).toMatchObject({ protocol: 'ultra-daemon-v1' });
    const created = await f.call('start', {
      request: request('return "café";'),
      authority: f.grant,
    });
    expect(
      await f.call('start', { request: request('return "café";'), authority: f.grant }),
    ).toMatchObject({ id: (created as { id: string }).id });
    await until(() => f.daemon.engine.status(f.owner)[0]?.state === 'completed');
    const run = f.daemon.engine.status(f.owner)[0]!;
    expect(await f.call('result', { owner: f.owner, runId: run.id })).toMatchObject({
      result: 'café',
    });
    expect(await f.call('status', { owner: { ...f.owner, sessionId: 'other' } })).toMatchObject({
      runs: [],
    });
    await expect(
      f.call('status', { owner: { ...f.owner, instanceId: '/foreign' } }),
    ).rejects.toThrow();
    await expect(f.call('invalid', {})).rejects.toThrow('Unknown');
    await expect(f.call('start', {})).rejects.toThrow('Invalid runtime');
    expect(await f.call('wait', { owner: f.owner, afterCursor: 0, timeoutMs: 0 })).toMatchObject({
      events: expect.any(Array),
    });
  } finally {
    await f.close();
  }
});

it('locks startup before reconstructing workers and releases after shutdown', async () => {
  const f = await runningFixture();
  const factory = vi.fn(() => f.daemon.engine);
  await expect(serveDaemon(f.dataDir, factory)).rejects.toThrow('already running');
  expect(factory).not.toHaveBeenCalled();
  await f.close();
  const next = await serveDaemon(f.dataDir, factory);
  expect(factory).toHaveBeenCalledOnce();
  await next.close();
});

it('starts one daemon for simultaneous missing-endpoint requests', async () => {
  const f = localFixture();
  let live: Awaited<ReturnType<typeof runningFixture>> | undefined;
  const launch = vi.fn(async () => {
    const original = await runningFixture();
    await original.close();
    const daemon = await serveDaemon(f.dataDir, () => original.daemon.engine);
    live = { ...original, daemon, close: () => daemon.close() };
  });
  const call = createDaemonClient(f.dataDir, launch);
  try {
    await Promise.all([call('health', {}), call('health', {})]);
    expect(launch).toHaveBeenCalledOnce();
  } finally {
    await live?.close();
  }
});

it('fails closed on endpoint credentials and never overwrites existing keys', () => {
  const f = localFixture();
  const first = localEndpoint(f.dataDir);
  expect(localEndpoint(f.dataDir)).toEqual(first);
  const key = join(f.dataDir, 'runtime', 'daemon.key');
  expect(readFileSync(key, 'utf8')).toBe(first.token);
  chmodSync(key, 0o644);
  expect(() => localEndpoint(f.dataDir)).toThrow('private');
  chmodSync(key, 0o600);
  writeFileSync(key, 'invalid');
  expect(() => localEndpoint(f.dataDir)).toThrow('Invalid');
  expect(() => localEndpoint('relative')).toThrow('Absolute');
});

it('denies an unauthenticated socket request without dispatch', async () => {
  const f = await runningFixture();
  const endpoint = localEndpoint(f.dataDir);
  try {
    const reply = await new Promise<string>((resolve, reject) => {
      const socket = createConnection(endpoint.socketPath);
      socket.setEncoding('utf8');
      socket.once('error', reject);
      socket.once('connect', () =>
        socket.write(
          `${JSON.stringify({
            id: 'forged',
            token: '0'.repeat(64),
            version: '0.2.0',
            method: 'health',
            params: {},
          })}\n`,
        ),
      );
      socket.once('data', (data: string) => {
        socket.destroy();
        resolve(data);
      });
    });
    expect(JSON.parse(reply)).toMatchObject({ error: 'Runtime request denied' });
    expect(f.daemon.engine.status(f.owner)).toEqual([]);
  } finally {
    await f.close();
  }
});
