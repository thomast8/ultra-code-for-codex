import { closeSync, openSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// A separate SQLite transaction provides a process lock released by the OS on crash.
// The workflow journal remains free to transact on its own database.
export function acquireDaemonLock(dataDir: string): () => void {
  const path = join(dataDir, 'runtime', 'daemon-lock.sqlite');
  closeSync(openSync(path, 'a', 0o600));
  const database = new DatabaseSync(path, { timeout: 0 });
  try {
    database.exec('BEGIN EXCLUSIVE');
  } catch {
    database.close();
    throw new Error('Ultra Code runtime already running');
  }
  return () => {
    if (database.isOpen) {
      database.exec('ROLLBACK');
      database.close();
    }
  };
}
