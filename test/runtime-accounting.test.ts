import { expect, it } from 'vitest';
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
