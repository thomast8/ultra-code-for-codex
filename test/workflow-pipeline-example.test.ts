import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { authority, harness, output, owner, request, until } from './runtime-fixture.js';
import {
  exampleArgs,
  exampleHarness,
  pendingHandoff,
  resolveExample,
} from './workflow-examples-fixture.js';

const script = readFileSync(new URL('../workflows/investigate-verify.js', import.meta.url), 'utf8');
function start(h: ReturnType<typeof harness>) {
  h.engine.start(
    request(script, {
      maxAgentCalls: 4,
      args: {
        ...(exampleArgs('research', '/tmp') as object),
        items: [
          { id: 'a', question: 'First fact?', sourceIds: ['source-a'] },
          { id: 'b', question: 'Second fact?', sourceIds: ['source-b'] },
        ],
      },
    }),
    authority,
  );
}
function accepted() {
  return output(
    { finding: 'First fact', sourceIds: ['source-a'] },
    {
      acceptance: 'satisfied',
      evidence: [{ id: 'proof', description: 'Fixture source evidence' }],
    },
  );
}

it('advances a fast item to verification while an unrelated investigation is still running', async () => {
  const h = harness();
  try {
    start(h);
    await until(() => h.calls.length === 2);
    h.calls[0]!.finish(accepted());
    await until(() => h.calls.length === 3);
    expect(h.calls.map((c) => c.spec.title)).toEqual([
      'Investigate: a',
      'Investigate: b',
      'Verify: a',
    ]);
    expect(h.calls[2]!.spec.assignment.inputs).toEqual({
      question: 'First fact?',
      finding: { finding: 'First fact', sourceIds: ['source-a'] },
      sources: [{ id: 'source-a', excerpt: 'First fact' }],
    });
    h.calls[2]!.finish(output({ supported: true, issues: [] }, { acceptance: 'satisfied' }));
    h.calls[1]!.finish(accepted());
    await until(() => h.calls.length === 4);
    expect(h.calls[3]!.spec.title).toBe('Verify: b');
    h.calls[3]!.finish(
      output(
        { supported: false, issues: ['Contradiction'] },
        {
          acceptance: 'incomplete',
          unresolved: ['Contradiction'],
        },
      ),
    );
    await pendingHandoff(h.engine);
    expect(h.engine.status(owner)[0]!.tasks[3]!.result?.unresolved).toEqual(['Contradiction']);
    await resolveExample(h.engine, 'incomplete');
  } finally {
    await h.engine.close();
  }
});

it.each(['blocked', 'incomplete', 'failed'] as const)(
  'skips a dependent verifier after %s while preserving other work',
  async (state) => {
    const h = harness();
    try {
      start(h);
      await until(() => h.calls.length === 2);
      h.calls[0]!.finish(
        output(null, {
          execution: state === 'failed' ? 'failed' : 'completed',
          acceptance: state === 'failed' ? 'incomplete' : state,
          unresolved: ['Missing source'],
          evidence: [{ id: 'gap', description: 'Missing source' }],
        }),
      );
      h.calls[1]!.finish(accepted());
      await until(() => h.calls.length === 3);
      expect(h.calls[2]!.spec.title).toBe('Verify: b');
      h.calls[2]!.finish(output({ supported: true, issues: [] }, { acceptance: 'satisfied' }));
      const run = await pendingHandoff(h.engine);
      expect(run.handoffs[0]!.spec.evidence).toContainEqual({
        id: 'gap',
        description: 'Missing source',
      });
      await resolveExample(h.engine, 'incomplete');
    } finally {
      await h.engine.close();
    }
  },
);

it('validates both stage output schemas and honors an explicit effort override', async () => {
  const h = exampleHarness('investigate-verify');
  try {
    h.start({
      ...(exampleArgs('investigate-verify', h.root) as object),
      routing: { effort: 'low' },
    });
    await pendingHandoff(h.engine);
    expect(h.calls).toHaveLength(4);
    for (const spec of h.calls)
      expect(spec).toMatchObject({ model: authority.context.model, effort: 'low' });
    await resolveExample(h.engine);
  } finally {
    await h.engine.close();
  }
});
