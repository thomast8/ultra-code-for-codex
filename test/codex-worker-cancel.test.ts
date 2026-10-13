import { expect, it } from 'vitest';
import { workerHarness, workerSpec, outputText, turn } from './codex-worker-fixture.js';

it('cancels before launch without starting a backend', async () => {
  const h = workerHarness();
  h.controller.abort();
  expect(await h.execute(workerSpec(), h.options)).toMatchObject({
    execution: 'failed',
    acceptance: 'blocked',
  });
  expect(h.launch).not.toHaveBeenCalled();
});

it('checks cancellation after thread recording and before turn dispatch', async () => {
  const h = workerHarness();
  h.options.onEvent = () => {
    h.controller.abort();
  };
  expect(await h.execute(workerSpec(), h.options)).toMatchObject({
    execution: 'failed',
    acceptance: 'blocked',
  });
  expect(h.backend.calls.some((call) => call.method === 'turn/start')).toBe(false);
});

it('uses owned turn interrupt and reports confirmed interrupted completion', async () => {
  const h = workerHarness();
  h.backend.execute = async () => {
    h.controller.abort();
  };
  h.backend.overrides['turn/interrupt'] = async () => {
    await h.backend.finish(outputText(), 'interrupted');
    return {};
  };
  expect(await h.execute(workerSpec(), h.options)).toMatchObject({
    execution: 'interrupted',
    acceptance: 'unverified',
    error: 'Worker cancellation requested',
  });
  expect(h.backend.calls.some((call) => call.method === 'turn/interrupt')).toBe(true);
});

it('does not equate interrupt acknowledgement with confirmed termination', async () => {
  const h = workerHarness();
  h.backend.execute = async () => {
    h.controller.abort();
  };
  expect(await h.execute(workerSpec(), h.options)).toMatchObject({
    execution: 'uncertain',
    acceptance: 'unverified',
  });
  expect(h.backend.close).toHaveBeenCalledOnce();
});

it('reports uncertain termination when interrupt fails without exposing raw errors', async () => {
  const h = workerHarness();
  h.backend.execute = async () => {
    h.controller.abort();
  };
  h.backend.overrides['turn/interrupt'] = () => {
    throw new Error('secret-error');
  };
  const result = await h.execute(workerSpec(), h.options);
  expect(result.execution).toBe('uncertain');
  expect(JSON.stringify(result)).not.toContain('secret-error');
});

it('interrupts a timeout and keeps confirmed late completion separate from uncertainty', async () => {
  const h = workerHarness();
  h.backend.execute = async () => undefined;
  h.backend.overrides['turn/interrupt'] = async () => {
    await h.backend.finish();
    return {};
  };
  expect(await h.execute(workerSpec({ timeoutMs: 5 }), h.options)).toMatchObject({
    execution: 'failed',
    acceptance: 'unverified',
    error: 'Worker timeout exceeded',
  });
});

it('records dispatch ambiguity without guessing an interrupt target', async () => {
  const h = workerHarness();
  h.backend.overrides['turn/start'] = () => {
    throw new Error('private-request-error');
  };
  expect(await h.execute(workerSpec(), h.options)).toMatchObject({
    execution: 'uncertain',
    error: expect.stringContaining('dispatch failed'),
  });
  expect(h.backend.calls.some((call) => call.method === 'turn/interrupt')).toBe(false);
});

it('handles a transport failure after dispatch without claiming completion', async () => {
  const h = workerHarness();
  h.backend.execute = async () => {
    await h.backend.fail?.(new Error('private-transport-error'));
  };
  expect(await h.execute(workerSpec(), h.options)).toMatchObject({
    execution: 'uncertain',
    error: expect.stringContaining('transport failed'),
  });
});

it('ignores unrelated thread and turn notifications', async () => {
  const h = workerHarness();
  h.backend.execute = async () => {
    await h.backend.emit('model/rerouted', {
      threadId: 'different',
      turnId: 'owned-turn',
      toModel: 'wrong',
    });
    await h.backend.emit('model/rerouted', { turnId: 'different', toModel: 'wrong' });
    await h.backend.finish();
  };
  expect(await h.execute(workerSpec(), h.options)).toMatchObject({
    acceptance: 'satisfied',
    reportedModel: 'gpt-6.1-sol',
  });
});

it('records turn identity from notifications when the response is lost', async () => {
  const h = workerHarness();
  h.backend.overrides['turn/start'] = async () => {
    await h.backend.emit('turn/started', { turn: turn() });
    throw new Error('lost');
  };
  h.backend.overrides['turn/interrupt'] = async () => {
    await h.backend.finish(outputText(), 'interrupted');
    return {};
  };
  expect(await h.execute(workerSpec(), h.options)).toMatchObject({ execution: 'interrupted' });
  expect(h.events.filter((event) => event.type === 'turn')).toHaveLength(1);
});
