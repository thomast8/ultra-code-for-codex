import { expect, it } from 'vitest';
import { createWorkerExecutor } from '../src/codex/worker.js';
import { workerHarness, workerSpec, WorkerBackend } from './codex-worker-fixture.js';

it.each([
  'root',
  'launch',
  'discovery',
  'eligibility',
  'thread',
  'permissions',
  'environment',
  'record',
])('cancels %s preflight promptly without model dispatch', async (stage) => {
  const h = workerHarness();
  const never = new Promise<never>(() => {});
  if (stage === 'launch') h.launch.mockReset().mockReturnValue(never);
  if (stage === 'discovery') h.discovery.overrides['config/read'] = () => never;
  if (stage === 'eligibility') h.backend.overrides['account/read'] = () => never;
  if (stage === 'thread') h.backend.overrides['thread/start'] = () => never;
  if (stage === 'permissions') h.backend.overrides['app/installed'] = () => never;
  if (stage === 'environment') h.backend.overrides['environment/status'] = () => never;
  if (stage === 'record') h.options.onEvent = () => never;
  const execute = createWorkerExecutor({
    launch: h.launch,
    verifyRoot: () => (stage === 'root' ? never : Promise.resolve()),
  });
  const running = execute(workerSpec(), h.options);
  await new Promise((resolve) => setTimeout(resolve, 10));
  h.controller.abort();
  const result = await running;
  expect(result.execution).toBe('interrupted');
  expect(result.error).toContain('preflight');
  expect(h.backend.calls.some((call) => call.method === 'turn/start')).toBe(false);
  if (['eligibility', 'thread', 'permissions', 'environment', 'record'].includes(stage))
    expect(h.backend.close).toHaveBeenCalled();
});

it('closes a backend that arrives after cancellation of its launch', async () => {
  const h = workerHarness();
  const late = new WorkerBackend();
  let resolve: (value: WorkerBackend) => void = () => {};
  h.launch.mockReset().mockReturnValue(
    new Promise<WorkerBackend>((done) => {
      resolve = done;
    }),
  );
  const running = h.execute(workerSpec(), h.options);
  await new Promise((done) => setTimeout(done, 10));
  h.controller.abort();
  expect((await running).execution).toBe('interrupted');
  resolve(late);
  await new Promise((done) => setImmediate(done));
  expect(late.close).toHaveBeenCalledOnce();
});
