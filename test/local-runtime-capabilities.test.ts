import { createConnection } from 'node:net';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import packageMetadata from '../package.json';
import { serveDaemon } from '../src/daemon.js';
import { createDaemonClient } from '../src/local/client.js';
import { localEndpoint, type Endpoint } from '../src/local/endpoint.js';
import { routeDaemon, type CapabilitiesReader } from '../src/local/router.js';
import { WorkflowEngine } from '../src/runtime/engine.js';
import { localFixture, runningFixture } from './local-runtime-fixture.js';
import { output, request } from './runtime-fixture.js';

function exchange(endpoint: Endpoint, packet: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(endpoint.socketPath);
    let buffer = '';
    socket.setTimeout(3_000, () => socket.destroy(new Error('Fixture socket timed out')));
    socket.setEncoding('utf8');
    socket.once('error', reject);
    socket.once('connect', () => socket.end(`${JSON.stringify(packet)}\n`));
    socket.on('data', (chunk: string) => {
      buffer += chunk;
    });
    socket.once('end', () => {
      try {
        resolve(JSON.parse(buffer) as unknown);
      } catch (error) {
        reject(error);
      }
    });
  });
}

it.each(['0.1.4', 'future-test-version'])(
  'refuses authenticated client version %s before workflow dispatch',
  async (version) => {
    const f = await runningFixture();
    const start = vi.spyOn(f.daemon.engine, 'start');
    const endpoint = localEndpoint(f.dataDir);
    try {
      expect(
        await exchange(endpoint, {
          id: 'incompatible',
          token: endpoint.token,
          version,
          method: 'start',
          params: { request: request(), authority: f.grant },
        }),
      ).toMatchObject({
        error: `Runtime version ${packageMetadata.version} differs from installed client ${version}; finish active work and restart this plugin runtime`,
      });
      expect(start).not.toHaveBeenCalled();
      expect(f.daemon.engine.status(f.owner)).toEqual([]);
      expect(await f.call('health', {})).toMatchObject({
        protocol: 'ultra-daemon-v1',
        version: packageMetadata.version,
        pid: process.pid,
      });
    } finally {
      await f.close();
    }
  },
);

it('rejects legacy requests with no version before dispatch', async () => {
  const f = await runningFixture();
  const start = vi.spyOn(f.daemon.engine, 'start');
  const endpoint = localEndpoint(f.dataDir);
  try {
    expect(
      await exchange(endpoint, {
        id: 'legacy',
        token: endpoint.token,
        method: 'start',
        params: { request: request(), authority: f.grant },
      }),
    ).toMatchObject({ error: 'Invalid runtime request fields' });
    expect(start).not.toHaveBeenCalled();
  } finally {
    await f.close();
  }
});

it('routes capability metadata using the verified profile and cwd without dispatching a worker', async () => {
  const f = localFixture();
  const metadata = { models: [{ model: 'catalog-model', reasoningEfforts: ['medium'] }] };
  const capabilities = vi.fn<CapabilitiesReader>(async () => metadata);
  const worker = vi.fn(async () => output());
  const daemon = await serveDaemon(
    f.dataDir,
    () =>
      new WorkflowEngine({
        dataDir: join(f.dataDir, 'runtime'),
        executeWorker: worker,
      }),
    capabilities,
  );
  const call = createDaemonClient(f.dataDir, async () => {
    throw new Error('Unexpected launch');
  });
  try {
    expect(await call('capabilities', { owner: f.owner, cwd: '/verified/cwd' })).toEqual(metadata);
    expect(capabilities).toHaveBeenCalledExactlyOnceWith(f.owner.instanceId, '/verified/cwd');
    await expect(
      call('capabilities', { owner: { ...f.owner, instanceId: '/foreign' }, cwd: '/foreign' }),
    ).rejects.toThrow('another profile');
    expect(capabilities).toHaveBeenCalledTimes(1);
    expect(worker).not.toHaveBeenCalled();
    expect(daemon.engine.status(f.owner)).toEqual([]);
  } finally {
    await daemon.engine.close();
    await daemon.close();
  }
});

it('fails capability reads explicitly when no reader is configured', async () => {
  const f = await runningFixture();
  try {
    await expect(
      routeDaemon(f.daemon.engine, 'capabilities', { owner: f.owner, cwd: '/tmp' }),
    ).rejects.toThrow('Worker capability reader unavailable');
  } finally {
    await f.close();
  }
});
