import { createElement, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App, PostMessageTransport } from '@modelcontextprotocol/ext-apps';
import { initialState, PanelBinding } from './binding.js';

export function Panel() {
  const [app] = useState(() => new App({ name: 'Ultra Code', version: '0.1.4' }));
  const [state, setState] = useState(initialState);
  const [binding] = useState(() => new PanelBinding(app, setState));
  useEffect(() => {
    app.addEventListener('toolresult', (result) => binding.receive(result));
    void app.connect(new PostMessageTransport(window.parent, window.parent)).catch(() => {
      binding.connectionFailed();
    });
    return () => {
      binding.close();
      void app.close();
    };
  }, [app, binding]);

  return createElement(
    'main',
    null,
    createElement('h1', null, 'Ultra Code'),
    createElement(
      'p',
      null,
      'Compatibility probe; workflow execution is unavailable until the Desktop gate passes.',
    ),
    !state.bound &&
      createElement('p', null, 'Bind this panel explicitly to the chat where it is open.'),
    !state.bound &&
      createElement(
        'button',
        {
          type: 'button',
          disabled: !state.nonce || state.request !== 'idle' || state.terminal || state.retry,
          onClick: () => void binding.send(),
        },
        'Show this chat’s workflows',
      ),
    state.retry &&
      createElement(
        'button',
        { type: 'button', onClick: () => binding.retry() },
        'Retry binding status',
      ),
    createElement('p', { role: 'status', 'aria-live': 'polite' }, state.status),
  );
}

const root = document.getElementById('root');
if (root) createRoot(root).render(createElement(Panel));
