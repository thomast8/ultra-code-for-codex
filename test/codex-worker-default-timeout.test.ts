import { expect, it, vi } from 'vitest';
import { workerHarness, workerSpec } from './codex-worker-fixture.js';

it('allows unspecified workers beyond two minutes but interrupts at five minutes', async () => {
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
    await vi.advanceTimersByTimeAsync(120_001);
    expect(h.backend.calls.some((call) => call.method === 'turn/interrupt')).toBe(false);
    await vi.advanceTimersByTimeAsync(179_999);
    expect(await result).toMatchObject({
      execution: 'interrupted',
      error: 'Worker timeout exceeded',
    });
    expect(h.backend.calls.filter((call) => call.method === 'turn/interrupt')).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
