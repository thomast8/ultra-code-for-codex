// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  dashboardBridge,
  deferredResult,
  resetBridge,
  runFixture,
} from './panel-ui-dashboard-fixture.js';

vi.mock('@modelcontextprotocol/ext-apps', async () => {
  const { dashboardBridge: bridge } = await import('./panel-ui-dashboard-fixture.js');
  return { App: bridge.MockApp, PostMessageTransport: class {} };
});
import { Panel } from '../src/ui/panel.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(20_000);
  resetBridge();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
async function bind(nonce = 'dashboard') {
  await act(async () =>
    dashboardBridge.instance?.emit({
      structuredContent: { bindingNonce: nonce, bound: true, capabilityAvailability: 'available' },
    }),
  );
}
async function tick(milliseconds = 1000) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
}
const snapshot = (title = 'Current workflow', cursor = 1) => ({
  structuredContent: { runs: [runFixture({ title })], cursor },
});

it('serializes polling and stops on unmount even when a read is still pending', async () => {
  const initial = deferredResult();
  const later = deferredResult();
  dashboardBridge.statusResults = [initial.promise, later.promise];
  const view = render(createElement(Panel));
  await bind();
  expect(screen.getByText('Reading this chat’s workflows…')).toBeDefined();
  await tick(5000);
  expect(dashboardBridge.calls).toHaveLength(1);
  await act(async () => initial.resolve(snapshot()));
  await tick();
  expect(dashboardBridge.calls).toHaveLength(2);
  view.unmount();
  await act(async () => later.resolve(snapshot('Late workflow', 2)));
  await tick(5000);
  expect(dashboardBridge.calls).toHaveLength(2);
  expect(dashboardBridge.closed).toBe(1);
  expect(screen.queryByText('Late workflow')).toBeNull();
});

it('ignores a stale old-nonce response and reads the new nonce only after it settles', async () => {
  const old = deferredResult();
  dashboardBridge.statusResults = [old.promise];
  dashboardBridge.statusResult = snapshot('New nonce workflow');
  render(createElement(Panel));
  await bind('old');
  await bind('new');
  expect(dashboardBridge.calls).toHaveLength(1);
  await act(async () => old.resolve(snapshot('Old nonce workflow', 999)));
  expect(screen.queryByText('Old nonce workflow')).toBeNull();
  expect(screen.getByText('New nonce workflow')).toBeDefined();
  expect(dashboardBridge.calls).toEqual([
    { name: 'ultra_status', arguments: { nonce: 'old' } },
    { name: 'ultra_status', arguments: { nonce: 'new' } },
  ]);
});

it('ignores old-nonce failures and late control acknowledgements', async () => {
  const oldStatus = deferredResult();
  dashboardBridge.statusResults = [oldStatus.promise];
  dashboardBridge.statusResult = snapshot();
  render(createElement(Panel));
  await bind('old');
  await bind('new');
  await act(async () => oldStatus.reject(new Error('Old nonce failed')));
  const control = deferredResult();
  dashboardBridge.controlResult = control.promise;
  fireEvent.click(screen.getByRole('button', { name: 'Pause Current workflow' }));
  await bind('third');
  await act(async () =>
    control.resolve({ isError: true, structuredContent: { reason: 'Stale control failed' } }),
  );
  expect(screen.queryByRole('alert')).toBeNull();
  expect(
    (screen.getByRole('button', { name: 'Pause Current workflow' }) as HTMLButtonElement).disabled,
  ).toBe(false);
});

it.each([
  [
    { isError: true, structuredContent: { reason: 'Workflow engine is disconnected.' } },
    'Workflow engine is disconnected.',
  ],
  [{ isError: true }, 'Workflow status is unavailable.'],
  [
    {
      isError: true,
      content: [{ type: 'text', text: 'The local runtime socket is unavailable.' }],
    },
    'The local runtime socket is unavailable.',
  ],
  [{ structuredContent: { runs: [{}], cursor: 2 } }, 'invalid workflow snapshot'],
])('reports unusable status %# and retries only when requested', async (result, reason) => {
  dashboardBridge.statusResult = result;
  render(createElement(Panel));
  await bind();
  expect(screen.getByRole('alert').textContent).toContain(reason);
  expect(screen.queryByText('No workflows yet.')).toBeNull();
  await tick(3000);
  expect(dashboardBridge.calls).toHaveLength(1);
  dashboardBridge.statusResult = snapshot();
  await act(async () =>
    fireEvent.click(screen.getByRole('button', { name: 'Retry workflow status' })),
  );
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByText('Current workflow')).toBeDefined();
});

it.each([new Error('Host status transport closed.'), 'unknown rejection'])(
  'reports a rejected status read without retaining loading state %#',
  async (reason) => {
    const pending = deferredResult();
    dashboardBridge.statusResult = pending.promise;
    render(createElement(Panel));
    await bind();
    await act(async () => pending.reject(reason));
    expect(screen.getByRole('alert').textContent).toContain(
      reason instanceof Error ? reason.message : 'Could not read workflow status.',
    );
    expect(screen.queryByText('Reading this chat’s workflows…')).toBeNull();
  },
);

it('keeps the latest snapshot when the host returns an older cursor', async () => {
  dashboardBridge.statusResult = snapshot('Current workflow', 8);
  render(createElement(Panel));
  await bind();
  dashboardBridge.statusResult = snapshot('Older workflow', 7);
  await tick();
  expect(screen.getByText('Current workflow')).toBeDefined();
  expect(screen.queryByText('Older workflow')).toBeNull();
});

it.each(['result', 'error'])(
  'discards an in-flight status %s predating a successful control and requests its real readback',
  async (kind) => {
    dashboardBridge.statusResult = snapshot();
    render(createElement(Panel));
    await bind();
    const oldRead = deferredResult();
    dashboardBridge.statusResults = [oldRead.promise];
    await tick();
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'Pause Current workflow' })),
    );
    dashboardBridge.statusResult = {
      structuredContent: {
        runs: [runFixture({ title: 'Current workflow', state: 'paused' })],
        cursor: 3,
      },
    };
    await act(async () => {
      if (kind === 'error') oldRead.reject(new Error('Stale request failed'));
      else oldRead.resolve(snapshot('Stale running workflow', 2));
    });
    expect(screen.queryByText('Stale running workflow')).toBeNull();
    expect(screen.getByRole('button', { name: 'Resume Current workflow' })).toBeDefined();
  },
);

it('advances elapsed time during a quiet pending status read without overlapping polls', async () => {
  dashboardBridge.statusResult = snapshot();
  render(createElement(Panel));
  await bind();
  expect(screen.getByText('19s')).toBeDefined();
  const pending = deferredResult();
  dashboardBridge.statusResult = pending.promise;
  await tick(6000);
  expect(screen.getByText('25s')).toBeDefined();
  expect(dashboardBridge.calls).toHaveLength(2);
  await act(async () => pending.resolve(snapshot()));
});

it.each([new Error('Control connection failed.'), 'unknown rejection'])(
  'reports rejected controls without changing observed run state %#',
  async (reason) => {
    const control = deferredResult();
    dashboardBridge.controlResult = control.promise;
    dashboardBridge.statusResult = snapshot();
    render(createElement(Panel));
    await bind();
    fireEvent.click(screen.getByRole('button', { name: 'Pause Current workflow' }));
    await act(async () => control.reject(reason));
    expect(screen.getByRole('alert').textContent).toContain(
      reason instanceof Error ? reason.message : 'Could not control this workflow.',
    );
    expect(screen.getByRole('button', { name: 'Pause Current workflow' })).toBeDefined();
  },
);

it('ignores pending control failures after unmount', async () => {
  const control = deferredResult();
  dashboardBridge.controlResult = control.promise;
  dashboardBridge.statusResult = snapshot();
  const view = render(createElement(Panel));
  await bind();
  fireEvent.click(screen.getByRole('button', { name: 'Pause Current workflow' }));
  view.unmount();
  await act(async () => control.reject(new Error('Late failure')));
  await tick();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(dashboardBridge.calls).toHaveLength(2);
});
