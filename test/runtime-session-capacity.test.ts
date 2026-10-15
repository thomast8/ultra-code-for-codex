import { expect, it } from 'vitest';
import { authority, harness, output, owner, request, until } from './runtime-fixture.js';

it.each([
  ['failed', "throw new Error('Script failed');"],
  ['completed', 'return 7;'],
])('releases the grant after the last worker finishes in a %s run', async (state, ending) => {
  const { engine, calls } = harness();
  try {
    engine.start(
      request(`const p=phase('Discover');
        agent({...args.spec,phase:p,title:'slow'});
        await agent({...args.spec,phase:p,title:'fast'});
        ${ending}`),
      authority,
    );
    await until(() => calls.length === 2);
    calls.find((call) => call.spec.title === 'fast')!.finish(output());
    await until(() => engine.status(owner)[0]?.state === state);
    expect(engine.status(owner)[0]?.tasks[0]?.state).toBe('running');
    calls.find((call) => call.spec.title === 'slow')!.finish(output());
    await until(
      () => engine.status(owner)[0]?.tasks.every((task) => task.state === 'completed') === true,
    );
    engine.start(
      request(
        `const p=phase('Discover');
          return await pipeline([1,2,3],n=>agent({...args.spec,phase:p,title:'next-'+n}));`,
        { requestId: 'next' },
      ),
      { ...authority, capacity: { ...authority.capacity, totalSlots: 4 } },
    );
    await until(() => calls.length === 5);
    expect(engine.status(owner)[1]?.tasks.map((task) => task.state)).toEqual([
      'running',
      'running',
      'running',
    ]);
    for (const call of calls.slice(2)) call.finish(output());
    await until(() => engine.status(owner)[1]?.state === 'completed');
  } finally {
    await engine.close();
  }
});
