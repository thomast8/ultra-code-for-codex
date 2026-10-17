import { afterEach, expect, it, vi } from 'vitest';
import { launchWorkerTransport } from '../src/codex/launch-policy.js';
import { CodexTransport } from '../src/codex/transport.js';
import { workerHarness } from './codex-worker-fixture.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it('binds the worker process to the verified lead profile instead of ambient CODEX_HOME', async () => {
  vi.stubEnv('CODEX_HOME', '/ambient-primary');
  const h = workerHarness();
  const launch = vi
    .spyOn(CodexTransport, 'launch')
    .mockResolvedValue(h.backend as unknown as CodexTransport);
  await launchWorkerTransport([], '/private/tmp', undefined, '/verified-secondary');
  expect(launch.mock.calls[0]?.[3]?.env?.CODEX_HOME).toBe('/verified-secondary');
  expect(process.env.CODEX_HOME).toBe('/ambient-primary');
  expect(() => launchWorkerTransport([], '/private/tmp')).toThrow('verified lead profile');
});

it('passes the same verified profile to discovery and restricted launch', async () => {
  const h = workerHarness();
  const { createCapabilitiesReader } = await import('../src/codex/worker-capabilities.js');
  expect(
    (await createCapabilitiesReader(h.launch)('/private/tmp', '/private/tmp')).profileVerified,
  ).toBe(true);
  expect(h.launch.mock.calls.map((call) => call[3])).toEqual(['/private/tmp', '/private/tmp']);
});
