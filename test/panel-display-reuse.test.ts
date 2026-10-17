import type { App, McpUiHostContext } from '@modelcontextprotocol/ext-apps';
import { afterEach, expect, it, vi } from 'vitest';
import { PanelDisplay } from '../src/ui/panel-display.js';

const displays: PanelDisplay[] = [];
const key = 'a'.repeat(64);
afterEach(async () => {
  await Promise.all(displays.splice(0).map((display) => display.close()));
});

function panel(
  fullscreen = false,
  panelKey = key,
  ready = true,
  locks: ConstructorParameters<typeof PanelDisplay>[2] = navigator.locks,
) {
  let context: Partial<McpUiHostContext> = {
    displayMode: fullscreen ? 'fullscreen' : 'inline',
    availableDisplayModes: ['inline', 'fullscreen'],
  };
  const requestDisplayMode = vi.fn(async (): Promise<{ mode: 'inline' | 'fullscreen' }> => {
    context = { ...context, displayMode: 'fullscreen' };
    return { mode: 'fullscreen' as const };
  });
  const requestTeardown = vi.fn(async () => undefined);
  const app = { getHostContext: () => context, requestDisplayMode, requestTeardown } as Pick<
    App,
    'getHostContext' | 'requestDisplayMode' | 'requestTeardown'
  >;
  const status = vi.fn();
  const display = new PanelDisplay(app, status, locks);
  displays.push(display);
  const state = { nonce: crypto.randomUUID(), bound: true, panelKey };
  display.receive({
    structuredContent: { bindingNonce: state.nonce, bound: true, openInPanel: !fullscreen },
  });
  display.bind(state);
  if (ready) display.ready();
  return {
    display,
    requestTeardown,
    status,
    requestDisplayMode,
    setContext: (next: typeof context) => (context = next),
  };
}

it('reuses a manually opened panel without promoting a second view', async () => {
  const manual = panel(true);
  await vi.waitFor(() => expect(manual.status).toHaveBeenLastCalledWith('active'));
  const opener = panel();
  await vi.waitFor(() => expect(opener.status).toHaveBeenLastCalledWith('reused'));
  expect(opener.requestDisplayMode).not.toHaveBeenCalled();
});

it('asks the host to close only a duplicate fullscreen view', async () => {
  const manual = panel(true);
  await vi.waitFor(() => expect(manual.status).toHaveBeenLastCalledWith('active'));
  const duplicate = panel(true);
  await vi.waitFor(() => expect(duplicate.requestTeardown).toHaveBeenCalledOnce());
  expect(manual.requestTeardown).not.toHaveBeenCalled();
  expect(duplicate.requestDisplayMode).not.toHaveBeenCalled();
});

it('opens again after the existing panel closes', async () => {
  const manual = panel(true);
  await vi.waitFor(() => expect(manual.status).toHaveBeenLastCalledWith('active'));
  await manual.display.close();
  const opener = panel();
  await vi.waitFor(() => expect(opener.requestDisplayMode).toHaveBeenCalledOnce());
});

it('admits only one of two concurrent opener calls', async () => {
  const first = panel();
  const second = panel();
  await vi.waitFor(() => {
    expect(first.status.mock.calls.length + second.status.mock.calls.length).toBeGreaterThanOrEqual(
      2,
    );
  });
  expect(
    first.requestDisplayMode.mock.calls.length + second.requestDisplayMode.mock.calls.length,
  ).toBe(1);
  expect([first.status.mock.lastCall?.[0], second.status.mock.lastCall?.[0]].sort()).toEqual([
    'active',
    'reused',
  ]);
});

it('does not reuse a panel belonging to another verified owner', async () => {
  const first = panel(true);
  await vi.waitFor(() => expect(first.status).toHaveBeenLastCalledWith('active'));
  const other = panel(false, 'b'.repeat(64));
  await vi.waitFor(() => expect(other.requestDisplayMode).toHaveBeenCalledOnce());
});

it('releases ownership when a fullscreen panel returns inline', async () => {
  const manual = panel(true);
  await vi.waitFor(() => expect(manual.status).toHaveBeenLastCalledWith('active'));
  manual.setContext({ displayMode: 'inline', availableDisplayModes: ['inline', 'fullscreen'] });
  manual.display.contextChanged();
  await vi.waitFor(async () => {
    expect(
      (await navigator.locks.query()).held?.filter((lock) => lock.name === `ultra-panel:${key}`),
    ).toHaveLength(0);
  });
  const opener = panel();
  await vi.waitFor(() => expect(opener.requestDisplayMode).toHaveBeenCalledOnce());
});

it('reclaims ownership when the same view is manually expanded again', async () => {
  const manual = panel(true);
  await vi.waitFor(() => expect(manual.status).toHaveBeenLastCalledWith('active'));
  manual.setContext({ displayMode: 'inline' });
  manual.display.contextChanged();
  await vi.waitFor(async () => {
    expect(
      (await navigator.locks.query()).held?.filter((lock) => lock.name === `ultra-panel:${key}`),
    ).toHaveLength(0);
  });
  manual.setContext({ displayMode: 'fullscreen' });
  manual.display.contextChanged();
  await vi.waitFor(async () => {
    expect(
      (await navigator.locks.query()).held?.filter((lock) => lock.name === `ultra-panel:${key}`),
    ).toHaveLength(1);
  });
  const opener = panel();
  await vi.waitFor(() => expect(opener.status).toHaveBeenLastCalledWith('reused'));
});

it.each(['rejected', 'refused'])(
  'releases the lock after the host %s the display request',
  async (outcome) => {
    const failed = panel(false, key, false);
    if (outcome === 'rejected')
      failed.requestDisplayMode.mockRejectedValueOnce(new Error('Denied'));
    else failed.requestDisplayMode.mockResolvedValueOnce({ mode: 'inline' });
    failed.display.ready();
    await vi.waitFor(() => expect(failed.status).toHaveBeenLastCalledWith('blocked'));
    await vi.waitFor(async () => {
      expect(
        (await navigator.locks.query()).held?.filter((lock) => lock.name === `ultra-panel:${key}`),
      ).toHaveLength(0);
    });
    const next = panel();
    await vi.waitFor(() => expect(next.requestDisplayMode).toHaveBeenCalledOnce());
  },
);

it('refuses automatic opening when browser locking is unavailable', async () => {
  const unsupported = panel(false, key, true, null);
  await vi.waitFor(() => expect(unsupported.status).toHaveBeenLastCalledWith('blocked'));
  expect(unsupported.requestDisplayMode).not.toHaveBeenCalled();
});

it('does not reopen a panel collapsed while its lock request was pending', async () => {
  let grant: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (grant = resolve));
  const locks = {
    request: vi.fn((name: string, options: LockOptions, callback: LockGrantedCallback<void>) =>
      gate.then(() => navigator.locks.request(name, options, callback)),
    ),
  };
  const manual = panel(true, key, true, locks);
  manual.setContext({ displayMode: 'inline' });
  manual.display.contextChanged();
  grant();
  await locks.request.mock.results[0]?.value;
  expect(manual.requestDisplayMode).not.toHaveBeenCalled();
});

it('keeps an explicitly opened manual panel usable without Web Locks', async () => {
  const manual = panel(true, key, true, null);
  await vi.waitFor(() => expect(manual.status).toHaveBeenLastCalledWith('active'));
  expect(manual.requestDisplayMode).not.toHaveBeenCalled();
});

it('releases the previous owner when a view is rebound', async () => {
  const existing = panel(true);
  await vi.waitFor(() => expect(existing.status).toHaveBeenLastCalledWith('active'));
  existing.display.bind({ nonce: 'new-owner', bound: true, panelKey: 'b'.repeat(64) });
  await vi.waitFor(async () => {
    expect(
      (await navigator.locks.query()).held?.filter((lock) => lock.name === `ultra-panel:${key}`),
    ).toHaveLength(0);
  });
  const previousOwner = panel();
  await vi.waitFor(() => expect(previousOwner.requestDisplayMode).toHaveBeenCalledOnce());
});
