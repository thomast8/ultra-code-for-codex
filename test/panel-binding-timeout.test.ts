import type { App } from '@modelcontextprotocol/ext-apps';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CallToolResultSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { LeadContext } from '../src/activation/types.js';
import { createPanelServer } from '../src/mcp/panel-server.js';
import { initialState, PanelBinding, type PanelState } from '../src/ui/binding.js';

const bindings: PanelBinding[] = [];
const pendingStatus: CallToolResult = { content: [], structuredContent: { state: 'pending' } };

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: Error) => void = () => undefined;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function fixture(read = vi.fn(async () => pendingStatus)) {
  let state: PanelState = { ...initialState };
  const app = { callServerTool: read, sendMessage: vi.fn(async () => ({ isError: false })) };
  const binding = new PanelBinding(app as unknown as App, (next) => {
    state = next;
  });
  bindings.push(binding);
  binding.receive({ structuredContent: { bindingNonce: 'queued-nonce' } });
  return { binding, app, state: () => state };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  bindings.splice(0).forEach((binding) => binding.close());
  vi.useRealTimers();
});

it.each(['pending', 'bound', 'rejection'])(
  'ignores a late %s read after timeout and reads again only on explicit retry',
  async (outcome) => {
    const late = deferred<CallToolResult>();
    const read = vi.fn(async () => pendingStatus).mockReturnValueOnce(late.promise);
    const { binding, app, state } = fixture(read);
    await binding.send();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(state()).toMatchObject({ request: 'queued', retry: true, bound: false });
    if (outcome === 'rejection') late.reject(new Error('Late transport failure'));
    else late.resolve({ content: [], structuredContent: { state: outcome } });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(state().status).toContain('still queued after one minute');
    expect(read).toHaveBeenCalledTimes(1);
    binding.retry();
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(2);
    expect(state()).toMatchObject({ request: 'queued', retry: false, bound: false });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(state().retry).toBe(true);
    expect(app.sendMessage).toHaveBeenCalledTimes(1);
  },
);

it('serializes an explicit retry behind a timed-out read without accepting its stale result', async () => {
  const late = deferred<CallToolResult>();
  const read = vi.fn(async () => pendingStatus).mockReturnValueOnce(late.promise);
  const { binding, state } = fixture(read);
  await binding.send();
  await vi.advanceTimersByTimeAsync(60_000);
  binding.retry();
  expect(read).toHaveBeenCalledTimes(1);
  late.resolve({ content: [], structuredContent: { state: 'bound' } });
  await vi.advanceTimersByTimeAsync(0);
  expect(read).toHaveBeenCalledTimes(2);
  expect(state()).toMatchObject({ request: 'queued', retry: false, bound: false });
});

it('starts the minute when the deferred host acknowledgement arrives', async () => {
  const acknowledged = deferred<{ isError: boolean }>();
  const { binding, app, state } = fixture();
  app.sendMessage.mockReturnValueOnce(acknowledged.promise);
  const sent = binding.send();
  await vi.advanceTimersByTimeAsync(90_000);
  expect(state()).toMatchObject({ request: 'sending', retry: false });
  acknowledged.resolve({ isError: false });
  await sent;
  await vi.advanceTimersByTimeAsync(59_999);
  expect(state()).toMatchObject({ request: 'queued', retry: false });
  await vi.advanceTimersByTimeAsync(1);
  expect(state().retry).toBe(true);
});

it.each(['new nonce', 'automatic binding', 'close'])(
  'cancels an old queued deadline on %s',
  async (action) => {
    const { binding, state } = fixture();
    await binding.send();
    await vi.advanceTimersByTimeAsync(30_000);
    if (action === 'close') binding.close();
    else
      binding.receive({
        structuredContent: {
          bindingNonce: 'replacement',
          ...(action === 'automatic binding' ? { bound: true } : {}),
        },
      });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(state().retry).toBe(false);
    expect(state().status).not.toContain('one minute');
  },
);

it('keeps an explicit read failure visible instead of replacing it with the queued deadline', async () => {
  const read = vi.fn(async () => pendingStatus);
  const { binding, state } = fixture(read);
  await binding.send();
  read.mockRejectedValueOnce(new Error('Connection unavailable'));
  await vi.advanceTimersByTimeAsync(1_000);
  const failure = state().status;
  await vi.advanceTimersByTimeAsync(60_000);
  expect(state().status).toBe(failure);
  expect(read).toHaveBeenCalledTimes(2);
});

it('allows an idle status retry without sending a chat message or starting a queued deadline', async () => {
  const read = vi.fn(async () => pendingStatus).mockRejectedValueOnce(new Error('Offline'));
  const { binding, app, state } = fixture(read);
  await vi.advanceTimersByTimeAsync(0);
  binding.retry();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(state()).toMatchObject({ request: 'idle', retry: false });
  expect(app.sendMessage).not.toHaveBeenCalled();
});

it('recovers through the actual MCP binding status protocol after the queued window expires', async () => {
  const context: LeadContext = {
    instanceId: '/codex',
    sessionId: 'timeout-session',
    turnId: 'timeout-turn',
    cwd: '/repo',
    model: 'gpt-6',
    effort: 'high',
    collaborationMode: 'default',
    resolutionStatus: 'verified',
    resolutionReason: '',
  };
  const dataDir = await mkdtemp(join(tmpdir(), 'ultra-binding-timeout-'));
  const server = createPanelServer(
    async () => context,
    dataDir,
    async () => '<main>Panel</main>',
  );
  const client = new Client({ name: 'binding-timeout-qa', version: '1.0.0' });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const opened = await client.callTool({ name: 'ultra_panel', arguments: {} });
    const read = vi.fn(async (request: Parameters<App['callServerTool']>[0]) =>
      CallToolResultSchema.parse(await client.callTool(request)),
    );
    const sendMessage = vi.fn(async () => ({ isError: false }));
    let state = { ...initialState };
    const binding = new PanelBinding(
      { callServerTool: read, sendMessage } as unknown as App,
      (next) => {
        state = next;
      },
    );
    bindings.push(binding);
    binding.receive(CallToolResultSchema.parse(opened));
    await binding.send();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(state).toMatchObject({ request: 'queued', retry: true, bound: false });
    const reads = read.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(read).toHaveBeenCalledTimes(reads);
    await client.callTool({
      name: 'ultra_panel_bind',
      arguments: { nonce: state.nonce, contextKey: 'verified-timeout' },
    });
    binding.retry();
    await vi.advanceTimersByTimeAsync(0);
    expect(state).toMatchObject({ bound: true, terminal: true, retry: false });
    expect(sendMessage).toHaveBeenCalledTimes(1);
  } finally {
    await Promise.all([client.close(), server.close()]);
  }
});
