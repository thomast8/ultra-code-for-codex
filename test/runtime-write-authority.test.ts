import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { WorkflowEngine } from '../src/runtime/engine.js';
import { authority, harness, output, owner, request, until } from './runtime-fixture.js';

it('rejects a caller-selected writer root outside the verified lead workspace before dispatch', async () => {
  const leadRoot = realpathSync(mkdtempSync(join(tmpdir(), 'ultra-lead-writer-')));
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'ultra-ungranted-writer-')));
  const f = harness();
  const input = request(
    `return await agent("Edit", {access:"workspace-write",cwd:${JSON.stringify(root)}});`,
  );
  delete input.authorityRef;
  try {
    f.engine.start(
      { ...input, contractVersion: 2 },
      {
        ...authority,
        context: {
          ...authority.context,
          cwd: leadRoot,
          filesystem: { readAll: true, writableRoots: [leadRoot] },
        },
        capacity: {
          source: 'host-profile',
          totalSlots: 3,
          reservedSlots: 0,
          evidence: 'Ultra profile limit',
        },
      },
    );
    await until(() => f.calls.length === 1 || f.engine.status(owner)[0]?.state === 'failed');
    expect(f.calls).toHaveLength(0);
    expect(f.engine.status(owner)[0]?.error).toContain('authorized');
  } finally {
    await f.engine.close();
  }
});

it('persists an authorized root and still reads completed legacy records without redispatch', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'ultra-granted-writer-')));
  const f = harness();
  const input = request(
    `return await agent("Edit", {access:"workspace-write",cwd:${JSON.stringify(root)}});`,
  );
  delete input.authorityRef;
  f.engine.start(
    { ...input, contractVersion: 2 },
    {
      ...authority,
      context: { ...authority.context, filesystem: { readAll: true, writableRoots: [root] } },
      capacity: {
        source: 'host-profile',
        totalSlots: 3,
        reservedSlots: 0,
        evidence: 'Ultra profile limit',
      },
    },
  );
  await until(() => f.calls.length === 1);
  expect(f.calls[0]!.spec.assignment.ownership.cwd).toBe(root);
  f.calls[0]!.finish(output('Written'));
  await until(() => f.engine.status(owner)[0]?.state === 'completed');
  await f.engine.close();
  const db = new DatabaseSync(join(f.dataDir, 'workflow.sqlite'));
  const row = db.prepare('SELECT id,record FROM runs').get()!;
  const record = JSON.parse(String(row.record));
  expect(record.authority.context.filesystem.writableRoots).toEqual([root]);
  delete record.authority.context.filesystem;
  db.prepare('UPDATE runs SET record=? WHERE id=?').run(JSON.stringify(record), row.id!);
  db.close();
  const restored = new WorkflowEngine({ dataDir: f.dataDir, executeWorker: f.execute });
  expect(restored.status(owner)[0]?.state).toBe('completed');
  expect(f.calls).toHaveLength(1);
  await restored.close();
});

it.each([undefined, { readAll: true as const, writableRoots: [] }])(
  'does not infer write authority from a matching lead cwd: %j',
  async (filesystem) => {
    const f = harness();
    const input = request('return await agent("Edit", {access:"workspace-write"});');
    delete input.authorityRef;
    const context = { ...authority.context };
    delete context.filesystem;
    f.engine.start(
      { ...input, contractVersion: 2 },
      {
        ...authority,
        context: { ...context, ...(filesystem ? { filesystem } : {}) },
        capacity: {
          source: 'host-profile',
          totalSlots: 3,
          reservedSlots: 0,
          evidence: 'Ultra profile limit',
        },
      },
    );
    await until(() => f.engine.status(owner)[0]?.state === 'failed');
    expect(f.calls).toHaveLength(0);
    await f.engine.close();
  },
);
