import { readFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { NODE_RUNTIME_REQUIRED } from './node-runtime.js';

const messages = {
  ready: '',
  journal: 'Ultra Code workflow journal could not be opened or restored',
  permissions: 'Ultra Code runtime filesystem access was denied',
  endpoint: 'Ultra Code runtime endpoint could not be acquired',
  version: NODE_RUNTIME_REQUIRED,
  initialization: 'Ultra Code runtime initialization failed',
} as const;
const receiptSchema = z.strictObject({
  attemptId: z.uuid(),
  reason: z.enum(['ready', 'journal', 'permissions', 'endpoint', 'version', 'initialization']),
});
type Reason = keyof typeof messages;

export function startupFailureReason(error: unknown): Reason {
  if (!(error instanceof Error)) return 'initialization';
  const code = (error as NodeJS.ErrnoException).code;
  const message = error.message;
  if (code === 'EACCES' || code === 'EPERM') return 'permissions';
  if (
    error instanceof SyntaxError ||
    code === 'ERR_SQLITE_ERROR' ||
    message.includes('workflow journal')
  )
    return 'journal';
  if (code === 'EADDRINUSE' || message.includes('runtime already running')) return 'endpoint';
  if (message === NODE_RUNTIME_REQUIRED) return 'version';
  return 'initialization';
}

export function writeStartupReceipt(
  dataDir: string,
  attemptId: string | undefined,
  reason: Reason,
): void {
  if (!z.uuid().safeParse(attemptId).success) return;
  try {
    writeFileSync(
      join(dataDir, 'runtime', `startup-${attemptId}.json`),
      JSON.stringify({ attemptId, reason }),
      { flag: 'wx', mode: 0o600 },
    );
  } catch {
    // If private storage is unavailable, the caller reports missing readiness without raw errors.
  }
}

async function readReason(dataDir: string, attemptId: string): Promise<Reason | undefined> {
  let raw: string;
  try {
    raw = await readFile(join(dataDir, 'runtime', `startup-${attemptId}.json`), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw new Error('Ultra Code startup diagnostic could not be read', { cause: error });
  }
  try {
    if (Buffer.byteLength(raw) > 1024) throw new Error();
    const receipt = receiptSchema.parse(JSON.parse(raw));
    if (receipt.attemptId !== attemptId) throw new Error();
    return receipt.reason;
  } catch {
    throw new Error('Invalid Ultra Code startup diagnostic');
  }
}

export async function waitForStartup(
  dataDir: string,
  attemptId: string,
): Promise<'endpoint' | void> {
  const deadline = Date.now() + 5000;
  do {
    const reason = await readReason(dataDir, attemptId);
    if (reason === 'ready') return;
    if (reason === 'endpoint') return reason;
    if (reason) throw new Error(messages[reason]);
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (Date.now() <= deadline);
  throw new Error('Ultra Code runtime did not report readiness within five seconds');
}
