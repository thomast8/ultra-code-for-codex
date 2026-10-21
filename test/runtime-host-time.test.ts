import { expect, it, vi } from 'vitest';
import { ScriptMachine } from '../src/runtime/sandbox.js';
import { until } from './runtime-fixture.js';

it.each(['sync', 'call', 'sync-error', 'call-error'] as const)(
  'excludes slow %s host work from the guest deadline',
  async (kind) => {
    const done = vi.fn();
    const failed = vi.fn();
    const slow = () => {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
      if (kind.endsWith('-error')) throw new Error('Host failed');
    };
    const machine = await ScriptMachine.create({
      sync: () => {
        slow();
        return null;
      },
      call: () => {
        slow();
        return Promise.resolve(null);
      },
      done,
      failed,
    });
    try {
      machine.start(
        `let pending; try { ${kind.startsWith('sync') ? "log('journal');" : 'pending=agent({});'} } catch {}
      let sum=0; for(let i=0;i<10000;i++) sum+=i;
      ${kind.startsWith('call') && !kind.endsWith('-error') ? 'await pending;' : ''} return sum;`,
        null,
      );
      await until(() => done.mock.calls.length + failed.mock.calls.length > 0);
      expect(failed).not.toHaveBeenCalled();
      expect(done).toHaveBeenCalledWith(49_995_000);
    } finally {
      machine.close();
    }
  },
);

it('budgets the guest by CPU time, so wall-clock delay from host load cannot interrupt it', async () => {
  const done = vi.fn();
  const failed = vi.fn();
  const machine = await ScriptMachine.create({
    sync: () => null,
    call: () => Promise.resolve(null),
    done,
    failed,
  });
  const now = performance.now.bind(performance);
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now() + 60_000);
  try {
    machine.start('let sum=0; for(let i=0;i<10000;i++) sum+=i; return sum;', null);
    await until(() => done.mock.calls.length + failed.mock.calls.length > 0);
    expect(failed).not.toHaveBeenCalled();
    expect(done).toHaveBeenCalledWith(49_995_000);
  } finally {
    clock.mockRestore();
    machine.close();
  }
});
