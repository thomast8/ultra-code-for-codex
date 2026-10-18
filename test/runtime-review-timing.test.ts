import { expect, it, vi } from 'vitest';
import { WorkflowEngine } from '../src/runtime/engine.js';
import { authority, harness, output, owner, request, until } from './runtime-fixture.js';

it('projects durable claimed review time, including older journals, without changing stored acceptance', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
  const { engine, dataDir } = harness();
  try {
    const run = engine.start(
      request(
        `return await lead({phase:phase('Review'), objective:'Verify', resources:[], evidence:[]});`,
      ),
      authority,
    );
    await until(() => engine.status(owner)[0]?.handoffs.length === 1);
    expect(engine.status(owner)[0]?.leadReviews).toEqual([]);
    const id = engine.status(owner)[0]!.handoffs[0]!.id;
    clock.mockReturnValue(4000);
    engine.handoff(owner, id, 'claim', authority.context);
    expect(engine.status(owner)[0]?.leadReviews).toEqual([
      { handoffId: id, startedAt: 4000, finishedAt: null },
    ]);
    clock.mockReturnValue(7000);
    engine.handoff(owner, id, 'resolve', authority.context, {
      acceptance: 'satisfied',
      value: 'verified',
      evidence: [{ id: 'check', description: 'Observed' }],
    });
    await until(() => engine.status(owner)[0]?.state === 'completed');
    await engine.close();
    const recovered = new WorkflowEngine({ dataDir, executeWorker: async () => output() });
    try {
      expect(recovered.status(owner, [run.id])[0]).toMatchObject({
        acceptanceOutcome: 'satisfied',
        leadReviews: [{ handoffId: id, startedAt: 4000, finishedAt: 7000 }],
      });
      expect(recovered.status({ ...owner, sessionId: 'other' })).toEqual([]);
      expect(() => recovered.status({ ...owner, sessionId: 'other' }, [run.id])).toThrow(
        'selected lead',
      );
    } finally {
      await recovered.close();
    }
  } finally {
    clock.mockRestore();
    await engine.close();
  }
});
