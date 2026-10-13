import { expect, it } from 'vitest';
import { authority, harness, output, owner, request, single, until } from './runtime-fixture.js';

it('runs isolated QuickJS and returns verified evidence only when explicit', async () => {
  const { engine } = harness();
  const run = engine.start(
    request('return {date:typeof Date, random:typeof Math.random, value:args.spec.model};'),
    authority,
  );
  await until(() => engine.status(owner)[0]?.state === 'completed');
  expect(engine.result(owner, run.id)).toMatchObject({
    result: { date: 'undefined', random: 'undefined', value: 'small' },
    acceptanceOutcome: 'unverified',
  });
  await engine.close();
});
it('journals dispatch and cumulative usage before delivering worker results', async () => {
  const { engine, calls } = harness();
  const run = engine.start(request(single), authority);
  await until(() => calls.length === 1);
  const usage = {
    inputTokens: 5,
    cachedInputTokens: 1,
    outputTokens: 2,
    reasoningOutputTokens: 1,
    totalTokens: 7,
  };
  await calls[0]!.options.onEvent({ type: 'usage', usage });
  await calls[0]!.options.onEvent({ type: 'usage', usage });
  calls[0]!.finish(output(42, { usage }));
  await until(() => engine.status(owner)[0]?.state === 'completed');
  expect(engine.status(owner)[0]?.usage?.totalTokens).toBe(7);
  expect(engine.result(owner, run.id, `${run.id}:2`)).toMatchObject({ value: 42 });
  expect(engine.events(owner, 0).events.map((event) => event.type)).toContain('agent.result');
  await engine.close();
});
it('enforces ownership and exact request idempotency', async () => {
  const { engine } = harness();
  const run = engine.start(request(), authority);
  expect(engine.start(request(), authority).id).toBe(run.id);
  expect(() => engine.start(request('return 8;'), authority)).toThrow('different payload');
  expect(() => engine.result({ ...owner, sessionId: 'foreign' }, run.id)).toThrow('selected lead');
  expect(engine.status({ ...owner, sessionId: 'foreign' })).toEqual([]);
  expect(() =>
    engine.start(request('', { parentRunId: run.id, requestId: 'linked' }), authority),
  ).toThrow();
  await engine.close();
});
it('blocks write workers in plan mode and hard-stops max calls', async () => {
  const { engine, calls } = harness();
  engine.start(
    request(
      'const p=phase("Discover"); await agent({...args.spec, phase:p, capability:"workspace-write"});',
    ),
    {
      ...authority,
      context: { ...authority.context, collaborationMode: 'plan' },
    },
  );
  await until(() => engine.status(owner)[0]?.state === 'failed');
  expect(calls).toHaveLength(0);
  expect(engine.status(owner)[0]?.error).toContain('Plan mode');
  engine.start(
    request(
      'const p=phase("Discover"); await parallel([()=>agent({...args.spec,phase:p}),()=>agent({...args.spec,phase:p})]);',
      { requestId: 'limit', maxAgentCalls: 1 },
    ),
    authority,
  );
  await until(() => engine.status(owner)[1]?.state === 'failed');
  expect(engine.status(owner)[1]?.error).toContain('maxAgentCalls');
  await engine.close();
});
it('interrupts CPU loops, rejects oversized arguments and preserves immutable args', async () => {
  const { engine } = harness();
  engine.start(request('while(true){}'), authority);
  await until(() => engine.status(owner)[0]?.state === 'failed');
  expect(() =>
    engine.start(request('return 1', { args: 'x'.repeat(1_048_576) }), authority),
  ).toThrow('Payload');
  engine.start(
    request('args.spec.model="changed"; return args.spec.model;', { requestId: 'immutable' }),
    authority,
  );
  await until(() => engine.status(owner)[1]?.state === 'failed');
  await engine.close();
});
