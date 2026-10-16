// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ultraMenu from '../plugin/assets/ultra-menu.png';
import {
  dashboardBridge,
  deferredResult,
  resetBridge,
  runFixture,
  taskFixture,
  threeRuns,
} from './panel-ui-dashboard-fixture.js';

vi.mock('@modelcontextprotocol/ext-apps', async (importOriginal) => {
  const { dashboardBridge: bridge } = await import('./panel-ui-dashboard-fixture.js');
  return {
    ...(await importOriginal<object>()),
    App: bridge.MockApp,
    PostMessageTransport: class {},
  };
});
import { Panel } from '../src/ui/panel.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(3_661_000);
  resetBridge();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
async function openPanel(content: Record<string, unknown> = {}) {
  const view = render(createElement(Panel));
  await act(async () =>
    dashboardBridge.instance?.emit({
      structuredContent: {
        bindingNonce: 'dashboard',
        bound: true,
        capabilityAvailability: 'available',
        ...content,
      },
    }),
  );
  for (const button of screen.queryAllByRole('button', { name: 'Show agents' }))
    fireEvent.click(button);
  for (const details of document.querySelectorAll('details')) {
    if (!details.open) fireEvent.click(details.querySelector('summary')!);
  }
  return view;
}
async function tick() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
}

it('renders three concurrent workflows with dynamic phases and separate execution and acceptance', async () => {
  dashboardBridge.statusResult = { structuredContent: { runs: threeRuns(), cursor: 7 } };
  await openPanel();
  const brand = screen.getByRole('heading', { name: 'Ultra' });
  const logo = brand.querySelector('img');
  expect(logo?.getAttribute('src')).toBe(ultraMenu);
  expect(logo?.getAttribute('alt')).toBe('');
  expect(screen.getAllByRole('region')).toHaveLength(3);
  expect(screen.getByRole('region', { name: 'Audit documents' })).toBeDefined();
  expect(screen.getByText('Source verification')).toBeDefined();
  expect(screen.getByText('Decide the next step')).toBeDefined();
  expect(screen.getAllByText('Decide whether the missing lease blocks delivery.')[0]).toBeDefined();
  expect(screen.getByText('Waiting for the lead.')).toBeDefined();
  expect(screen.getByRole('link', { name: 'Audit documents' }).getAttribute('href')).toBe(
    '#run-run-1',
  );
  const completed = within(screen.getByRole('region', { name: 'Check references' }));
  expect(completed.getByText('completed').className).toContain('tone-completed');
  expect(completed.getAllByText('Acceptance: blocked')[0]).toBeDefined();
  expect(completed.queryByRole('button', { name: /Cancel/ })).toBeNull();
  expect(screen.getAllByText('running', { selector: '.workflow-badge' })[0]?.className).toContain(
    'tone-running',
  );
  expect(screen.getByText('queued', { selector: '.workflow-badge' }).className).toContain(
    'tone-queued',
  );
  expect(screen.getByText('waiting', { selector: '.workflow-badge' }).className).toContain(
    'tone-attention',
  );
  expect(screen.getByText('failed', { selector: '.workflow-badge' }).className).toContain(
    'tone-failed',
  );
  expect(dashboardBridge.messages).toBe(0);
});

it('drills into rationale, actual model and token subsets without adding cached or reasoning usage', async () => {
  dashboardBridge.statusResult = { structuredContent: { runs: threeRuns(), cursor: 1 } };
  await openPanel();
  const first = within(screen.getByRole('region', { name: 'Audit documents' }));
  fireEvent.click(first.getByRole('button', { name: 'Compare document names: Working' }));
  fireEvent.click(first.getByText('View activity and evidence'));
  expect(first.getByText('Requested model')).toBeDefined();
  expect(first.getByText('Reported model')).toBeDefined();
  expect(first.getByText('Luna can compare this bounded file list.')).toBeDefined();
  expect(first.getAllByText('40 (included in input)')[0]).toBeDefined();
  expect(first.getAllByText('5 (included in output)')[0]).toBeDefined();
  expect(first.queryByText('165 worker tokens')).toBeNull();
  fireEvent.click(first.getByRole('button', { name: 'Back to all 4 agents' }));
  fireEvent.click(first.getByRole('button', { name: /Verify the register · completed/ }));
  fireEvent.click(first.getByText('View activity and evidence'));
  expect(first.getByText('Confirm whether the lease was uploaded.')).toBeDefined();
  expect(first.getByRole('link', { name: 'Original register' }).getAttribute('href')).toBe(
    'https://example.test/register',
  );
  expect(first.queryByRole('link', { name: 'Unusable source link' })).toBeNull();
});

it('shows a live soft threshold warning and a conditional credit estimate without changing acceptance', async () => {
  const usage = {
    inputTokens: 168_686,
    cachedInputTokens: 132_608,
    outputTokens: 2_237,
    reasoningOutputTokens: 1_000,
    totalTokens: 170_923,
  };
  dashboardBridge.statusResult = {
    structuredContent: {
      runs: [
        runFixture({
          usage,
          budget: { maxObservedTokens: 50_000 },
          tasks: [taskFixture({ usage })],
        }),
      ],
      cursor: 1,
    },
  };
  await openPanel();
  const card = within(screen.getByRole('region', { name: 'Audit documents' }));
  expect(card.getAllByText(/Soft token threshold reached/)).toHaveLength(2);
  expect(card.getAllByText(/120,923 over/)).toHaveLength(2);
  expect(
    card.getAllByText(/Running workers finish; later worker dispatch is blocked/),
  ).toHaveLength(2);
  expect(card.getAllByText(/0.0611145–0.1513095 credits/)).toHaveLength(2);
  expect(card.getByText('Cache writes')).toBeDefined();
  expect(card.getByText('Not reported')).toBeDefined();
  expect(card.queryByText('Acceptance: satisfied')).toBeNull();
});

it('shows no-workflows only after an available engine returns a verified empty snapshot', async () => {
  await openPanel();
  expect(screen.getByText('No workflows yet.')).toBeDefined();
  expect(dashboardBridge.calls).toEqual([
    { name: 'ultra_status', arguments: { nonce: 'dashboard' } },
  ]);
});

it('shows the actual unavailable capability reason without polling or claiming an empty engine', async () => {
  await openPanel({
    capabilityAvailability: 'unavailable',
    capabilityReason: 'Local workflow engine could not connect.',
  });
  expect(screen.getByRole('alert').textContent).toBe('Local workflow engine could not connect.');
  expect(screen.queryByText('No workflows yet.')).toBeNull();
  await tick();
  expect(dashboardBridge.calls).toEqual([]);
});

describe('per-run controls', () => {
  it.each([
    ['Pause Audit documents', 'run-1', 'pause'],
    ['Resume Review follow-up', 'run-2', 'resume'],
    ['Cancel Audit documents', 'run-1', 'cancel'],
  ])(
    'sends only the selected %s action and refreshes its observed state',
    async (label, runId, action) => {
      dashboardBridge.statusResult = { structuredContent: { runs: threeRuns(), cursor: 1 } };
      await openPanel();
      await act(async () => fireEvent.click(screen.getByRole('button', { name: label })));
      expect(dashboardBridge.calls.filter((call) => call.name === 'ultra_panel_control')).toEqual([
        { name: 'ultra_panel_control', arguments: { nonce: 'dashboard', runId, action } },
      ]);
      expect(dashboardBridge.calls.filter((call) => call.name === 'ultra_status')).toHaveLength(2);
      expect(screen.getByRole('button', { name: label })).toBeDefined();
    },
  );

  it('prevents duplicate controls and leaves other workflows independently controllable', async () => {
    const control = deferredResult();
    dashboardBridge.controlResult = control.promise;
    dashboardBridge.statusResult = { structuredContent: { runs: threeRuns(), cursor: 1 } };
    await openPanel();
    const pause = screen.getByRole('button', { name: 'Pause Audit documents' });
    fireEvent.click(pause);
    fireEvent.click(pause);
    expect((pause as HTMLButtonElement).disabled).toBe(true);
    expect(
      (screen.getByRole('button', { name: 'Resume Review follow-up' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    expect(
      dashboardBridge.calls.filter((call) => call.name === 'ultra_panel_control'),
    ).toHaveLength(1);
    await act(async () =>
      control.resolve({
        isError: true,
        structuredContent: { reason: 'This workflow has already finished.' },
      }),
    );
    expect(screen.getByRole('alert').textContent).toContain('already finished');
    expect((pause as HTMLButtonElement).disabled).toBe(false);
  });
});

it('renders resolved and claimed handoffs, reconciliation and final result without adding static phases', async () => {
  const run = runFixture({
    state: 'needs_reconciliation',
    phases: [],
    tasks: [],
    handoffs: [
      {
        id: 'claimed',
        state: 'claimed',
        claimedTurnId: 'turn',
        result: null,
        spec: {
          phase: { id: 'lead', label: 'Custom lead decision' },
          objective: 'Read the evidence',
          evidence: [],
          resources: [],
        },
      },
      {
        id: 'resolved',
        state: 'resolved',
        claimedTurnId: 'turn',
        result: {
          acceptance: 'satisfied',
          value: 'Accepted by the lead',
          evidence: [],
          revision: 'v1',
        },
        spec: {
          phase: { id: 'lead', label: 'Custom lead decision' },
          objective: 'Resolve the decision',
          evidence: [],
          resources: [],
        },
      },
    ],
  });
  dashboardBridge.statusResult = { structuredContent: { runs: [run], cursor: 1 } };
  await openPanel();
  expect(screen.getByText('needs reconciliation')).toBeDefined();
  expect(screen.getByText('Custom lead decision')).toBeDefined();
  expect(screen.getByText('Lead review in progress.')).toBeDefined();
  expect(screen.getByText('Accepted by the lead')).toBeDefined();
  expect(screen.queryByRole('button', { name: 'Pause Audit documents' })).toBeNull();
});

it('keeps Cancel available after script failure until its remaining worker stops', async () => {
  const run = runFixture({ state: 'failed', error: 'A parallel branch failed.' });
  dashboardBridge.statusResult = { structuredContent: { runs: [run], cursor: 1 } };
  await openPanel();
  expect(screen.queryByRole('button', { name: 'Pause Audit documents' })).toBeNull();
  await act(async () =>
    fireEvent.click(screen.getByRole('button', { name: 'Cancel Audit documents' })),
  );
  expect(dashboardBridge.calls.filter((call) => call.name === 'ultra_panel_control')).toEqual([
    {
      name: 'ultra_panel_control',
      arguments: { nonce: 'dashboard', runId: 'run-1', action: 'cancel' },
    },
  ]);
  dashboardBridge.statusResult = {
    structuredContent: {
      runs: [{ ...run, tasks: run.tasks.map((task) => ({ ...task, state: 'cancelled' })) }],
      cursor: 2,
    },
  };
  await tick();
  expect(screen.queryByRole('button', { name: 'Cancel Audit documents' })).toBeNull();
});

it('allows cancelling a failed script with a claimed lead handoff', async () => {
  const run = runFixture({
    state: 'failed',
    tasks: [],
    handoffs: [
      {
        id: 'claimed-after-failure',
        state: 'claimed',
        claimedTurnId: 'turn',
        result: null,
        spec: {
          phase: { id: 'lead', label: 'Readback' },
          objective: 'Check the current state',
          resources: [],
          evidence: [],
        },
      },
    ],
  });
  dashboardBridge.statusResult = { structuredContent: { runs: [run], cursor: 1 } };
  await openPanel();
  await act(async () =>
    fireEvent.click(screen.getByRole('button', { name: 'Cancel Audit documents' })),
  );
  expect(dashboardBridge.calls.filter((call) => call.name === 'ultra_panel_control')).toEqual([
    {
      name: 'ultra_panel_control',
      arguments: { nonce: 'dashboard', runId: 'run-1', action: 'cancel' },
    },
  ]);
});

it.each(['cancelled', 'failed', 'completed'] as const)(
  'hides unclaimed handoffs in %s workflows but retains claimed and reconciliation work',
  async (state) => {
    const pending = threeRuns()[0]!.handoffs[0]!;
    const run = runFixture({
      state,
      tasks: [],
      phases: [],
      handoffs: [
        pending,
        {
          ...pending,
          id: 'claimed',
          state: 'claimed',
          claimedTurnId: 'turn',
          spec: { ...pending.spec, objective: 'Verify the claimed action' },
        },
        {
          ...pending,
          id: 'reconcile',
          state: 'needs_reconciliation',
          claimedTurnId: 'turn',
          spec: { ...pending.spec, objective: 'Reconcile the interrupted action' },
        },
      ],
    });
    dashboardBridge.statusResult = { structuredContent: { runs: [run], cursor: 1 } };
    await openPanel();
    expect(screen.queryByText('Waiting for the lead.')).toBeNull();
    expect(screen.queryByText(pending.spec.objective)).toBeNull();
    expect(screen.getByText('Verify the claimed action')).toBeDefined();
    expect(screen.getByText('Reconcile the interrupted action')).toBeDefined();
    expect(screen.getByText('0 tasks · 2 handoffs')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Cancel Audit documents' })).toBeDefined();
    expect(run.handoffs.map((handoff) => handoff.state)).toEqual([
      'pending',
      'claimed',
      'needs_reconciliation',
    ]);
  },
);

it('keeps historical terminal elapsed time unknown instead of running its clock', async () => {
  const run = runFixture({ state: 'cancelled', tasks: [], finishedAt: null });
  dashboardBridge.statusResult = { structuredContent: { runs: [run], cursor: 1 } };
  await openPanel();
  expect(screen.getByText(/Elapsed unknown ·/)).toBeDefined();
  await tick();
  expect(screen.getByText(/Elapsed unknown ·/)).toBeDefined();
});

it('lists each phase’s agents inside its dropdown and never opens an empty one', async () => {
  dashboardBridge.statusResult = { structuredContent: { runs: threeRuns(), cursor: 7 } };
  await openPanel();
  const first = within(screen.getByRole('region', { name: 'Audit documents' }));
  const verify = first.getByText('Source verification').closest('details') as HTMLElement;
  expect(within(verify).getByText('1 task · 0 handoffs')).toBeDefined();
  expect(within(verify).getByText('Verify the register')).toBeDefined();
  const finished = within(screen.getByRole('region', { name: 'Check references' }));
  expect(finished.queryByText('0 agents')).toBeNull();
  expect(finished.queryByRole('button', { name: 'Show agents' })).toBeNull();
});

it('opens an agent as its own view with a back bar and run context', async () => {
  dashboardBridge.statusResult = { structuredContent: { runs: threeRuns(), cursor: 7 } };
  await openPanel();
  const first = within(screen.getByRole('region', { name: 'Audit documents' }));
  fireEvent.click(first.getByRole('button', { name: 'Compare document names: Working' }));
  const nav = first.getByRole('navigation', { name: 'Agent navigation' });
  expect(within(nav).getByRole('button', { name: 'Back to all 4 agents' })).toBeDefined();
  expect(within(nav).getByText('Audit documents')).toBeDefined();
  expect(first.queryByText('Needs attention')).toBeNull();
  fireEvent.click(within(nav).getByRole('button', { name: 'Back to all 4 agents' }));
  expect(first.queryByRole('navigation', { name: 'Agent navigation' })).toBeNull();
  expect(first.getByText('Needs attention')).toBeDefined();
});
