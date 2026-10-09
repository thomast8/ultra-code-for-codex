import { isAbsolute, resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';

// shortcut: requires Desktop's two routed thread aliases, extend after live host verification.
const threadIdentity = z
  .object({ thread_id: z.uuid(), threadId: z.uuid() })
  .refine((metadata) => metadata.thread_id === metadata.threadId);

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

function profileFrom(dataDir: string): string | undefined {
  if (!isAbsolute(dataDir) || resolve(dataDir) !== dataDir) return;
  return /^(.+)\/plugins\/data\/[^/]+$/.exec(dataDir)?.[1];
}
