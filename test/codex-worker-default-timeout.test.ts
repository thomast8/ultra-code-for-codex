import { expect, it, vi } from 'vitest';
import { turn, workerHarness, workerSpec } from './codex-worker-fixture.js';

it('keeps active unspecified workers alive but interrupts after five idle minutes', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const h = workerHarness();
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  h.backend.execute = async () => {
    started();
  };
  h.backend.overrides['turn/interrupt'] = async () => {
    await h.backend.finish(undefined, 'interrupted');
    return {};
  };
  try {
    const result = h.execute(workerSpec(), h.options);
    await ready;
    await vi.advanceTimersByTimeAsync(299_999);
    expect(h.backend.calls.some((call) => call.method === 'turn/interrupt')).toBe(false);
    await h.backend.emit('turn/started', { turn: turn() });
    await vi.advanceTimersByTimeAsync(299_999);
    expect(h.backend.calls.some((call) => call.method === 'turn/interrupt')).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toMatchObject({
      execution: 'failed',
      error: 'Worker idle timeout exceeded',
    });
    expect(h.backend.calls.filter((call) => call.method === 'turn/interrupt')).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

it('keeps the one-hour hard limit while activity resets the idle watchdog', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const h = workerHarness();
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  h.backend.execute = async () => {
    started();
  };
  h.backend.overrides['turn/interrupt'] = async () => {
    await h.backend.finish(undefined, 'interrupted');
    return {};
  };
  try {
    const result = h.execute(workerSpec(), h.options);
    await ready;
    for (let index = 0; index < 14; index += 1) {
      await vi.advanceTimersByTimeAsync(240_000);
      await h.backend.emit('turn/started', { turn: turn() });
    }
    await vi.advanceTimersByTimeAsync(239_999);
    expect(h.backend.calls.some((call) => call.method === 'turn/interrupt')).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toMatchObject({
      execution: 'failed',
      error: 'Worker duration limit exceeded',
    });
    expect(h.backend.calls.filter((call) => call.method === 'turn/interrupt')).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
