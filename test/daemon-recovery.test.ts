import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { expect, it } from 'vitest';
import { localEndpoint } from '../src/local/endpoint.js';
import { serveDaemon } from '../src/daemon.js';
import { WorkflowEngine } from '../src/runtime/engine.js';
import { localFixture } from './local-runtime-fixture.js';
import { output } from './runtime-fixture.js';

it('recovers the socket left by a terminated owned daemon without touching workflow records', async () => {
  const f = localFixture();
  const endpoint = localEndpoint(f.dataDir);
  const child = spawn(
    process.execPath,
    [
      '-e',
      "require('node:net').createServer().listen(process.argv[1],()=>process.stdout.write('ready\\n'));",
      endpoint.socketPath,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  await new Promise<void>((resolve, reject) => {
    child.stdout.once('data', () => resolve());
    child.once('error', reject);
  });
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  child.kill('SIGKILL');
  await exited;
  const daemon = await serveDaemon(
    f.dataDir,
    () =>
      new WorkflowEngine({
        dataDir: join(f.dataDir, 'runtime'),
        executeWorker: async () => output(),
      }),
  );
  expect(daemon.engine.status(f.owner)).toEqual([]);
  await daemon.engine.close();
  await daemon.close();
});

it('does not replace a live endpoint or a regular file at its path', async () => {
  const f = localFixture();
  const endpoint = localEndpoint(f.dataDir);
  const server = createServer((socket) => socket.destroy());
  await new Promise<void>((resolve) => server.listen(endpoint.socketPath, resolve));
  const factory = () => {
    throw new Error('Must not reconstruct engine');
  };
  await expect(serveDaemon(f.dataDir, factory)).rejects.toThrow('already running');
  await new Promise<void>((resolve) => server.close(() => resolve()));
  writeFileSync(endpoint.socketPath, 'preserved fixture');
  await expect(serveDaemon(f.dataDir, factory)).rejects.toThrow('Unowned runtime endpoint');
});

it('releases the process lock after journal construction fails', async () => {
  const f = localFixture();
  await expect(
    serveDaemon(f.dataDir, () => {
      throw new Error('Corrupt journal');
    }),
  ).rejects.toThrow('Corrupt journal');
  await new Promise((resolve) => setImmediate(resolve));
  const daemon = await serveDaemon(
    f.dataDir,
    () =>
      new WorkflowEngine({
        dataDir: join(f.dataDir, 'runtime'),
        executeWorker: async () => output(),
      }),
  );
  await daemon.engine.close();
  await daemon.close();
});
