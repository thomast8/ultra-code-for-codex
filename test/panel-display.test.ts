import type { App, McpUiHostContext } from '@modelcontextprotocol/ext-apps';
import { afterEach, expect, it, vi } from 'vitest';
import { PanelDisplay } from '../src/ui/panel-display.js';

const result = { structuredContent: { bindingNonce: 'once', bound: true, openInPanel: true } };
const displays: PanelDisplay[] = [];
afterEach(async () => {
  await Promise.all(displays.splice(0).map((display) => display.close()));
});
function fixture(
  context: Partial<McpUiHostContext> | undefined = {
    displayMode: 'inline',
    availableDisplayModes: ['inline', 'fullscreen'],
  },
) {
  const requestDisplayMode = vi.fn(async () => ({ mode: 'fullscreen' as const }));
  const app = {
    getHostContext: () => context,
    requestDisplayMode,
    requestTeardown: vi.fn(async () => undefined),
  } as Pick<App, 'getHostContext' | 'requestDisplayMode' | 'requestTeardown'>;
  const display = new PanelDisplay(app);
  display.bind({ nonce: 'once', bound: true, panelKey: 'c'.repeat(64) });
  displays.push(display);
  return { display, requestDisplayMode, app };
}

it.each(['before', 'after'])(
  'opens a bound agent-requested panel once when the result arrives %s connect',
  async (order) => {
    const f = fixture();
    if (order === 'before') f.display.receive(result);
    f.display.ready();
    if (order === 'after') f.display.receive(result);
    f.display.receive(result);
    f.display.contextChanged();
    await vi.waitFor(() =>
      expect(f.requestDisplayMode).toHaveBeenCalledExactlyOnceWith({ mode: 'fullscreen' }),
    );
  },
);

it.each([
  { structuredContent: { ...result.structuredContent, openInPanel: false } },
  { structuredContent: { ...result.structuredContent, bound: false } },
  { structuredContent: { ...result.structuredContent, bindingNonce: undefined } },
  { ...result, isError: true },
])('does not open a manual, unbound or rejected result: %j', (input) => {
  const f = fixture();
  f.display.ready();
  f.display.receive(input);
  expect(f.requestDisplayMode).not.toHaveBeenCalled();
});

it.each([
  { displayMode: 'fullscreen' as const, availableDisplayModes: ['fullscreen' as const] },
  { displayMode: 'inline' as const, availableDisplayModes: ['inline' as const] },
])('respects the host display mode: %j', (context) => {
  const f = fixture(context);
  f.display.ready();
  f.display.receive(result);
  expect(f.requestDisplayMode).not.toHaveBeenCalled();
});

it('waits for host capabilities and stops after disposal', async () => {
  const f = fixture();
  const hostContext = vi.spyOn(f.app, 'getHostContext').mockReturnValue(undefined);
  f.display.ready();
  f.display.receive(result);
  expect(f.requestDisplayMode).not.toHaveBeenCalled();
  hostContext.mockRestore();
  f.display.contextChanged();
  await vi.waitFor(() => expect(f.requestDisplayMode).toHaveBeenCalledOnce());
  f.display.close();
  f.display.receive({ structuredContent: { ...result.structuredContent, bindingNonce: 'new' } });
  expect(f.requestDisplayMode).toHaveBeenCalledOnce();
});

it('contains a host rejection without repeatedly requesting display', async () => {
  const f = fixture();
  f.requestDisplayMode.mockRejectedValueOnce(new Error('Host rejected'));
  f.display.ready();
  f.display.receive(result);
  await vi.waitFor(() => expect(f.requestDisplayMode).toHaveBeenCalledOnce());
  await Promise.resolve();
  f.display.contextChanged();
  expect(f.requestDisplayMode).toHaveBeenCalledOnce();
});
