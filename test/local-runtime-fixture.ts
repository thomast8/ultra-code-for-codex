import { mkdtempSync, mkdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkflowEngine } from '../src/runtime/engine.js';
import { serveDaemon } from '../src/daemon.js';
import { createDaemonClient } from '../src/local/client.js';
import { authority, output } from './runtime-fixture.js';

export function localFixture() {
  const profile = realpathSync(mkdtempSync(join(tmpdir(), 'ultra-local-')));
  const dataDir = join(profile, 'plugins', 'data', 'ultra-code');
  mkdirSync(dataDir, { recursive: true });
  const grant = { ...authority, context: { ...authority.context, instanceId: profile } };
  return { dataDir, grant, owner: { instanceId: profile, sessionId: grant.context.sessionId } };
}
export async function runningFixture() {
  const fixture = localFixture();
  const daemon = await serveDaemon(
    fixture.dataDir,
    () =>
      new WorkflowEngine({
        dataDir: join(fixture.dataDir, 'runtime'),
        executeWorker: async () => output('résultat'),
      }),
  );
  const call = createDaemonClient(fixture.dataDir, async () => {
    throw new Error('Unexpected launch');
  });
  return {
    ...fixture,
    daemon,
    call,
    close: async () => {
      await daemon.engine.close();
      await daemon.close();
    },
  };
}
