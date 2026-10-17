import { createElement, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  App,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
  PostMessageTransport,
  type McpUiHostContext,
} from '@modelcontextprotocol/ext-apps';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import packageMetadata from '../../package.json' with { type: 'json' };
import { initialState, PanelBinding, type PanelState } from './binding.js';
import { Dashboard } from './dashboard.js';
import { panelStyles } from './styles.js';
import { Brand } from './icons.js';
import { PanelDisplay, type PanelDisplayState } from './panel-display.js';

type Availability = {
  nonce: string;
  value: 'available' | 'unavailable' | 'unknown';
  reason: string | null;
};
const unknownAvailability: Availability = { nonce: '', value: 'unknown', reason: null };

function readAvailability(
  result: Pick<CallToolResult, 'structuredContent'>,
  previous: Availability,
): Availability {
  const data = result.structuredContent;
  if (typeof data?.bindingNonce !== 'string' || !data.bindingNonce) return previous;
  if (
    data.capabilityAvailability !== 'available' &&
    data.capabilityAvailability !== 'unavailable'
  ) {
    return data.bindingNonce === previous.nonce
      ? previous
      : { ...unknownAvailability, nonce: data.bindingNonce };
  }
  return {
    nonce: data.bindingNonce,
    value: data.capabilityAvailability,
    reason: typeof data.capabilityReason === 'string' ? data.capabilityReason : null,
  };
}

export function applyHostContext(context: Partial<McpUiHostContext> | undefined) {
  if (context?.theme) applyDocumentTheme(context.theme);
  if (context?.styles?.variables) applyHostStyleVariables(context.styles.variables);
  if (context?.styles?.css?.fonts) applyHostFonts(context.styles.css.fonts);
}

export function Panel() {
  const [app] = useState(() => new App({ name: 'Ultra Code', version: packageMetadata.version }));
  const [state, setState] = useState(initialState);
  const [availability, setAvailability] = useState(unknownAvailability);
  const [displayState, setDisplayState] = useState<PanelDisplayState>('active');
  const [display] = useState(() => new PanelDisplay(app, setDisplayState));
  const [binding] = useState(() => new PanelBinding(app, setState));
  useEffect(() => display.bind(state), [display, state]);
  useEffect(() => {
    app.addEventListener('toolresult', (result) => {
      binding.receive(result);
      setAvailability((previous) => readAvailability(result, previous));
      display.receive(result);
    });
    app.onhostcontextchanged = (context) => {
      applyHostContext(context);
      display.contextChanged();
    };
    void app.connect(new PostMessageTransport(window.parent, window.parent)).then(
      () => {
        applyHostContext(app.getHostContext());
        display.ready();
      },
      () => binding.connectionFailed(),
    );
    return () => {
      binding.close();
      display.close();
      void app.close();
    };
  }, [app, binding, display]);

  const capability = availability.nonce === state.nonce ? availability : unknownAvailability;
  return (
    <main className="ultra-panel">
      <style>{panelStyles}</style>
      {(!state.bound || capability.value === 'unknown') && (
        <header className="ultra-header">
          <h1>
            <Brand />
          </h1>
        </header>
      )}
      {!state.bound && capability.value === 'unknown' && (
        <p>Compatibility probe: waiting for workflow availability.</p>
      )}
      <BindingControls state={state} binding={binding} />
      <p
        role="status"
        aria-live="polite"
        className={state.bound ? 'visually-hidden' : 'binding-status'}
      >
        {state.status}
      </p>
      {displayState === 'reused' ? (
        <p role="status">Using the Ultra panel already open in this chat.</p>
      ) : displayState === 'blocked' ? (
        <p role="alert">This host could not safely open another Ultra panel.</p>
      ) : (
        <CapabilityView state={state} capability={capability} app={app} />
      )}
    </main>
  );
}

function BindingControls({ state, binding }: { state: PanelState; binding: PanelBinding }) {
  if (state.bound) return null;
  return (
    <>
      <p>Bind this panel explicitly to the chat where it is open.</p>
      <button
        type="button"
        disabled={!state.nonce || state.request !== 'idle' || state.terminal || state.retry}
        onClick={() => void binding.send()}
      >
        Show this chat’s workflows
      </button>
      {state.retry && (
        <button type="button" onClick={() => binding.retry()}>
          Retry binding status
        </button>
      )}
    </>
  );
}

function CapabilityView({
  state,
  capability,
  app,
}: {
  state: PanelState;
  capability: Availability;
  app: App;
}) {
  if (capability.value === 'unavailable' && !state.bound)
    return <p role="alert">{capability.reason ?? 'Workflow execution is unavailable.'}</p>;
  if (!state.bound) return null;
  if (capability.value === 'unknown') return <p>Workflow availability has not been reported.</p>;
  if (!state.nonce) return null;
  // A bound panel reads current status rather than retaining a stale startup failure.
  return <Dashboard app={app} nonce={state.nonce} />;
}

const root = document.getElementById('root');
if (root) createRoot(root).render(createElement(Panel));
