import { chmodSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { JsonValue, WorkflowEvent } from '../contracts/workflow.js';
import type { Owner, RunRecord } from './types.js';
import { parseRecord } from './persistence.js';
import { reviewIntervals } from './review-timing.js';

export class Journal {
  private readonly db: DatabaseSync;
  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    chmodSync(dataDir, 0o700);
    this.db = new DatabaseSync(join(dataDir, 'workflow.sqlite'));
    chmodSync(join(dataDir, 'workflow.sqlite'), 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, record TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (cursor INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL, type TEXT NOT NULL, timestamp INTEGER NOT NULL, data TEXT NOT NULL);`);
  }
  load(): RunRecord[] {
    return this.db
      .prepare('SELECT record FROM runs ORDER BY rowid')
      .all()
      .map((row) => parseRecord(String(row.record)));
  }
  save(run: RunRecord, type: string, data: JsonValue = null): void {
    run.snapshot.updatedAt = Date.now();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db
        .prepare(
          'INSERT INTO runs VALUES (?,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record',
        )
        .run(run.snapshot.id, JSON.stringify(run));
      this.db
        .prepare('INSERT INTO events (run_id,type,timestamp,data) VALUES (?,?,?,?)')
        .run(run.snapshot.id, type, run.snapshot.updatedAt, JSON.stringify(data));
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  events(owner: Owner, afterCursor: number, runIds?: string[]): WorkflowEvent[] {
    if (runIds?.length === 0) return [];
    const restriction = runIds ? `AND e.run_id IN (${runIds.map(() => '?').join(',')})` : '';
    return this.db
      .prepare(
        `SELECT e.* FROM events e JOIN runs r ON r.id=e.run_id
      WHERE e.cursor>? AND json_extract(r.record,'$.owner.instanceId')=?
      AND json_extract(r.record,'$.owner.sessionId')=? ${restriction}
      ORDER BY e.cursor LIMIT 1000`,
      )
      .all(afterCursor, owner.instanceId, owner.sessionId, ...(runIds ?? []))
      .map((row) => ({
        cursor: Number(row.cursor),
        runId: String(row.run_id),
        type: String(row.type),
        timestamp: Number(row.timestamp),
        data: JSON.parse(String(row.data)) as JsonValue,
      }));
  }
  currentCursor(runIds: string[]): number {
    const query = this.db.prepare(
      'SELECT COALESCE(MAX(cursor),0) AS cursor FROM events WHERE run_id=?',
    );
    return runIds.reduce((latest, id) => Math.max(latest, Number(query.get(id)!.cursor)), 0);
  }
  leadReviews(runId: string) {
    const rows = this.db
      .prepare(
        `SELECT type, timestamp,
        COALESCE(json_extract(data,'$.handoffId'), json_extract(data,'$.callId'),
          json_extract(data,'$.taskId')) AS reference
        FROM events WHERE run_id=? AND type IN (
          'handoff.claimed','worker.readback_claimed','lead.result','handoff.result',
          'worker.readback_resolved','run.reconciliation_required','run.cancel',
          'run.cancelled','run.failed','run.completed') ORDER BY cursor`,
      )
      .all(runId);
    return reviewIntervals(
      rows.map((row) => ({
        type: String(row.type),
        timestamp: Number(row.timestamp),
        reference: typeof row.reference === 'string' ? row.reference : null,
      })),
    );
  }
  close(): void {
    this.db.close();
  }
}
