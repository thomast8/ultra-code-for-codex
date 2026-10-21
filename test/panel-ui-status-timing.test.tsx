// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { App } from '@modelcontextprotocol/ext-apps';
import { Dashboard } from '../src/ui/dashboard.js';
import {
  dashboardBridge,
  resetBridge,
  runFixture,
  taskFixture,
  threeRuns,
} from './panel-ui-dashboard-fixture.js';

beforeEach(() => {
  vi.useFakeTimers();
  resetBridge();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
async function open(runs: ReturnType<typeof runFixture>[]) {
  dashboardBridge.statusResult = { structuredContent: { runs, cursor: 1 } };
  render(
    createElement(Dashboard, {
      app: new dashboardBridge.MockApp() as unknown as Pick<App, 'callServerTool'>,
      nonce: 'status-timing',
    }),
  );
  await act(async () => {});
}

it('archives a resolved failed attempt after its successful continuation without a false follow-up', async () => {
  const resolved = { ...threeRuns()[0]!.handoffs[0]!, state: 'resolved' as const };
  const failed = runFixture({
    id: 'failed',
    title: 'Original attempt',
    state: 'completed',
    acceptanceOutcome: 'incomplete',
    finishedAt: 87_000,
    tasks: [taskFixture({ state: 'failed', finishedAt: 1 })],
    handoffs: [resolved],
  });
  const accepted = runFixture({
    id: 'accepted',
    title: 'Corrected attempt',
    parentRunId: 'failed',
    state: 'completed',
    acceptanceOutcome: 'satisfied',
    finishedAt: 433_000,
    tasks: [],
  });
  await open([failed, accepted]);
  expect(screen.queryByRole('region', { name: 'Original attempt' })).toBeNull();
  expect(screen.getByText('finished').className).toContain('tone-completed');
  fireEvent.click(screen.getByRole('button', { name: 'History · 1' }));
  const card = within(screen.getByRole('region', { name: 'Original attempt' }));
  expect(card.getByText('finished', { selector: '.workflow-badge' }).className).toContain(
    'tone-attention',
  );
  expect(card.getByText('Finished with issues')).toBeDefined();
  expect(card.queryByText('Lead follow-up')).toBeNull();
});

it.each(['incomplete', 'blocked', 'unverified'] as const)(
  'never colors finished %s work as success',
  async (acceptanceOutcome) => {
    await open([
      runFixture({ state: 'completed', acceptanceOutcome, tasks: [], finishedAt: 10_000 }),
    ]);
    expect(screen.getByText('finished', { selector: '.workflow-badge' }).className).toContain(
      'tone-attention',
    );
    expect(screen.queryByText('completed', { selector: '.workflow-badge' })).toBeNull();
    expect(screen.queryByText('Lead follow-up')).toBeNull();
  },
);

it('shows additive wall time and cumulative worker time on the collapsed run', async () => {
  await open([
    runFixture({
      state: 'completed',
      acceptanceOutcome: 'satisfied',
      finishedAt: 433_151,
      tasks: [taskFixture({ state: 'completed', startedAt: 4, finishedAt: 172_108 })],
      leadReviews: [{ handoffId: 'review', startedAt: 431_660, finishedAt: 433_147 }],
    }),
  ]);
  for (const [label, value] of [
    ['Workers only', '2m 52s'],
    ['Waiting or other', '4m 19s'],
    ['Lead review only', '1s'],
    ['Workers and lead review', '0s'],
    ['Cumulative worker time', '2m 52s'],
  ] as const) {
    expect(screen.getByText(label).nextElementSibling?.textContent).toBe(value);
  }
  expect(screen.getByText(/7m 13s elapsed/)).toBeDefined();
  expect(screen.getByText('Timing definitions')).toBeDefined();
});
