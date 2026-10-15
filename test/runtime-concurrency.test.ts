import { expect, it } from 'vitest';
import { authority, harness, output, owner, request, spec, until } from './runtime-fixture.js';

it('streams each item forward while keeping the final array in input order', async () => {
  const { engine, calls } = harness();
  engine.start(
    request(`
    const p=phase('Discover');
    const discovery=await agent({...args.spec,phase:p,title:'discover'});
    return await pipeline(discovery.value, async item => {
      const first=await agent({...args.spec,phase:p,title:'first-'+item});
      const second=await agent({...args.spec,phase:p,title:'second-'+item});
      return [first.value,second.value];
    });`),
    authority,
  );
  await until(() => calls.length === 1);
  calls[0]!.finish(output(['a', 'b']));
  await until(() => calls.length === 3);
  calls[1]!.finish(output('a1'));
  await until(() => calls.length === 4);
  expect(calls[3]!.spec.title).toBe('second-a');
  calls[3]!.finish(output('a2'));
  calls[2]!.finish(output('b1'));
  await until(() => calls.length === 5);
  calls[4]!.finish(output('b2'));
  await until(() => engine.status(owner)[0]?.state === 'completed');
  expect(engine.status(owner)[0]?.result).toEqual([
    ['a1', 'a2'],
    ['b1', 'b2'],
  ]);
  await engine.close();
});

it('fairly shares the smallest active grant across three runs and isolates cancellation', async () => {
  const { engine, calls } = harness();
  const script = `const p=phase('Discover'); return await pipeline([1,2,3],n=>agent({...args.spec,phase:p,title:args.name+n}));`;
  const runs = ['a', 'b', 'c'].map((name) =>
    engine.start(
      request(script, {
        requestId: name,
        args: { spec: spec, name },
      }),
      { ...authority, capacity: { ...authority.capacity, totalSlots: 2 } },
    ),
  );
  await until(() => calls.length === 1);
  expect(calls[0]!.spec.title).toBe('a1');
  engine.control(owner, runs[0]!.id, 'pause');
  calls[0]!.finish(output());
  await until(() => calls.length === 2);
  expect(calls[1]!.spec.title).toBe('b1');
  engine.control(owner, runs[1]!.id, 'cancel');
  await until(() => calls.length === 3);
  expect(calls[2]!.spec.title).toBe('c1');
  expect(calls[2]!.options.signal.aborted).toBe(false);
  engine.control(owner, runs[0]!.id, 'resume');
  calls[2]!.finish(output());
  await until(() => calls.length === 4);
  expect(calls[3]!.spec.title).toBe('a2');
  for (const run of runs) engine.control(owner, run.id, 'cancel');
  await engine.close();
});

it('queues continuation after pause and stops new dispatch at observed token budget', async () => {
  const { engine, calls } = harness();
  const run = engine.start(
    request(
      `const p=phase('Discover');
    await agent({...args.spec,phase:p}); return await agent({...args.spec,phase:p});`,
      {
        budget: { maxObservedTokens: 5 },
      },
    ),
    authority,
  );
  await until(() => calls.length === 1);
  engine.control(owner, run.id, 'pause');
  calls[0]!.finish(
    output(1, {
      usage: {
        inputTokens: 6,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
        totalTokens: 6,
      },
    }),
  );
  await until(() => engine.status(owner)[0]?.tasks.length === 2);
  expect(calls).toHaveLength(1);
  engine.control(owner, run.id, 'resume');
  await until(() => engine.status(owner)[0]?.state === 'failed');
  expect(calls).toHaveLength(1);
  expect(engine.status(owner)[0]?.error).toContain('budget');
  await engine.close();
});

it('warns once at the observed threshold, lets the worker finish, and persists the warning', async () => {
  const { engine, calls, dataDir } = harness();
  const run = engine.start(
    request(
      `const p=phase('Discover');
      await agent({...args.spec,phase:p}); return await agent({...args.spec,phase:p});`,
      {
        budget: { maxObservedTokens: 5 },
      },
    ),
    authority,
  );
  await until(() => calls.length === 1);
  const cursor = engine.currentCursor(owner);
  const usage = (totalTokens: number) => ({
    inputTokens: totalTokens,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens,
  });
  await calls[0]!.options.onEvent({ type: 'usage', usage: usage(3) });
  await calls[0]!.options.onEvent({ type: 'usage', usage: usage(6) });
  await calls[0]!.options.onEvent({ type: 'usage', usage: usage(6) });
  expect(engine.status(owner)[0]).toMatchObject({
    budget: { maxObservedTokens: 5 },
    state: 'running',
    tasks: [{ state: 'running' }],
  });
  expect(
    engine.events(owner, cursor).events.filter((event) => event.type === 'budget.exceeded'),
  ).toHaveLength(1);
  expect(
    engine.events(owner, cursor).events.filter((event) => event.type === 'worker.usage'),
  ).toHaveLength(3);
  calls[0]!.finish(output(1, { usage: usage(9) }));
  await until(() => engine.status(owner)[0]?.state === 'failed');
  expect(calls).toHaveLength(1);
  expect(engine.status(owner)[0]?.tasks[0]?.state).toBe('completed');
  expect(engine.status(owner)[0]?.usage?.totalTokens).toBe(9);
  expect(
    engine.events(owner, cursor).events.filter((event) => event.type === 'budget.exceeded'),
  ).toHaveLength(1);
  await engine.close();
  const { WorkflowEngine } = await import('../src/runtime/engine.js');
  const restored = new WorkflowEngine({ dataDir, executeWorker: async () => output() });
  expect(restored.status(owner)[0]).toMatchObject({
    id: run.id,
    budget: { maxObservedTokens: 5 },
    usage: { totalTokens: 9 },
  });
  expect(
    restored.events(owner, cursor).events.filter((event) => event.type === 'budget.exceeded'),
  ).toHaveLength(1);
  await restored.close();
});

it('warns when the final result is the first report above the threshold', async () => {
  const { engine, calls } = harness();
  engine.start(
    request(`const p=phase('Inspect'); return await agent({...args.spec,phase:p});`, {
      budget: { maxObservedTokens: 5 },
    }),
    authority,
  );
  await until(() => calls.length === 1);
  calls[0]!.finish(
    output(1, {
      usage: {
        inputTokens: 9,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
        totalTokens: 9,
      },
    }),
  );
  await until(() => engine.status(owner)[0]?.state === 'completed');
  expect(
    engine.events(owner, 0).events.filter((event) => event.type === 'budget.exceeded'),
  ).toMatchObject([{ data: { maxObservedTokens: 5, observedTokens: 9 } }]);
  await engine.close();
});

it('keeps uncertain worker capacity reserved across restart', async () => {
  const { engine, calls, dataDir } = harness();
  const oneSlot = { ...authority, capacity: { ...authority.capacity, totalSlots: 2 } };
  engine.start(
    request(`const p=phase('Discover');return await agent({...args.spec,phase:p});`),
    oneSlot,
  );
  await until(() => calls.length === 1);
  calls[0]!.finish(output(null, { execution: 'uncertain' }));
  await until(() => engine.status(owner)[0]?.state === 'needs_reconciliation');
  const before = engine.start(
    request(`const p=phase('Discover');return await agent({...args.spec,phase:p});`, {
      requestId: 'before',
    }),
    authority,
  );
  await until(() => engine.status(owner)[1]?.tasks.length === 1);
  expect(calls).toHaveLength(1);
  engine.control(owner, before.id, 'cancel');
  await engine.close();
  const { WorkflowEngine } = await import('../src/runtime/engine.js');
  const recoveredCalls: string[] = [];
  const recovered = new WorkflowEngine({
    dataDir,
    executeWorker: async (spec) => {
      recoveredCalls.push(spec.title);
      return output();
    },
  });
  const after = recovered.start(
    request(`const p=phase('Discover');return await agent({...args.spec,phase:p});`, {
      requestId: 'after',
    }),
    authority,
  );
  await until(() => recovered.status(owner)[2]?.tasks.length === 1);
  expect(recoveredCalls).toHaveLength(0);
  recovered.control(owner, after.id, 'cancel');
  await recovered.close();
});
