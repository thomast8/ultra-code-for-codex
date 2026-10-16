import { expect, it } from 'vitest';
import { WorkflowEngine } from '../src/runtime/engine.js';
import { parseRecord } from '../src/runtime/persistence.js';
import { createRun } from '../src/runtime/records.js';
import { authority, harness, output, owner, request, single, until } from './runtime-fixture.js';
const usage = {
  inputTokens: 3,
  cachedInputTokens: 1,
  outputTokens: 2,
  reasoningOutputTokens: 1,
  totalTokens: 5,
};

it('keeps in-flight and missing worker usage partial, then marks known final usage complete', async () => {
  const { engine, calls } = harness();
  engine.start(request(single), authority);
  await until(() => calls.length === 1);
  await calls[0]!.options.onEvent({ type: 'usage', usage });
  expect(engine.status(owner)[0]?.accountingComplete).toBe(false);
  calls[0]!.finish(output(1, { usage }));
  await until(() => engine.status(owner)[0]?.state === 'completed');
  expect(engine.status(owner)[0]?.accountingComplete).toBe(true);
  engine.start(request(single, { requestId: 'missing' }), authority);
  await until(() => calls.length === 2);
  calls[1]!.finish(output());
  await until(() => engine.status(owner)[1]?.state === 'completed');
  expect(engine.status(owner)[1]?.accountingComplete).toBe(false);
  await engine.close();
});

it('keeps uncertain attempts partial despite a usage snapshot', async () => {
  const { engine, calls } = harness();
  engine.start(request(single), authority);
  await until(() => calls.length === 1);
  calls[0]!.finish(output(1, { usage, execution: 'uncertain' }));
  await until(() => engine.status(owner)[0]?.state === 'needs_reconciliation');
  expect(engine.status(owner)[0]?.accountingComplete).toBe(false);
  await engine.close();
});

it('sums cache writes once and leaves legacy cache-write usage unknown after restart', async () => {
  const { engine, calls, dataDir } = harness();
  engine.start(
    request(`const p=phase('Inspect'); return await parallel([
      () => agent({...args.spec,phase:p}), () => agent({...args.spec,phase:p})]);`),
    authority,
  );
  await until(() => calls.length === 2);
  const first = { ...usage, cacheWriteInputTokens: 2 };
  const second = { ...usage, cacheWriteInputTokens: 4 };
  await calls[0]!.options.onEvent({ type: 'usage', usage: first });
  await calls[0]!.options.onEvent({ type: 'usage', usage: first });
  await calls[1]!.options.onEvent({ type: 'usage', usage: second });
  expect(engine.status(owner)[0]?.usage).toMatchObject({
    totalTokens: 10,
    cacheWriteInputTokens: 6,
  });
  calls[0]!.finish(output(1, { usage: first }));
  calls[1]!.finish(output(2, { usage: second }));
  await until(() => engine.status(owner)[0]?.state === 'completed');
  engine.start(request(single, { requestId: 'legacy' }), authority);
  await until(() => calls.length === 3);
  calls[2]!.finish(output(3, { usage }));
  await until(() => engine.status(owner)[1]?.state === 'completed');
  expect(engine.status(owner)[1]?.usage?.cacheWriteInputTokens).toBeUndefined();
  await engine.close();
  const restored = new WorkflowEngine({ dataDir, executeWorker: async () => output() });
  expect(restored.status(owner)[0]?.usage?.cacheWriteInputTokens).toBe(6);
  expect(restored.status(owner)[1]?.usage?.cacheWriteInputTokens).toBeUndefined();
  await restored.close();
});

it('restores a legacy version-1 snapshot budget from its immutable request', () => {
  const record = createRun(request(single, { budget: { maxObservedTokens: 5 } }), authority);
  delete record.snapshot.budget;
  expect(parseRecord(JSON.stringify(record)).snapshot.budget).toEqual({ maxObservedTokens: 5 });
});

it('does not reuse a stale cache-write figure when later usage omits it', async () => {
  const { engine, calls } = harness();
  engine.start(request(single), authority);
  await until(() => calls.length === 1);
  await calls[0]!.options.onEvent({
    type: 'usage',
    usage: { ...usage, cacheWriteInputTokens: 2 },
  });
  calls[0]!.finish(output(1, { usage: { ...usage, inputTokens: 6, totalTokens: 8 } }));
  await until(() => engine.status(owner)[0]?.state === 'completed');
  expect(engine.status(owner)[0]?.usage?.totalTokens).toBe(8);
  expect(engine.status(owner)[0]?.usage?.cacheWriteInputTokens).toBeUndefined();
  await engine.close();
});
