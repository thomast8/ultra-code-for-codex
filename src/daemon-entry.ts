import { WorkflowEngine } from './runtime/engine.js';
import { executeWorker, readWorkerCapabilities } from './codex/worker.js';
import { serveDaemon } from './daemon.js';
import { join } from 'node:path';
import { startupFailureReason, writeStartupReceipt } from './local/startup.js';

const dataDir = process.argv[2];
if (!dataDir) throw new Error('Plugin data directory is required');
try {
  if (process.versions.node !== '26.10.0') throw new Error('Node 26.10.0 is required');
  const daemon = await serveDaemon(
    dataDir,
    () =>
      new WorkflowEngine({
        dataDir: join(dataDir, 'runtime'),
        executeWorker,
      }),
    readWorkerCapabilities,
  );
  writeStartupReceipt(dataDir, process.argv[3], 'ready');
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
} catch (error) {
  writeStartupReceipt(dataDir, process.argv[3], startupFailureReason(error));
  process.exitCode = 1;
}
