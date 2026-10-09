// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const appState = vi.hoisted(() => {
  class MockApp {
    private handlers = new Map<string, (payload: unknown) => void>();
    readonly sent: unknown[] = [];
    readonly reads: unknown[] = [];
    constructor(info: unknown) {
      void info;
      appState.instance = this;
    }
    addEventListener(name: string, handler: (payload: unknown) => void) {
      this.handlers.set(name, handler);
    }
    emit(name: string, payload: unknown) {
      this.handlers.get(name)?.(payload);
    }
    async connect(transport: unknown) {
      void transport;
      if (appState.connectError) throw new Error('Host connection failed');
    }
    async sendMessage(message: unknown) {
      this.sent.push(message);
      if (appState.sendError) throw new Error('Host message failed');
      return appState.sendResult;
    }
    async callServerTool(request: unknown) {
      this.reads.push(request);
      if (appState.readError) throw new Error('Host status failed');
      return appState.readResults.shift() ?? appState.readResult;
    }
    close() {
      return undefined;
    }
  }
  return {
    instance: undefined as InstanceType<typeof MockApp> | undefined,
    sendResult: { isError: false } as unknown,
    readResult: { structuredContent: { state: 'pending' } } as unknown,
    readResults: [] as unknown[],
    sendError: false,
    readError: false,
    connectError: false,
    MockApp,
  };
});

vi.mock('@modelcontextprotocol/ext-apps', () => ({
  App: appState.MockApp,
  PostMessageTransport: class {
    constructor(target: unknown, source: unknown) {
      void target;
      void source;
    }
  },
}));

import { Panel } from '../src/ui/panel.js';

function deferred() {
  let resolve: (value: unknown) => void = () => undefined;
  let reject: (reason: Error) => void = () => undefined;
  const promise = new Promise<unknown>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function emitNonce(nonce = 'opaque-once') {
  await act(async () => {
    appState.instance?.emit('toolresult', { structuredContent: { bindingNonce: nonce } });
  });
}

async function tick() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
}

const status = () => screen.getByRole('status').textContent;
const bindButton = () => screen.getByRole('button', { name: 'Show this chat’s workflows' });

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
beforeEach(() => {
  vi.useFakeTimers();
  appState.instance = undefined;
  appState.sendResult = { isError: false };
  appState.readResult = { structuredContent: { state: 'pending' } };
  appState.readResults = [];
  appState.sendError = false;
  appState.readError = false;
  appState.connectError = false;
});

describe('Ultra Code panel UI', () => {
  it('reads the original panel’s external binding without receiving its own bound tool result', async () => {
    render(createElement(Panel));
    expect(screen.getByText(/Compatibility probe/)).toBeDefined();
    await emitNonce();
    expect(status()).toContain('Ready to bind');
    expect(appState.instance?.reads).toEqual([
      { name: 'ultra_panel_status', arguments: { nonce: 'opaque-once' } },
    ]);
    expect(appState.instance?.sent).toHaveLength(0);
    await act(async () => fireEvent.click(bindButton()));
    expect(status()).toContain('request queued');
    appState.readResult = { structuredContent: { state: 'binding' } };
    await tick();
    expect(status()).toContain('processing');
    appState.readResult = { structuredContent: { state: 'bound' } };
    await tick();
    expect(status()).toContain('This chat is bound');
    expect(screen.queryByRole('button', { name: 'Show this chat’s workflows' })).toBeNull();
    await tick();
    expect(appState.instance?.reads).toHaveLength(3);
  });

  it('sends one explicit message despite repeated clicks while sending or queued', async () => {
    const sent = deferred();
    appState.sendResult = sent.promise;
    render(createElement(Panel));
    await emitNonce();
    fireEvent.click(bindButton());
    fireEvent.click(bindButton());
    await act(async () => sent.resolve({ isError: false }));
    await emitNonce();
    fireEvent.click(bindButton());
    expect(appState.instance?.sent).toEqual([
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Bind Ultra Code panel nonce opaque-once to this chat using ultra_panel_bind and the current verified context handle.',
          },
        ],
      },
    ]);
    expect(status()).toContain('request queued');
  });

  it('immediately reads an already bound reopened panel', async () => {
    appState.readResult = { structuredContent: { state: 'bound' } };
    render(createElement(Panel));
    await emitNonce();
    expect(status()).toContain('This chat is bound');
    await tick();
    expect(appState.instance?.reads).toHaveLength(1);
  });
});

describe('binding races and cleanup', () => {
  it('serializes reads and ignores a stale old-nonce response', async () => {
    const oldRead = deferred();
    appState.readResults = [oldRead.promise];
    render(createElement(Panel));
    await emitNonce('old');
    await tick();
    await emitNonce('new');
    expect(appState.instance?.reads).toHaveLength(1);
    await act(async () => oldRead.resolve({ structuredContent: { state: 'bound' } }));
    expect(appState.instance?.reads).toEqual([
      { name: 'ultra_panel_status', arguments: { nonce: 'old' } },
      { name: 'ultra_panel_status', arguments: { nonce: 'new' } },
    ]);
    expect(status()).toContain('Ready to bind');
  });

  it('ignores status and send responses after unmount and does not schedule more reads', async () => {
    const read = deferred();
    const sent = deferred();
    appState.readResults = [read.promise];
    appState.sendResult = sent.promise;
    const view = render(createElement(Panel));
    await emitNonce();
    fireEvent.click(bindButton());
    view.unmount();
    await act(async () => {
      read.resolve({ structuredContent: { state: 'pending' } });
      sent.resolve({ isError: false });
    });
    await tick();
    expect(appState.instance?.reads).toHaveLength(1);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it.each(['accepted', 'rejected', 'exception'])(
    'keeps confirmed binding after a late send %s',
    async (outcome) => {
      const sent = deferred();
      appState.sendResult = sent.promise;
      render(createElement(Panel));
      await emitNonce();
      fireEvent.click(bindButton());
      appState.readResult = { structuredContent: { state: 'bound' } };
      await tick();
      await act(async () => {
        if (outcome === 'exception') sent.reject(new Error('Late send failure'));
        else sent.resolve({ isError: outcome === 'rejected' });
      });
      expect(status()).toContain('This chat is bound');
    },
  );
});

describe('host failures and malformed panel results', () => {
  it('keeps the button disabled before a usable nonce arrives', () => {
    render(createElement(Panel));
    act(() => appState.instance?.emit('toolresult', {}));
    act(() => appState.instance?.emit('toolresult', { structuredContent: { bindingNonce: '' } }));
    expect((bindButton() as HTMLButtonElement).disabled).toBe(true);
    expect(status()).toContain('Open the panel tool');
  });

  it('reports failed host connection without claiming a binding', async () => {
    appState.connectError = true;
    await act(async () => render(createElement(Panel)));
    expect(status()).toContain('does not support');
  });

  it.each(['rejected', 'exception'])(
    'allows retry only after explicit send %s',
    async (outcome) => {
      appState.sendError = outcome === 'exception';
      appState.sendResult = { isError: true };
      render(createElement(Panel));
      await emitNonce();
      await act(async () => fireEvent.click(bindButton()));
      expect(status()).toContain('You can retry');
      expect((bindButton() as HTMLButtonElement).disabled).toBe(false);
      appState.sendError = false;
      appState.sendResult = { isError: false };
      await act(async () => fireEvent.click(bindButton()));
      expect(appState.instance?.sent).toHaveLength(2);
    },
  );
});

describe('status read failures and retries', () => {
  it('retries a transient status failure without sending a duplicate chat message', async () => {
    render(createElement(Panel));
    await emitNonce();
    await act(async () => fireEvent.click(bindButton()));
    appState.readError = true;
    await tick();
    expect(status()).toContain('Could not read');
    await tick();
    expect(appState.instance?.reads).toHaveLength(2);
    appState.readError = false;
    appState.readResult = { structuredContent: { state: 'pending' } };
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'Retry binding status' })),
    );
    expect(status()).toContain('request queued');
    expect((bindButton() as HTMLButtonElement).disabled).toBe(true);
    appState.readResult = { structuredContent: { state: 'bound' } };
    await tick();
    expect(status()).toContain('This chat is bound');
    expect(appState.instance?.sent).toHaveLength(1);
  });

  it.each([
    [{ structuredContent: { state: 'not-a-state' } }, 'invalid binding status'],
    [
      { isError: true, structuredContent: { bound: false, reason: 'Unknown nonce' } },
      'Unknown nonce',
    ],
    [{ isError: true }, 'Could not read'],
  ])('does not claim binding from unusable status %j', async (result, reason) => {
    appState.readResult = result;
    render(createElement(Panel));
    await emitNonce();
    expect(status()).toContain(reason);
    expect(screen.getByRole('button', { name: 'Retry binding status' })).toBeDefined();
    await tick();
    expect(appState.instance?.reads).toHaveLength(1);
  });

  it('stops polling a failed binding and renders existing inline tool results honestly', async () => {
    appState.readResult = { structuredContent: { state: 'failed' } };
    render(createElement(Panel));
    await emitNonce();
    expect(status()).toContain('binding failed');
    await tick();
    expect(appState.instance?.reads).toHaveLength(1);
    cleanup();
    render(createElement(Panel));
    act(() =>
      appState.instance?.emit('toolresult', {
        structuredContent: { bound: false, reason: 'Wrong profile' },
      }),
    );
    expect(status()).toBe('Wrong profile');
    act(() =>
      appState.instance?.emit('toolresult', { structuredContent: { bound: false, reason: 42 } }),
    );
    expect(status()).toBe('Wrong profile');
    act(() => appState.instance?.emit('toolresult', { structuredContent: { bound: true } }));
    expect(status()).toContain('This chat is bound');
  });

  it('ignores an old send acknowledgement when a new nonce arrives', async () => {
    const sent = deferred();
    appState.sendResult = sent.promise;
    render(createElement(Panel));
    await emitNonce('old');
    fireEvent.click(bindButton());
    await emitNonce('new');
    await act(async () => sent.resolve({ isError: false }));
    expect(status()).toContain('Ready to bind');
    expect((bindButton() as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('agent-opened automatic binding', () => {
  it('renders the verified initial binding without a message, status call or binding button', async () => {
    render(createElement(Panel));
    await act(async () => {
      appState.instance?.emit('toolresult', {
        structuredContent: { bindingNonce: 'auto', bound: true },
      });
    });
    expect(status()).toContain('This chat is bound');
    expect(screen.queryByRole('button', { name: 'Show this chat’s workflows' })).toBeNull();
    expect(
      screen.queryByText('Bind this panel explicitly to the chat where it is open.'),
    ).toBeNull();
    await tick();
    expect(appState.instance?.reads).toHaveLength(0);
    expect(appState.instance?.sent).toHaveLength(0);
  });

  it.each([
    [{ bound: false, reason: 'Exact context could not be verified' }, false, 'Exact context'],
    [{ bound: false }, false, 'could not be verified'],
    [{ bound: true, reason: 'Host rejected binding' }, true, 'Host rejected'],
  ])(
    'keeps an initial binding rejection terminal and never claims success %j',
    async (result, isError, reason) => {
      render(createElement(Panel));
      await act(async () => {
        appState.instance?.emit('toolresult', {
          isError,
          structuredContent: { bindingNonce: 'rejected-auto', ...result },
        });
      });
      expect(status()).toContain(reason);
      expect((bindButton() as HTMLButtonElement).disabled).toBe(true);
      await tick();
      expect(appState.instance?.reads).toHaveLength(0);
      expect(appState.instance?.sent).toHaveLength(0);
    },
  );

  it('does not let a prior pending message acknowledgement reset a new automatic binding', async () => {
    const sent = deferred();
    appState.sendResult = sent.promise;
    render(createElement(Panel));
    await emitNonce('manual');
    fireEvent.click(bindButton());
    await act(async () => {
      appState.instance?.emit('toolresult', {
        structuredContent: { bindingNonce: 'auto', bound: true },
      });
      sent.resolve({ isError: false });
    });
    expect(status()).toContain('This chat is bound');
    expect(screen.queryByRole('button', { name: 'Show this chat’s workflows' })).toBeNull();
    await tick();
    expect(appState.instance?.reads).toHaveLength(1);
    expect(appState.instance?.sent).toHaveLength(1);
  });
});

it('does not claim an inline error result is bound', async () => {
  render(createElement(Panel));
  await act(async () =>
    appState.instance?.emit('toolresult', {
      isError: true,
      structuredContent: { bound: true, reason: 'Binding rejected' },
    }),
  );
  expect(status()).toBe('Binding rejected');
  expect((bindButton() as HTMLButtonElement).disabled).toBe(true);
});
