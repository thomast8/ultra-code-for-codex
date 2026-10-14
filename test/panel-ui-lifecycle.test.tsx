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
  usage,
} from './panel-ui-dashboard-fixture.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(252_000);
  resetBridge();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
function open(runs = [runFixture()]) {
  dashboardBridge.statusResult = { structuredContent: { runs, cursor: 1 } };
  return render(
    createElement(Dashboard, {
      app: new dashboardBridge.MockApp() as unknown as Pick<App, 'callServerTool'>,
      nonce: 'lifecycle',
    }),
  );
}
async function tick() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
}
async function loaded(runs = [runFixture()]) {
  const view = open(runs);
  await act(async () => {});
  return view;
}
function finished(id: string, createdAt: number) {
  return runFixture({
    id,
    title: id,
    createdAt,
    state: 'completed',
    finishedAt: createdAt + 20_000,
    tasks: [],
    acceptanceOutcome: 'satisfied',
    accountingComplete: true,
    result: 'Ready to review',
  });
}

it('keeps agent squares, state counts and live usage visible while collapsed', async () => {
  const tasks = [
    taskFixture(),
    taskFixture({ id: 'second' }),
    taskFixture({ id: 'done', state: 'completed', finishedAt: 2000 }),
  ];
  const run = runFixture({ tasks, usage: { ...usage, totalTokens: 18_400 } });
  await loaded([run]);
  expect(screen.getByText('3 agents')).toBeDefined();
  expect(screen.getByText('2 working · 1 completed')).toBeDefined();
  expect(screen.getByText('4m 12s elapsed · 18.4k worker tokens (partial)')).toBeDefined();
  expect(screen.queryByText('Requested model')).toBeNull();
  expect(screen.getByRole('button', { name: 'Show agents' }).getAttribute('aria-expanded')).toBe(
    'false',
  );
  expect(screen.getAllByRole('button', { name: 'Compare document names: Working' })).toHaveLength(
    2,
  );
  dashboardBridge.statusResult = {
    structuredContent: { runs: [{ ...run, usage: { ...usage, totalTokens: 20_000 } }], cursor: 2 },
  };
  await tick();
  expect(screen.getByText('4m 13s elapsed · 20k worker tokens (partial)')).toBeDefined();
});

it('drills from a square into current model, tokens and activity and returns to the preserved list', async () => {
  const tasks = [
    taskFixture(),
    taskFixture({ id: 'done', title: 'Finished agent', state: 'completed', finishedAt: 61_000 }),
  ];
  await loaded([runFixture({ tasks })]);
  fireEvent.click(screen.getByRole('button', { name: 'Show agents' }));
  fireEvent.click(screen.getByText('1 completed · 120 worker tokens'));
  const row = screen.getByRole('button', { name: /Finished agent · completed/ });
  row.focus();
  fireEvent.click(row);
  expect(screen.getByRole('heading', { name: 'Finished agent' })).toBeDefined();
  expect(screen.getByText('gpt-6-luna · medium')).toBeDefined();
  expect(screen.getByText('100 input · 20 output')).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: '‹ Back to all 2 agents' }));
  expect(document.activeElement).toBe(row);
  expect(screen.getByRole('button', { name: /Finished agent · completed/ })).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: 'Compare document names: Working' }));
  fireEvent.click(screen.getByText('View activity and evidence'));
  expect(screen.getAllByText('40 (included in input)')[0]).toBeDefined();
  expect(screen.getAllByText('5 (included in output)')[0]).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: '‹ Back to all 2 agents' }));
  fireEvent.click(screen.getByRole('button', { name: 'Hide agents' }));
  expect(screen.queryByRole('heading', { name: 'Compare document names' })).toBeNull();
});

it('keeps authored phase membership visible in agent rows and drill-down details', async () => {
  const tasks = [
    taskFixture(),
    taskFixture({
      id: 'verify',
      title: 'Verify sources',
      phase: { id: 'verification', label: 'Source verification' },
    }),
  ];
  await loaded([runFixture({ tasks })]);
  fireEvent.click(screen.getByRole('button', { name: 'Show agents' }));
  const row = screen.getByRole('button', { name: /Verify sources · Working/ });
  expect(within(row).getByText('Phase: Source verification')).toBeDefined();
  expect(
    within(screen.getByRole('button', { name: /Compare document names · Working/ })).getByText(
      'Phase: Folder inventory',
    ),
  ).toBeDefined();
  fireEvent.click(row);
  expect(
    within(document.querySelector('.agent-detail-card') as HTMLElement).getByText(
      'Phase: Source verification',
    ),
  ).toBeDefined();
});

it('collapses on completion and reopens with a compact latest result and expandable history', async () => {
  const current = runFixture({ id: 'new', title: 'Current run', tasks: [taskFixture()] });
  const view = await loaded([finished('older', -1), current]);
  fireEvent.click(
    within(screen.getByRole('region', { name: 'Current run' })).getByRole('button', {
      name: 'Show agents',
    }),
  );
  const complete = {
    ...current,
    state: 'completed' as const,
    tasks: [],
    finishedAt: 252_000,
    acceptanceOutcome: 'satisfied' as const,
  };
  dashboardBridge.statusResult = {
    structuredContent: { runs: [finished('older', -1), complete], cursor: 2 },
  };
  await tick();
  expect(screen.getByRole('button', { name: 'Show agents' }).getAttribute('aria-expanded')).toBe(
    'false',
  );
  expect(screen.queryByRole('region', { name: 'older' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'History · 1' }));
  expect(screen.getByRole('region', { name: 'older' })).toBeDefined();
  expect(screen.queryByRole('region', { name: 'Current run' })).toBeNull();
  view.unmount();
  await loaded([finished('older', -1), complete]);
  expect(screen.queryByRole('region', { name: 'older' })).toBeNull();
  expect(screen.getByRole('region', { name: 'Current run' })).toBeDefined();
  const before = screen.getByText('4m 12s elapsed · 120 worker tokens (partial)').textContent;
  await tick();
  expect(screen.getByText('4m 12s elapsed · 120 worker tokens (partial)').textContent).toBe(before);
  fireEvent.click(screen.getByRole('button', { name: 'History · 1' }));
  fireEvent.click(screen.getByRole('button', { name: 'Back to current' }));
  expect(screen.getByRole('region', { name: 'Current run' })).toBeDefined();
});

it('keeps old failed, unverified and reconciliation work in current view', async () => {
  const failed = finished('failed-run', 0);
  failed.state = 'failed';
  failed.error = 'Test runner unavailable';
  const blocked = finished('blocked-run', 1);
  blocked.acceptanceOutcome = 'blocked';
  const reconcile = finished('reconcile-run', 2);
  reconcile.tasks = [taskFixture({ state: 'needs_reconciliation' })];
  await loaded([failed, blocked, reconcile, finished('newest', 3)]);
  expect(screen.getAllByRole('region')).toHaveLength(4);
  expect(screen.getByText('Test runner unavailable')).toBeDefined();
  expect(screen.getAllByText('Needs attention')).toHaveLength(3);
});

it('shows missing usage honestly, truncates preview overflow and keeps every agent reachable', async () => {
  const states = [
    'queued',
    'waiting',
    'failed',
    'needs_reconciliation',
    'cancelled',
    'completed',
    'running',
  ] as const;
  const tasks = states.map((state, index) =>
    taskFixture({
      id: String(index),
      title: state,
      state,
      reportedModel: null,
      usage: null,
      startedAt: null,
    }),
  );
  await loaded([runFixture({ tasks, usage: null })]);
  expect(screen.getAllByText(/Tokens not reported/).length).toBeGreaterThan(0);
  expect(screen.getByText('+1')).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: 'Show agents' }));
  expect(screen.getByRole('button', { name: /running · Working/ })).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: 'queued: queued' }));
  expect(screen.getByText('Requested: gpt-6-luna · medium')).toBeDefined();
  expect(
    within(document.querySelector('.agent-detail-card') as HTMLElement).getByText(
      'Not started · Tokens not reported',
    ),
  ).toBeDefined();
});

it('resets drill-down and history when the binding changes without persisting UI state', async () => {
  const view = await loaded([finished('older', 0), finished('latest', 1)]);
  fireEvent.click(screen.getByRole('button', { name: 'History · 1' }));
  await act(async () =>
    view.rerender(
      createElement(Dashboard, {
        app: dashboardBridge.instance! as unknown as Pick<App, 'callServerTool'>,
        nonce: 'other',
      }),
    ),
  );
  expect(screen.getByRole('region', { name: 'latest' })).toBeDefined();
  expect(screen.queryByRole('region', { name: 'older' })).toBeNull();
});

it('opens an archived parent from its continuation link and returns to current work', async () => {
  const parent = finished('parent', 0);
  const child = runFixture({
    id: 'child',
    title: 'Child run',
    parentRunId: 'parent',
    createdAt: 2,
  });
  await loaded([parent, finished('latest', 1), child]);
  fireEvent.click(
    within(screen.getByRole('region', { name: 'Child run' })).getByText('Run details'),
  );
  fireEvent.click(screen.getByRole('link', { name: 'parent' }));
  expect(screen.getByRole('region', { name: 'parent' })).toBeDefined();
  expect(screen.queryByRole('region', { name: 'Child run' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Back to current' }));
  expect(screen.getByRole('region', { name: 'Child run' })).toBeDefined();
});

it('shows the last result to finish even when its run started earlier', async () => {
  const earlier = { ...finished('earlier-start', 0), finishedAt: 300_000 };
  await loaded([earlier, finished('later-start', 1000)]);
  expect(screen.getByRole('region', { name: 'earlier-start' })).toBeDefined();
  expect(screen.queryByRole('region', { name: 'later-start' })).toBeNull();
});
