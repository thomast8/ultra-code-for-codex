import { isAbsolute, resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { currentSessionKey } from '../activation/registry.js';
import type { ContextResolver } from './panel-server.js';
import { realpath } from 'node:fs/promises';

// Manual launches lack a context handle, so restoration keeps both host aliases.
const threadIdentity = z
  .object({ thread_id: z.uuid(), threadId: z.uuid() })
  .refine((metadata) => metadata.thread_id === metadata.threadId);

const routedContextIdentity = z
  .object({ thread_id: z.uuid().optional(), threadId: z.uuid().optional() })
  .refine((metadata) => metadata.thread_id !== undefined || metadata.threadId !== undefined);

export function requestMetadataKind(metadata: unknown): 'absent' | 'generic' | 'routed' {
  if (metadata === undefined) return 'absent';
  if (
    metadata !== null &&
    typeof metadata === 'object' &&
    !Array.isArray(metadata) &&
    !Object.hasOwn(metadata, 'thread_id') &&
    !Object.hasOwn(metadata, 'threadId')
  )
    return 'generic';
  return 'routed';
}

export function assertRoutedContext(metadata: unknown, sessionId: string): void {
  // MCP progress and extension metadata do not establish chat routing.
  if (requestMetadataKind(metadata) !== 'routed') return;
  const identity = routedContextIdentity.safeParse(metadata);
  if (!identity.success) {
    const issues = identity.error.issues
      .map((issue) => `${String(issue.path[0] ?? 'aliases')}:${issue.code}`)
      .join(', ');
    throw new Error(`Routed chat identity is missing, invalid, or conflicting (${issues})`);
  }
  const ids = [identity.data.thread_id, identity.data.threadId];
  if (ids.some((id) => id !== undefined && id !== sessionId))
    throw new Error('Context handle does not belong to the routed chat');
}

export function restorePanelOwner(
  bindings: DatabaseSync,
  nonce: string,
  dataDir: string,
  metadata: unknown,
): string | undefined {
  const identity = threadIdentity.safeParse(metadata);
  const profile = profileFrom(dataDir);
  if (!identity.success || !profile) return;
  const sessionId = identity.data.thread_id;
  const owner = `${profile}\u0000${sessionId}`;
  const restored = bindings
    .prepare(
      `UPDATE bindings SET state = 'bound', owner = ?
       WHERE nonce = ? AND state = 'pending'
       AND EXISTS (SELECT 1 FROM bindings WHERE owner = ? AND state = 'bound')
       RETURNING nonce`,
    )
    .get(owner, nonce, owner);
  return restored ? sessionId : undefined;
}

export async function currentPanelContextKey(
  dataDir: string,
  metadata: unknown,
  resolver: ContextResolver,
): Promise<string | undefined> {
  const sessionId = currentPanelSessionId(metadata);
  const profile = profileFrom(dataDir);
  if (!sessionId || !profile) return;
  try {
    const key = await currentSessionKey(dataDir, sessionId);
    if (!key) return;
    const context = await resolver(key, dataDir);
    if (
      context.resolutionStatus !== 'verified' ||
      context.instanceId !== (await realpath(profile)) ||
      context.sessionId !== sessionId
    )
      return;
    return key;
  } catch {
    return undefined;
  }
}

function currentPanelSessionId(metadata: unknown): string | undefined {
  const identity = routedContextIdentity.safeParse(metadata);
  if (!identity.success) return;
  const { thread_id, threadId } = identity.data;
  if (thread_id && threadId && thread_id !== threadId) return;
  return thread_id ?? threadId;
}

function profileFrom(dataDir: string): string | undefined {
  if (!isAbsolute(dataDir) || resolve(dataDir) !== dataDir) return;
  return /^(.+)\/plugins\/data\/[^/]+$/.exec(dataDir)?.[1];
}
