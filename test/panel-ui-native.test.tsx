// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest';
import { applyHostContext } from '../src/ui/panel.js';
import { panelStyles } from '../src/ui/styles.js';
import { attentionMessage, leadStatus, needsAttention } from '../src/ui/workflow-summary.js';
import { runFixture, taskFixture } from './panel-ui-dashboard-fixture.js';

afterEach(() => {
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('style');
});

it('adopts the host theme, style variables and fonts', () => {
  applyHostContext({
    theme: 'dark',
    styles: {
      variables: { '--color-text-primary': '#fafafa' } as never,
      css: { fonts: '@font-face{font-family:Host}' },
    },
  });
  const root = document.documentElement;
  expect(root.dataset.theme).toBe('dark');
  expect(root.style.getPropertyValue('--color-text-primary')).toBe('#fafafa');
  expect(document.head.textContent).toContain('font-family:Host');
  applyHostContext({ theme: 'light' });
  expect(root.dataset.theme).toBe('light');
  applyHostContext(undefined);
  expect(root.dataset.theme).toBe('light');
});

it('resolves every panel colour through a host variable with a fallback', () => {
  expect(panelStyles).toContain('--ink:var(--color-text-primary,');
  expect(panelStyles).toContain(':root[data-theme=dark]');
  expect(panelStyles).not.toMatch(/background:#[0-9a-f]{3,6}/i);
});

it('names the agent whose acceptance needs review instead of a generic message', () => {
  const unaccepted = taskFixture({
    title: 'Repair the frozen zero case',
    state: 'completed',
    result: {
      ...taskFixture().result!,
      acceptance: 'incomplete',
      unresolved: ['Coverage gates did not complete.'],
    },
  });
  const run = runFixture({ state: 'completed', acceptanceOutcome: 'satisfied', handoffs: [] });
  expect(attentionMessage({ ...run, tasks: [unaccepted] })).toBe(
    'Repair the frozen zero case reported acceptance incomplete: Coverage gates did not complete.',
  );
  const noDetail = { ...unaccepted, result: { ...unaccepted.result!, unresolved: [] } };
  expect(attentionMessage({ ...run, tasks: [noDetail] })).toBe(
    'Repair the frozen zero case reported acceptance incomplete.',
  );
  expect(
    attentionMessage({
      ...run,
      tasks: [taskFixture({ state: 'failed', title: 'Read', result: null })],
    }),
  ).toBe('Read: failed.');
  expect(attentionMessage({ ...run, tasks: [], acceptanceOutcome: 'blocked' })).toBe(
    'The run finished with acceptance blocked.',
  );
  expect(attentionMessage({ ...run, state: 'running', tasks: [] })).toBe(
    'The lead is handling the next decision.',
  );
});

it('keeps pending and claimed verification with the lead without exposing the payload', () => {
  const pending = {
    id: 'lead',
    state: 'pending' as const,
    claimedTurnId: null,
    result: null,
    spec: {
      phase: { id: 'verify', label: 'Verify' },
      objective: 'private worker JSON'.repeat(500),
      resources: [],
      evidence: [],
    },
  };
  const run = runFixture({ handoffs: [pending], tasks: [] });
  expect(leadStatus(run)).toBe('Waiting for lead');
  expect(attentionMessage(run)).toBe('The lead is handling the returned work.');
  expect(leadStatus({ ...run, handoffs: [{ ...pending, state: 'claimed' }] })).toBe(
    'Lead is verifying',
  );
  expect(leadStatus({ ...run, handoffs: [{ ...pending, state: 'resolved' }] })).toBeNull();
  expect(leadStatus({ ...run, state: 'completed' })).toBeNull();
  expect(leadStatus({ ...run, state: 'needs_reconciliation' })).toBeNull();
  expect(leadStatus({ ...run, error: 'Failure' })).toBeNull();
});

it('honors the lead’s accepted outcome without hiding uncertain execution', () => {
  const run = runFixture({
    state: 'completed',
    acceptanceOutcome: 'satisfied',
    handoffs: [],
    tasks: [taskFixture({ state: 'failed' })],
  });
  expect(needsAttention(run)).toBe(false);
  expect(needsAttention({ ...run, acceptanceOutcome: 'incomplete' })).toBe(true);
  expect(needsAttention({ ...run, error: 'Still unresolved' })).toBe(true);
  expect(needsAttention({ ...run, tasks: [taskFixture({ state: 'needs_reconciliation' })] })).toBe(
    true,
  );
});
