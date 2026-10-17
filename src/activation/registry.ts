import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { readExactTurn } from './session-source.js';
import type { HookInput, LeadContext, ResolveOptions, StoredContext } from './types.js';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isLeadContext(value: unknown): value is LeadContext {
  if (!isObject(value)) return false;
  const fields = [
    value.instanceId,
    value.sessionId,
    value.turnId,
    value.cwd,
    value.model,
    value.effort,
    value.resolutionReason,
  ];
  return (
    fields.every((field) => typeof field === 'string' && field.length > 0) &&
    ['default', 'plan', 'unknown'].includes(String(value.collaborationMode)) &&
    ['verified', 'unknown'].includes(String(value.resolutionStatus))
  );
}

function isStoredContext(value: unknown): value is StoredContext {
  if (!isObject(value) || !isLeadContext(value.context)) return false;
  return (
    value.schema === 'ultra-context-v1' &&
    value.resolutionStatus === value.context.resolutionStatus &&
    value.resolutionReason === value.context.resolutionReason
  );
}

function contextFile(dataDir: string, contextKey: string): string {
  if (!/^uctx_[0-9a-f-]{36}$/.test(contextKey)) throw new Error('Invalid context key');
  return join(dataDir, 'activation', `${contextKey}.json`);
}

async function atomicWrite(path: string, value: string): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(value, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

export async function registerContext(
  input: HookInput,
  dataDir: string,
): Promise<{ contextKey: string }> {
  if (!dataDir) throw new Error('Missing plugin data directory');
  const contextKey = `uctx_${randomUUID()}`;
  const directory = join(dataDir, 'activation');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  // Revoke the previous turn before waiting for new metadata, including failed hooks.
  await atomicWrite(currentFile(dataDir, input.session_id), contextKey);
  const context = await readExactTurn(input);
  const stored: StoredContext = {
    schema: 'ultra-context-v1',
    resolutionStatus: context.resolutionStatus,
    resolutionReason: context.resolutionReason,
    context,
  };
  await atomicWrite(contextFile(dataDir, contextKey), JSON.stringify(stored));
  return { contextKey };
}

async function readStored(path: string): Promise<LeadContext | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    return isStoredContext(parsed) ? parsed.context : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

export async function resolveContext(
  contextKey: string,
  dataDir: string,
  options: ResolveOptions = {},
): Promise<LeadContext> {
  const path = contextFile(dataDir, contextKey);
  const timeout = Math.min(Math.max(options.timeoutMs ?? 5_000, 0), 5_000);
  const deadline = Date.now() + timeout;
  do {
    const context = await readStored(path);
    if (context) return context;
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(50, deadline - Date.now())));
  } while (Date.now() <= deadline);
  throw new Error('Exact-turn context is unavailable');
}

function currentFile(dataDir: string, sessionId: string): string {
  const identity = createHash('sha256').update(sessionId).digest('hex');
  return join(dataDir, 'activation', `current-${identity}`);
}

export async function currentSessionKey(
  dataDir: string,
  sessionId: string,
): Promise<string | undefined> {
  try {
    return await readFile(currentFile(dataDir, sessionId), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

export async function resolveCurrentContext(
  contextKey: string,
  dataDir: string,
): Promise<LeadContext> {
  const context = await resolveContext(contextKey, dataDir);
  let current: string;
  try {
    current = await readFile(currentFile(dataDir, context.sessionId), 'utf8');
  } catch {
    throw new Error('Current-turn registration is unavailable; submit a new prompt');
  }
  if (current !== contextKey)
    throw new Error('This context handle was superseded; use the current prompt hook handle');
  return context;
}
