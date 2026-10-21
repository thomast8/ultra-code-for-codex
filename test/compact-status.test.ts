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

it('tells the lead how to finish a run with a pending handoff', () => {
  const pending = {
    id: 'run:5',
    spec: {
      phase: { id: 'phase-1', label: 'Lead review' },
      objective: 'Review',
      resources: [],
      evidence: [],
    },
    state: 'pending' as const,
    claimedTurnId: null,
    result: null,
  };
  const [withHandoff] = compactStatus([runFixture({ handoffs: [pending] })]);
  expect(withHandoff!.pendingHandoffs).toEqual(['run:5']);
  expect(withHandoff!.nextAction).toContain('ultra_handoff {id, action: "claim"}');
  expect(withHandoff!.nextAction).toContain('not a worker task');
  const [resolved] = compactStatus([runFixture({ handoffs: [{ ...pending, state: 'resolved' }] })]);
  expect(resolved!.nextAction).toBeUndefined();
});
