// @vitest-environment happy-dom
import { createElement } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { RunCard } from '../src/ui/run-card.js';
import { runFixture } from './panel-ui-dashboard-fixture.js';

afterEach(cleanup);

it.each(['pending', 'claimed'] as const)(
  'keeps %s handoff payloads out of the overview',
  (state) => {
    const objective = `Verify worker output: ${JSON.stringify({ raw: 'x'.repeat(5000) })}`;
    const run = runFixture({
      handoffs: [
        {
          id: 'verify',
          state,
          claimedTurnId: null,
          result: null,
          spec: {
            phase: { id: 'verify', label: 'Verify' },
            objective,
            resources: [],
            evidence: [],
          },
        },
      ],
    });
    const view = render(
      createElement(RunCard, {
        run,
        runs: [run],
        now: 2000,
        busy: false,
        error: undefined,
        control: () => undefined,
      }),
    );
    const overview = view.container.querySelector<HTMLElement>('.run-overview')!;
    expect(
      within(overview).getByText(state === 'claimed' ? 'Lead is verifying' : 'Waiting for lead'),
    ).toBeDefined();
    expect(overview.textContent).not.toContain(objective);
    expect(overview.querySelector('.run-attention')).toBeNull();
    expect(screen.queryByText('Review needed')).toBeNull();
    expect(screen.queryByText('Needs attention')).toBeNull();
    const payload = screen.getByText(objective).closest('details')!;
    expect(payload.open).toBe(false);
  },
);

it('bounds error summaries and retains the full diagnostic in run details', () => {
  const error = 'x'.repeat(5000);
  const run = runFixture({ state: 'failed', error });
  const view = render(
    createElement(RunCard, {
      run,
      runs: [run],
      now: 2000,
      busy: false,
      error: undefined,
      control: () => undefined,
    }),
  );
  const overview = view.container.querySelector<HTMLElement>('.run-overview')!;
  expect(overview.textContent).toContain(`${'x'.repeat(160)}…`);
  expect(overview.textContent).not.toContain(error);
  const full = screen.getByText(error).closest('details')!;
  expect(full.open).toBe(false);
});
