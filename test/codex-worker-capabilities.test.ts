import { expect, it } from 'vitest';
import { createCapabilitiesReader } from '../src/codex/worker-capabilities.js';
import { workerHarness } from './codex-worker-fixture.js';

it('returns only current safe model/account/profile metadata without selecting a model or starting a turn', async () => {
  const h = workerHarness();
  h.backend.overrides['account/read'] = {
    account: { type: 'chatgpt', email: 'private@example.invalid', planType: 'private' },
  };
  const result = await createCapabilitiesReader(h.launch)('/private/tmp', '/private/tmp');
  expect(result).toEqual({
    status: 'verified-metadata',
    profileVerified: true,
    accountType: 'chatgpt',
    ordinaryUsageAllowed: true,
    models: [{ model: 'gpt-6.1-sol', reasoningEfforts: ['low'] }],
    capacity: { profileWorkerLimit: 3, hostWideAvailableSlots: null },
    blockers: [],
  });
  expect(JSON.stringify(result)).not.toContain('private');
  expect(
    h.backend.calls.some((call) => call.method === 'thread/start' || call.method === 'turn/start'),
  ).toBe(false);
  expect(h.launch.mock.calls[0]?.[0].some((arg: string) => arg.startsWith('model='))).toBe(false);
  expect(h.launch.mock.calls[1]?.[0]).toContain('mcp_servers.inherited.enabled=false');
  expect(h.discovery.close).toHaveBeenCalledOnce();
  expect(h.backend.close).toHaveBeenCalledOnce();
});

it.each([
  ['account/read', { account: null }, 'ChatGPT'],
  ['configRequirements/read', { requirements: {} }, 'Managed'],
  ['account/rateLimits/read', { ordinaryUsageAllowed: false }, 'included usage'],
  ['account/rateLimits/read', { ordinaryUsageAllowed: null }, 'included usage'],
  ['model/list', { data: [{ model: '' }], nextCursor: null }, 'invalid identifier'],
  ['model/list', { data: [{ model: 'good' }], nextCursor: null }, 'catalog is unavailable'],
  [
    'model/list',
    {
      data: [{ model: 'good', supportedReasoningEfforts: [{ reasoningEffort: '' }] }],
      nextCursor: null,
    },
    'invalid identifier',
  ],
])('reports unavailable capability metadata at %s %#', async (method, reply, reason) => {
  const h = workerHarness();
  h.backend.overrides[method as string] = reply;
  const result = await createCapabilitiesReader(h.launch)('/private/tmp', '/private/tmp');
  expect(result.status).toBe('blocked');
  expect(result.blockers[0]).toContain(reason as string);
  expect(h.backend.close).toHaveBeenCalledOnce();
});

it('sanitizes launch and invalid filesystem failures before reporting blocked metadata', async () => {
  const h = workerHarness();
  h.launch.mockRejectedValueOnce(new Error('private-launch'));
  expect(await createCapabilitiesReader(h.launch)('/private/tmp', '/private/tmp')).toMatchObject({
    status: 'blocked',
    profileVerified: false,
    blockers: ['Worker capability metadata could not be verified'],
  });
  const before = h.launch.mock.calls.length;
  expect(await createCapabilitiesReader(h.launch)('/private/tmp', 'relative')).toMatchObject({
    status: 'blocked',
  });
  expect(h.launch.mock.calls).toHaveLength(before);
});

it('preserves an allowlisted permission-inspection blocker without starting a turn', async () => {
  const h = workerHarness();
  h.backend.overrides['experimentalFeature/list'] = { data: [], nextCursor: null };
  const result = await createCapabilitiesReader(h.launch)('/private/tmp', '/private/tmp');
  expect(result.blockers[0]).toContain(
    'Restricted worker verification failed: required feature state is missing:',
  );
  expect(h.backend.calls.some((call) => call.method === 'turn/start')).toBe(false);
});
