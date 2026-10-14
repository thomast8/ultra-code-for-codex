// Browser entry for `just qa-panel`: hosts the built panel through the real
// ext-apps AppBridge and answers its tool calls from the labelled QA fixture.
import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge';
import type { McpUiStyles } from '@modelcontextprotocol/ext-apps';
import { qaRuns } from './panel-qa-fixture.js';

// Deliberately loud values make it obvious whether host variables reach the page.
const loudVariables = {
  '--color-text-primary': '#ff2d55',
  '--color-background-secondary': '#102030',
  '--border-radius-lg': '2px',
} as McpUiStyles;

const params = new URLSearchParams(location.search);
const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
const runs = qaRuns(Date.now());
const iframe = document.querySelector('iframe') as HTMLIFrameElement;
iframe.style.width = `${Number(params.get('width')) || 370}px`;

const bridge = new AppBridge(
  null,
  { name: 'Ultra panel QA host (fixture)', version: '0' },
  { serverTools: {} },
  {
    hostContext: {
      theme,
      platform: 'desktop',
      ...(params.has('vars') ? { styles: { variables: loudVariables } } : {}),
    },
  },
);
bridge.oncalltool = async ({ name }) => {
  if (name === 'ultra_status') return { content: [], structuredContent: { runs, cursor: 1 } };
  if (name === 'ultra_panel_status') return { content: [], structuredContent: { state: 'bound' } };
  return { content: [] };
};
bridge.onmessage = async () => ({});
bridge.oninitialized = () => {
  void bridge.sendToolResult({
    content: [],
    structuredContent: { bindingNonce: 'qa', bound: true, capabilityAvailability: 'available' },
  });
};
iframe.addEventListener('load', () => {
  const target = iframe.contentWindow as Window;
  void bridge.connect(new PostMessageTransport(target, target));
});
iframe.src = 'panel.html';
