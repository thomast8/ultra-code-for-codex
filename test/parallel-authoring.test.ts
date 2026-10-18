import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { authority, harness, output, owner, request, until } from './runtime-fixture.js';

it('executes the documented ready-work wave concurrently and retains its planning evidence', async () => {
  const reference = readFileSync('plugin/skills/ultra-code/references/authoring.md', 'utf8');
  const script = reference
    .split('## Choose the assignment graph first')[1]!
    .match(/```js\n([\s\S]*?)```/)![1]!;
  const { engine, calls } = harness();
  try {
    const run = engine.start(
      request(script, {
        maxAgentCalls: 2,
        args: {
          cwd: '/tmp',
          capacityNote: 'Reserve the observed lead slot; two source checks are independent.',
          questions: [
            {
              title: 'First source',
              question: 'Check the first claim',
              sourcePath: '/tmp/first.txt',
            },
            {
              title: 'Second source',
              question: 'Check the second claim',
              sourcePath: '/tmp/second.txt',
            },
          ],
        },
      }),
      authority,
    );
    await until(() => calls.length === 2);
    expect(engine.status(owner)[0]!.tasks.map((task) => task.state)).toEqual([
      'running',
      'running',
    ]);
    for (const [index, call] of calls.entries()) {
      expect(call.spec).toMatchObject({
        model: authority.context.model,
        effort: authority.context.effort,
        capability: 'read-only',
      });
      call.finish(
        output(
          { report: `Source ${index} checked` },
          {
            acceptance: 'satisfied',
            evidence: [{ id: `source-${index}`, description: 'Inspected source' }],
          },
        ),
      );
    }
    await until(() => engine.status(owner)[0]!.handoffs.length === 1);
    const handoff = engine.status(owner)[0]!.handoffs[0]!;
    expect(handoff.spec.evidence.map((item) => item.id)).toEqual(['source-0', 'source-1']);
    expect(engine.events(owner, 0, [run.id]).events).toContainEqual(
      expect.objectContaining({
        type: 'log',
        data: JSON.stringify({
          assignments: ['First source', 'Second source'],
          dependencies: 'Independent source checks, then lead comparison',
          reservation: 'Reserve the observed lead slot; two source checks are independent.',
        }),
      }),
    );
    engine.handoff(owner, handoff.id, 'claim', authority.context);
    engine.handoff(owner, handoff.id, 'resolve', authority.context, {
      acceptance: 'satisfied',
      value: 'Both sources verified',
      evidence: handoff.spec.evidence,
    });
    await until(() => engine.status(owner)[0]!.state === 'completed');
    expect(engine.status(owner)[0]!.acceptanceOutcome).toBe('satisfied');
  } finally {
    await engine.close();
  }
});

it.each(['log', 'phase'])(
  'identifies invalid %s arguments before any worker launches',
  async (kind) => {
    const h = harness();
    try {
      h.engine.start(
        request(`${kind}({assignments:['Phone', 'Watch']}); return await agent(args.spec);`),
        authority,
      );
      await until(() => h.engine.status(owner)[0]?.state === 'failed');
      const run = h.engine.status(owner)[0]!;
      expect(run.error).toContain(`${kind}() expects a nonempty string`);
      expect(run.error).toContain('received object');
      expect(run.error).toContain(kind === 'log' ? 'JSON.stringify(plan)' : 'Use phase(');
      expect(run.acceptanceOutcome).toBe('incomplete');
      expect(h.calls).toHaveLength(0);
    } finally {
      await h.engine.close();
    }
  },
);
