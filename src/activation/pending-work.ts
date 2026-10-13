import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { LeadContext } from './types.js';

const rowSchema = z.strictObject({
  state: z.enum([
    'queued',
    'running',
    'paused',
    'cancelled',
    'completed',
    'failed',
    'needs_reconciliation',
  ]),
  handoffs: z.number().int().nonnegative(),
});
export function pendingWorkNotice(dataDir: string, context: LeadContext): string {
  if (context.resolutionStatus !== 'verified') return '';
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(join(dataDir, 'runtime', 'workflow.sqlite'), {
      readOnly: true,
      timeout: 0,
    });
    const rows = database
      .prepare(
        `SELECT json_extract(record,'$.snapshot.state') AS state,
      (SELECT COUNT(*) FROM json_each(r.record,'$.calls') AS c
       WHERE json_extract(c.value,'$.handoff.state') IN ('claimed','needs_reconciliation')
       OR (json_extract(c.value,'$.handoff.state') = 'pending'
       AND json_extract(r.record,'$.snapshot.state') NOT IN ('cancelled','failed','completed'))) AS handoffs
      FROM runs r WHERE json_extract(record,'$.version')=1
      AND json_extract(record,'$.owner.instanceId')=? AND json_extract(record,'$.owner.sessionId')=?`,
      )
      .all(context.instanceId, context.sessionId)
      .map((row) => rowSchema.parse(row));
    if (!rows.length) return '';
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(row.state, (counts.get(row.state) ?? 0) + 1);
    const handoffs = rows.reduce((count, row) => count + row.handoffs, 0);
    return formatPendingWorkNotice(counts, handoffs);
  } catch {
    return '';
  } finally {
    database?.close();
  }
}

export function formatPendingWorkNotice(
  counts: ReadonlyMap<string, number>,
  handoffs: number,
): string {
  const states = [...counts]
    .map(([state, count]) => `${state === 'needs_reconciliation' ? 'reconcile' : state}:${count}`)
    .join(' ');
  return `Runs ${states}; unresolved lead handoffs:${handoffs}; ultra_status.`;
}
