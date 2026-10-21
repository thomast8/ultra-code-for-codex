import { expect, it } from 'vitest';
import { WorkflowEngine } from '../src/runtime/engine.js';
import { authority, harness, output, owner, request, until } from './runtime-fixture.js';

const oneSlot = { ...authority, capacity: { ...authority.capacity, totalSlots: 2 } };
const other = { ...authority, context: { ...authority.context, sessionId: 'other-chat' } };
const otherOwner = { ...owner, sessionId: 'other-chat' };
const review = `lead({phase:p,objective:'Verify sources',resources:[],evidence:[]})`;
const wave = `const p=phase('Compare'); return await parallel([1,2].map(n=>()=>agent({...args.spec,phase:p,title:'batch-'+n})));`;

it.each([false, true])(
  'does not throttle another chat while a %s-worker run waits for review',
  async (withWorker) => {
    const { engine, calls } = harness();
    try {
      const old = engine.start(
        request(
          `const p=phase('Read'); ${withWorker ? 'await agent({...args.spec,phase:p});' : ''} return await ${review};`,
        ),
        oneSlot,
      );
      if (withWorker) {
        await until(() => calls.length === 1);
        calls[0]!.finish(output());
      }
      await until(() => engine.status(owner)[0]?.handoffs.length === 1);
      engine.start(request(wave, { requestId: 'parallel' }), other);
      await until(() => calls.length === (withWorker ? 3 : 2));
      expect(engine.status(otherOwner)[0]!.tasks.map((task) => task.state)).toEqual([
        'running',
        'running',
      ]);
      expect(engine.status(owner, [old.id])[0]!.handoffs[0]!.state).toBe('pending');
      for (const call of calls.slice(withWorker ? 1 : 0)) call.finish(output());
      await until(() => engine.status(otherOwner)[0]?.state === 'completed');
    } finally {
      await engine.close();
    }
  },
);

it.each(['running', 'paused'] as const)(
  'releases a recovered %s handoff-only grant without repeating its settled worker',
  async (state) => {
    const { engine, calls, dataDir, execute } = harness();
    engine.start(
      request(
        `const p=phase('Read'); await agent({...args.spec,phase:p}); return await ${review};`,
      ),
      oneSlot,
    );
    await until(() => calls.length === 1);
    calls[0]!.finish(output());
    await until(() => engine.status(owner)[0]?.handoffs.length === 1);
    if (state === 'paused') engine.control(owner, engine.status(owner)[0]!.id, 'pause');
    await engine.close();
    const recovered = new WorkflowEngine({ dataDir, executeWorker: execute });
    try {
      if (state === 'running')
        await until(() =>
          recovered.events(owner, 0).events.some((event) => event.type === 'run.replay_ready'),
        );
      recovered.start(request(wave, { requestId: 'parallel' }), other);
      await until(() => calls.length === 3);
      expect(recovered.status(otherOwner)[0]!.tasks.map((task) => task.state)).toEqual([
        'running',
        'running',
      ]);
      for (const call of calls.slice(1)) call.finish(output());
      await until(() => recovered.status(otherOwner)[0]?.state === 'completed');
      expect(execute).toHaveBeenCalledTimes(3);
      expect(recovered.status(owner)[0]!.handoffs[0]!.state).toBe('pending');
    } finally {
      await recovered.close();
    }
  },
);

it('enforces a legacy run limit without throttling other chats after review', async () => {
  const { engine, calls } = harness();
  try {
    engine.start(
      request(
        `const p=phase('Read'); await ${review}; return await parallel([1,2,3].map(n=>()=>agent({...args.spec,phase:p,title:'after-review-'+n})));`,
      ),
      oneSlot,
    );
    await until(() => engine.status(owner)[0]?.handoffs.length === 1);
    engine.start(request(wave, { requestId: 'parallel' }), other);
    await until(() => calls.length === 2);
    const id = engine.status(owner)[0]!.handoffs[0]!.id;
    engine.handoff(owner, id, 'claim', authority.context);
    engine.handoff(owner, id, 'resolve', authority.context, {
      acceptance: 'satisfied',
      value: 'Checked',
      evidence: [{ id: 'check', description: 'Observed' }],
    });
    await until(() => calls.length === 3);
    expect(engine.status(owner)[0]!.tasks.map((task) => task.state)).toEqual([
      'running',
      'queued',
      'queued',
    ]);
    calls[0]!.finish(output());
    calls[1]!.finish(output());
    await until(() => engine.status(otherOwner)[0]?.state === 'completed');
    expect(calls).toHaveLength(3);
    calls[2]!.finish(output());
    await until(() => calls.length === 4);
    expect(engine.status(owner)[0]!.tasks.map((task) => task.state)).toEqual([
      'completed',
      'running',
      'waiting',
    ]);
    calls[3]!.finish(output());
    await until(() => calls.length === 5);
    calls[4]!.finish(output());
    await until(() => engine.status(owner)[0]?.state === 'completed');
  } finally {
    await engine.close();
  }
});
