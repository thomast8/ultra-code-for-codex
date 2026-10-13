import { WorkflowEngine } from './runtime/engine.js';
import { executeWorker, readWorkerCapabilities } from './codex/worker.js';
import { serveDaemon } from './daemon.js';
import { join } from 'node:path';

if (process.versions.node !== '26.10.0') throw new Error('Node 26.10.0 is required');
const dataDir = process.argv[2];
if (!dataDir) throw new Error('Plugin data directory is required');
try {
  const daemon = await serveDaemon(
    dataDir,
    () =>
      new WorkflowEngine({
        dataDir: join(dataDir, 'runtime'),
        executeWorker,
      }),
    readWorkerCapabilities,
  );
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await daemon.engine.close();
    await daemon.close();
  };
  process.once('SIGTERM', () => {
    void close();
  });
  process.once('SIGINT', () => {
    void close();
  });
} catch {
  process.exitCode = 1;
}
