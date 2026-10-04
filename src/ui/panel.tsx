import { createElement, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App, PostMessageTransport } from '@modelcontextprotocol/ext-apps';

export function Panel() {
  const [app] = useState(() => new App({ name: 'Ultra Code', version: '0.1.0' }));
  const [nonce, setNonce] = useState('');
  const [status, setStatus] = useState('Open the panel tool to prepare a chat binding.');
  useEffect(() => {
    app.addEventListener('toolresult', (result) => {
      const bindingNonce = result.structuredContent?.bindingNonce;
      if (typeof bindingNonce === 'string') {
        setNonce(bindingNonce);
        setStatus('Ready to bind this panel to the current chat.');
      } else if (result.structuredContent?.bound === true) {
        setStatus('This chat is bound to the Ultra Code panel.');
      } else if (
        result.structuredContent?.bound === false &&
        typeof result.structuredContent.reason === 'string'
      ) {
        setStatus(result.structuredContent.reason);
      }
    });
    void app.connect(new PostMessageTransport(window.parent, window.parent)).catch(() => {
      setStatus('The host does not support the Ultra Code panel connection.');
    });
    return () => {
      void app.close();
    };
  }, [app]);

  async function bindChat() {
    if (!nonce) return;
    try {
      const result = await app.sendMessage({
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Bind Ultra Code panel nonce ${nonce} to this chat using ultra_panel_bind and the current verified context handle.`,
          },
        ],
      });
      setStatus(
        result.isError
          ? 'The host rejected the binding request.'
          : 'Binding request sent. Wait for the verified chat binding.',
      );
    } catch {
      setStatus('Could not send the binding request to this chat.');
    }
  }

  return createElement(
    'main',
    null,
    createElement('h1', null, 'Ultra Code'),
    createElement(
      'p',
      null,
      'Compatibility probe; workflow execution is unavailable until the Desktop gate passes.',
    ),
    createElement('p', null, 'Bind this panel explicitly to the chat where it is open.'),
    createElement(
      'button',
      { type: 'button', disabled: !nonce, onClick: () => void bindChat() },
      'Show this chat’s workflows',
    ),
    createElement('p', { role: 'status', 'aria-live': 'polite' }, status),
  );
}

const root = document.getElementById('root');
if (root) createRoot(root).render(createElement(Panel));
