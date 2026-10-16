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
