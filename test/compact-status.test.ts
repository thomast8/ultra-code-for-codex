import { expect, it } from 'vitest';
import { compactStatus } from '../src/runtime/compact-status.js';
import { runFixture, taskFixture } from './panel-ui-dashboard-fixture.js';

it('keeps model-facing status bounded without exposing saved worker or run results', () => {
  const secret = 'PRIVATE-SOURCE-CONTENT';
  const run = runFixture({
    result: `${secret}${'x'.repeat(200_000)}`,
    tasks: [
      taskFixture({
        startedAt: 123,
        lastActivityAt: 456,
        lastActivity: 'Command completed; exit=0',
        reportedEffort: 'high',
        result: {
          execution: 'completed',
          acceptance: 'unverified',
          value: secret,
          evidence: [],
          unresolved: [],
          usage: null,
          requestedModel: 'gpt-6-luna',
          reportedModel: 'gpt-6-luna',
        },
      }),
    ],
  });
  const compact = compactStatus([run]);
  const serialized = JSON.stringify(compact);
  expect(serialized.length).toBeLessThan(2_000);
  expect(serialized).not.toContain(secret);
  expect(compact[0]?.activeWorkers[0]).toMatchObject({
    requestedEffort: 'medium',
    verifiedEffort: 'high',
    startedAt: 123,
    lastActivityAt: 456,
    lastActivity: 'Command completed; exit=0',
  });
});
