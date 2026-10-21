import { expect, it } from 'vitest';
import { Scheduler } from '../src/runtime/scheduler.js';
import { until } from './runtime-fixture.js';

it('counts uncertain workers against the three profile slots after a new run starts', async () => {
  const scheduler = new Scheduler();
  scheduler.quarantine('old-run:1', [], true);
  scheduler.setGrant('new-run', 3);
  const started: string[] = [];
  const finish: Array<() => void> = [];
  for (const id of ['new-run:1', 'new-run:2', 'new-run:3']) {
    scheduler.enqueue({
      id,
      runId: 'new-run',
      claims: [],
      ready: () => true,
      waiting: () => {},
      invalid: (error) => {
        throw error;
      },
      run: () =>
        new Promise<boolean>((resolve) => {
          started.push(id);
          finish.push(() => resolve(true));
        }),
    });
  }
  await until(() => started.length === 2);
  expect(started).toHaveLength(2);
  finish[0]!();
  await until(() => started.length === 3);
  finish[1]!();
  finish[2]!();
  await scheduler.close();
});
