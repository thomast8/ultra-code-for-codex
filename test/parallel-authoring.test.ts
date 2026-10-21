import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { authority, harness, output, owner, until } from './runtime-fixture.js';

it('derives a canonical root lease and serializes v2 writers sharing that root', async () => {
  const cwd = realpathSync(tmpdir());
  const host = {
    ...authority,
    context: {
      ...authority.context,
      cwd,
      filesystem: { readAll: true as const, writableRoots: [cwd] },
    },
    capacity: {
      source: 'host-profile' as const,
      totalSlots: 3 as const,
      reservedSlots: 0 as const,
      evidence: 'Ultra profile limit' as const,
    },
  };
  const h = harness();
  try {
    h.engine.start(
      {
        contractVersion: 2,
        requestId: 'writers',
        contextKey: 'context',
        title: 'Two edits',
        objective: 'Edit independent sections',
        acceptance: ['Lead reviews the changes'],
        script:
          'return await parallel([()=>agent("Edit A",{access:"workspace-write",cwd:args.cwd}),()=>agent("Edit B",{access:"workspace-write",cwd:args.cwd})]);',
        args: { cwd },
      },
      host,
    );
    await until(() => h.calls.length === 1);
    expect(h.engine.status(owner)[0]?.tasks.map((task) => task.state)).toEqual([
      'running',
      'waiting',
    ]);
    expect(h.calls[0]?.spec).toMatchObject({
      capability: 'workspace-write',
      assignment: { ownership: { cwd } },
      resources: [{ key: `workspace:${cwd}`, mode: 'write', path: cwd }],
    });
    h.calls[0]!.finish(output('A done'));
    await until(() => h.calls.length === 2);
    h.calls[1]!.finish(output('B done'));
    await until(() => h.engine.status(owner)[0]?.state === 'completed');
  } finally {
    await h.engine.close();
  }
});
