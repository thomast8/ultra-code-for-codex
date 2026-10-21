import { expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { filesystemAuthority } from '../src/activation/permissions.js';
import { parseExactTurn } from '../src/activation/session-source.js';
import {
  compatibilityRows,
  fixtureInput,
  serializeRows,
} from './activation-compatibility-fixture.js';

const rootRead = { path: { type: 'special', value: { kind: 'root' } }, access: 'read' };
const entry = (path: string, access = 'write') => ({ path: { type: 'path', path }, access });
const policy = (...entries: unknown[]) => ({ kind: 'restricted', entries: [rootRead, ...entries] });

it('carries explicit write roots from exact-turn effective permissions without inferring sibling access', () => {
  const { session, turn } = compatibilityRows();
  const permissions = policy(
    entry(fixtureInput.cwd),
    entry('/workspace/other'),
    entry(`${fixtureInput.cwd}/.git`, 'read'),
  );
  const parsed = parseExactTurn(
    serializeRows(session, {
      ...turn,
      payload: { ...turn.payload, file_system_sandbox_policy: permissions },
    }),
    fixtureInput,
  );
  expect(parsed.filesystem).toEqual({
    readAll: true,
    writableRoots: ['/workspace/other', fixtureInput.cwd],
  });
});

it('does not grant writes to a root with additional protected children', () => {
  expect(filesystemAuthority(policy(entry('/work'), entry('/work/secrets', 'read')))).toEqual({
    readAll: true,
    writableRoots: [],
  });
  expect(filesystemAuthority(policy())).toEqual({ readAll: true, writableRoots: [] });
});

it('canonicalizes restrictions through aliases before granting a writer root', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'ultra-permission-alias-')));
  const secret = join(root, 'private');
  mkdirSync(secret);
  const alias = `${root}-alias`;
  symlinkSync(secret, alias);
  expect(filesystemAuthority(policy(entry(root), entry(alias, 'read')))).toEqual({
    readAll: true,
    writableRoots: [],
  });
});

it.each([
  undefined,
  { kind: 'unrestricted' },
  { kind: 'restricted', entries: [entry('/work')] },
  policy(entry('/work', 'deny')),
  policy(entry('relative')),
  policy(entry('/dev/null/child')),
  policy({ path: { type: 'glob_pattern', pattern: '**/secret' }, access: 'read' }),
  policy({ path: { type: 'special', value: { kind: 'unknown' } }, access: 'read' }),
])('fails closed on missing or unsupported effective permissions: %j', (value) => {
  expect(filesystemAuthority(value)).toBeUndefined();
});
