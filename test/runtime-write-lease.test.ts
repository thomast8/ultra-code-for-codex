import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ResourceClaim } from '../src/contracts/workflow.js';
import { expect, it, vi } from 'vitest';
import { WorkflowEngine } from '../src/runtime/engine.js';
import { DatabaseSync } from 'node:sqlite';
import { authority, harness, output, owner, request, spec, until } from './runtime-fixture.js';

function writerRequest(resources: ResourceClaim[], cwd: string) {
  return request('const p=phase("Write"); return await agent({...args.spec,phase:p});', {
    args: {
      spec: {
        ...spec,
        capability: 'workspace-write',
        assignment: { ...spec.assignment, ownership: { cwd, paths: [] } },
        resources,
      },
    },
  });
}

function authorized(root: string) {
  return {
    ...authority,
    context: {
      ...authority.context,
      filesystem: { readAll: true as const, writableRoots: [root] },
    },
  };
}

it.each(['empty', 'read', 'unrelated', 'key-only'])(
  'blocks a writer with a %s lease before dispatch',
  async (kind) => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'ultra-lease-root-')));
    const other = realpathSync(mkdtempSync(join(tmpdir(), 'ultra-lease-other-')));
    const resources: ResourceClaim[] =
      kind === 'empty'
        ? []
        : [
            {
              key: 'root',
              mode: kind === 'read' ? 'read' : 'write',
              ...(kind === 'key-only' ? {} : { path: kind === 'unrelated' ? other : root }),
            },
          ];
    const { engine, calls } = harness();
    engine.start(writerRequest(resources, root), authority);
    await until(() => engine.status(owner)[0]?.state === 'failed');
    expect(engine.status(owner)[0]?.error).toContain('write lease');
    expect(calls).toHaveLength(0);
    await engine.close();
  },
);

it('serializes different-key writers holding the same canonical root', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'ultra-lease-root-')));
  const { engine, calls } = harness();
  const first = writerRequest([{ key: 'first', mode: 'write', path: root }], root);
  engine.start(first, authorized(root));
  engine.start(
    { ...writerRequest([{ key: 'second', mode: 'write', path: root }], root), requestId: 'second' },
    authorized(root),
  );
  await until(() => calls.length === 1);
  expect(engine.status(owner)[1]?.tasks[0]?.waitingReason).toContain('Resource');
  calls[0]!.finish(output());
  await until(() => calls.length === 2);
  calls[1]!.finish(output());
  await until(() => engine.status(owner).every((run) => run.state === 'completed'));
  await engine.close();
});

it('blocks a legacy queued writer without a lease during replay', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'ultra-lease-legacy-')));
  const { engine, calls, dataDir } = harness();
  const initial = writerRequest([{ key: 'root', mode: 'write', path: root }], root);
  engine.start(initial, authorized(root));
  await until(() => calls.length === 1);
  await engine.close();
  const db = new DatabaseSync(join(dataDir, 'workflow.sqlite'));
  const row = db.prepare('SELECT id,record FROM runs').get()!;
  const record = JSON.parse(String(row.record));
  const legacy = writerRequest([], root);
  record.request = legacy;
  record.requestBytes = JSON.stringify(legacy);
  record.snapshot.state = 'running';
  record.nextSettlement = 1;
  const call = record.calls[1];
  call.payload = { ...record.request.args.spec, phase: call.payload.phase };
  Object.assign(call, { claims: [], state: 'queued', result: null, settlement: null });
  Object.assign(call.task, { state: 'queued', result: null });
  db.prepare('UPDATE runs SET record=? WHERE id=?').run(JSON.stringify(record), row.id!);
  db.close();
  const execute = vi.fn(async () => output());
  const recovered = new WorkflowEngine({ dataDir, executeWorker: execute });
  await until(() => recovered.status(owner)[0]?.state === 'failed');
  expect(recovered.status(owner)[0]?.error).toContain('write lease');
  expect(execute).not.toHaveBeenCalled();
  await recovered.close();
});
