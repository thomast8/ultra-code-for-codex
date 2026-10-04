// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const appState = vi.hoisted(() => {
  class MockApp {
    private handlers = new Map<string, (payload: unknown) => void>();
    readonly sent: unknown[] = [];
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
      return undefined;
    }
    async sendMessage(message: unknown) {
      this.sent.push(message);
      if (appState.sendError) throw new Error('Host message failed');
      return appState.sendResult;
    }
    close() {
      return undefined;
    }
  }
  return {
    instance: undefined as InstanceType<typeof MockApp> | undefined,
    sendResult: { isError: false },
    sendError: false,
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

afterEach(cleanup);
beforeEach(() => {
  appState.instance = undefined;
  appState.sendResult = { isError: false };
  appState.sendError = false;
  appState.connectError = false;
});

describe('Ultra Code panel UI', () => {
  it('sends the nonce only after the user chooses the explicit chat binding action', async () => {
    render(createElement(Panel));
    expect(
      screen.getByText(
        'Compatibility probe; workflow execution is unavailable until the Desktop gate passes.',
      ),
    ).toBeDefined();
    act(() =>
      appState.instance?.emit('toolresult', { structuredContent: { bindingNonce: 'opaque-once' } }),
    );
    expect(screen.getByRole('status').textContent).toContain('Ready to bind');
    fireEvent.click(screen.getByRole('button', { name: 'Show this chat’s workflows' }));
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain('Binding request sent'),
    );
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
    act(() => appState.instance?.emit('toolresult', { structuredContent: { bound: true } }));
    expect(screen.getByRole('status').textContent).toContain('This chat is bound');
  });

  it('shows a host rejection when follow-up messages are rejected', async () => {
    appState.sendResult = { isError: true };
    render(createElement(Panel));
    act(() =>
      appState.instance?.emit('toolresult', { structuredContent: { bindingNonce: 'opaque-once' } }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Show this chat’s workflows' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('host rejected'));
  });
});

describe('host failures and malformed panel results', () => {
  it('keeps the button disabled before a usable nonce arrives', () => {
    render(createElement(Panel));
    act(() => appState.instance?.emit('toolresult', {}));
    const button = screen.getByRole('button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toContain('Open the panel tool');
  });

  it('reports failed host connection without claiming a binding', async () => {
    appState.connectError = true;
    render(createElement(Panel));
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain('does not support'),
    );
  });

  it('reports failed message delivery and the actual binding rejection', async () => {
    appState.sendError = true;
    render(createElement(Panel));
    act(() =>
      appState.instance?.emit('toolresult', { structuredContent: { bindingNonce: 'once' } }),
    );
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Could not send'));
    act(() =>
      appState.instance?.emit('toolresult', {
        structuredContent: { bound: false, reason: 'Wrong profile' },
      }),
    );
    expect(screen.getByRole('status').textContent).toBe('Wrong profile');
    act(() =>
      appState.instance?.emit('toolresult', { structuredContent: { bound: false, reason: 42 } }),
    );
    expect(screen.getByRole('status').textContent).toBe('Wrong profile');
  });
});
