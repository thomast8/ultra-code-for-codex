import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { authority, harness, output, owner, request, spec, until } from './runtime-fixture.js';

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
          dispatchPlan: 'Two disjoint source batches have no dependency; reserve only the lead.',
          reviewObjective: 'Compare the source evidence',
          assignments: [spec, { ...spec, title: 'Second source batch' }],
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
      call.finish(
        output(index, { evidence: [{ id: `source-${index}`, description: 'Inspected source' }] }),
      );
    }
    await until(() => engine.status(owner)[0]!.handoffs.length === 1);
    const handoff = engine.status(owner)[0]!.handoffs[0]!;
    expect(handoff.spec.evidence.map((item) => item.id)).toEqual(['source-0', 'source-1']);
    expect(engine.events(owner, 0, [run.id]).events).toContainEqual(
      expect.objectContaining({
        type: 'log',
        data: 'Two disjoint source batches have no dependency; reserve only the lead.',
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
