import { expect, it, vi } from 'vitest';
import {
  workerHarness,
  workerSpec,
  workerThread,
  outputText,
  finalItem,
  turn,
} from './codex-worker-fixture.js';

it('runs a fresh ephemeral exact-model worker after recording its verified thread', async () => {
  const h = workerHarness();
  let recorded = false;
  h.options.onEvent = async (event) => {
    if (event.type === 'thread') {
      await new Promise((resolve) => setImmediate(resolve));
      recorded = true;
    }
    h.events.push(event);
  };
  const execute = h.backend.execute;
  h.backend.execute = async () => {
    expect(recorded).toBe(true);
    await execute();
  };
  const result = await h.execute(workerSpec(), h.options);
  expect(result).toMatchObject({
    execution: 'completed',
    acceptance: 'satisfied',
    value: { answer: 'COBALT-47' },
    requestedModel: 'gpt-6.1-sol',
    reportedModel: 'gpt-6.1-sol',
  });
  expect(h.launch).toHaveBeenCalledTimes(2);
  expect(h.launch.mock.calls.map((call) => call[1])).toEqual(['/private/tmp', '/private/tmp']);
  expect(h.discovery.close).toHaveBeenCalledOnce();
  expect(h.backend.close).toHaveBeenCalledOnce();
  expect(h.launch.mock.calls[1]?.[0]).toContain('mcp_servers.inherited.enabled=false');
  expect(h.launch.mock.calls[1]?.[0]).toContain('apps.app1.enabled=false');
  const thread = h.backend.calls.find((call) => call.method === 'thread/start')?.params;
  expect(thread).toMatchObject({
    allowProviderModelFallback: false,
    ephemeral: true,
    model: 'gpt-6.1-sol',
    dynamicTools: [],
    selectedCapabilityRoots: [],
  });
  expect(thread).not.toHaveProperty('environments');
  const started = h.backend.calls.find((call) => call.method === 'turn/start')?.params;
  expect(started).toMatchObject({
    model: 'gpt-6.1-sol',
    effort: 'low',
    approvalPolicy: 'never',
    sandboxPolicy: { type: 'readOnly', networkAccess: false },
    environments: [{ environmentId: 'local' }],
  });
  expect(h.events.map((event) => event.type)).toEqual(['thread', 'turn', 'activity']);
});

it.each([
  ['bad JSON', 'not valid JSON'],
  [outputText({ value: { wrong: 1 } }), 'does not satisfy its schema'],
  [outputText({ acceptance: 'satisfied', unresolved: ['Not verified'] }), 'unresolved work'],
  [outputText({ extra: 'unexpected' }), 'does not satisfy its schema'],
])('fails closed for invalid final output %#', async (text, error) => {
  const h = workerHarness();
  h.backend.execute = () => h.backend.finish(text);
  expect(await h.execute(workerSpec(), h.options)).toMatchObject({
    execution: 'failed',
    acceptance: 'unverified',
    error: expect.stringContaining(error),
  });
});

it.each(['incomplete', 'blocked'])(
  'preserves the explicit %s acceptance outcome',
  async (acceptance) => {
    const h = workerHarness();
    h.backend.execute = () =>
      h.backend.finish(outputText({ acceptance, unresolved: ['Fixture unavailable'] }));
    expect(await h.execute(workerSpec(), h.options)).toMatchObject({
      execution: 'completed',
      acceptance,
      unresolved: ['Fixture unavailable'],
    });
  },
);

it('requires a final answer and accepts output supplied only in the completed turn', async () => {
  const h = workerHarness();
  h.backend.execute = () => h.backend.emit('turn/completed', { turn: turn('completed') });
  expect(await h.execute(workerSpec(), h.options)).toMatchObject({
    execution: 'failed',
    error: expect.stringContaining('missing'),
  });
  const other = workerHarness();
  other.backend.execute = () =>
    other.backend.emit('turn/completed', { turn: turn('completed', [finalItem()]) });
  expect(await other.execute(workerSpec(), other.options)).toMatchObject({
    acceptance: 'satisfied',
  });
});

it.each(['failed', 'interrupted'] as const)(
  'keeps backend %s distinct from successful execution',
  async (status) => {
    const h = workerHarness();
    h.backend.execute = () => h.backend.finish(outputText(), status);
    expect(await h.execute(workerSpec(), h.options)).toMatchObject({
      execution: status,
      acceptance: 'unverified',
    });
  },
);

it('reports live model rerouting and interrupts only its own turn', async () => {
  const h = workerHarness();
  h.backend.execute = () =>
    h.backend.emit('model/rerouted', {
      turnId: 'owned-turn',
      fromModel: 'gpt-6.1-sol',
      toModel: 'different',
      reason: 'other',
    });
  h.backend.overrides['turn/interrupt'] = async () => {
    await h.backend.finish(outputText(), 'interrupted');
    return {};
  };
  const result = await h.execute(workerSpec(), h.options);
  expect(result).toMatchObject({
    execution: 'interrupted',
    acceptance: 'unverified',
    requestedModel: 'gpt-6.1-sol',
    reportedModel: 'different',
    error: 'Worker model was rerouted',
  });
  expect(h.backend.calls.filter((call) => call.method === 'turn/interrupt')).toEqual([
    { method: 'turn/interrupt', params: { threadId: 'worker-thread', turnId: 'owned-turn' } },
  ]);
});

it('records cumulative usage snapshots without double counting', async () => {
  const h = workerHarness();
  const usage = {
    inputTokens: 10,
    cachedInputTokens: 3,
    outputTokens: 5,
    reasoningOutputTokens: 2,
    totalTokens: 15,
  };
  h.backend.execute = async () => {
    for (const total of [usage, usage, { ...usage, totalTokens: 14 }])
      await h.backend.emit('thread/tokenUsage/updated', {
        turnId: 'owned-turn',
        tokenUsage: { total, last: usage },
      });
    await h.backend.finish();
  };
  expect(await h.execute(workerSpec(), h.options)).toMatchObject({ usage });
  expect(h.events.filter((event) => event.type === 'usage')).toHaveLength(2);
});

it('does not dispatch a turn if durable thread recording fails', async () => {
  const h = workerHarness();
  h.options.onEvent = vi.fn().mockRejectedValue(new Error('private-secret'));
  const result = await h.execute(workerSpec(), h.options);
  expect(result.execution).toBe('failed');
  expect(JSON.stringify(result)).not.toContain('private-secret');
  expect(h.backend.calls.some((call) => call.method === 'turn/start')).toBe(false);
});

it('rejects model or effort changes before dispatch', async () => {
  const h = workerHarness();
  h.backend.overrides['thread/start'] = workerThread({ model: 'other' });
  expect(await h.execute(workerSpec(), h.options)).toMatchObject({
    acceptance: 'blocked',
    requestedModel: 'gpt-6.1-sol',
    reportedModel: 'other',
  });
  expect(h.backend.calls.some((call) => call.method === 'turn/start')).toBe(false);
});
