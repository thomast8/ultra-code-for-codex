import { createHash } from 'node:crypto';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function openBindings(dataDir: string): DatabaseSync {
  const directory = join(dataDir, 'panel');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, 'bindings.sqlite');
  closeSync(openSync(path, 'a', 0o600));
  const database = new DatabaseSync(path, { timeout: 5_000 });
  database.exec(`CREATE TABLE IF NOT EXISTS bindings (
    nonce TEXT PRIMARY KEY,
    state TEXT NOT NULL CHECK (state IN ('pending', 'binding', 'bound', 'failed')),
    owner TEXT
  )`);
  database.exec(`CREATE TABLE IF NOT EXISTS verified_turns (
    session_id TEXT PRIMARY KEY,
    context_key TEXT NOT NULL
  )`);
  return database;
}

// This identifier scopes browser locks; it grants no workflow authority.
export function panelKey(owner: string): string {
  return createHash('sha256').update(owner).digest('hex');
}

export function panelKeyForNonce(bindings: DatabaseSync, nonce: string): string | undefined {
  const row = bindings
    .prepare("SELECT owner FROM bindings WHERE nonce=? AND state='bound'")
    .get(nonce);
  return typeof row?.owner === 'string' ? panelKey(row.owner) : undefined;
}
