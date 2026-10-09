import type { App } from '@modelcontextprotocol/ext-apps';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export type PanelState = {
  nonce: string;
  status: string;
  request: 'idle' | 'sending' | 'queued';
  terminal: boolean;
  bound: boolean;
  retry: boolean;
};

export const initialState: PanelState = {
  nonce: '',
  status: 'Open the panel tool to prepare a chat binding.',
  request: 'idle',
  terminal: false,
  bound: false,
  retry: false,
};

export class PanelBinding {
  private state = { ...initialState };
  private generation = 0;
  private active = true;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private checking = false;
  private readPending = false;

  constructor(
    private app: App,
    private update: (state: PanelState) => void,
  ) {}

  receive(result: Pick<CallToolResult, 'structuredContent' | 'isError'>) {
    const data = result.structuredContent;
    if (typeof data?.bindingNonce === 'string' && data.bindingNonce) {
      this.prepare(data.bindingNonce, data, result.isError);
      return;
    }
    if (!this.state.nonce) this.receiveInline(result);
  }

  private receiveInline(result: Pick<CallToolResult, 'structuredContent' | 'isError'>) {
    const data = result.structuredContent;
    if (result.isError) {
      this.initialBinding(data ?? {}, true);
      return;
    }
    if (data?.bound === true) {
      this.finish('This chat is bound to the Ultra Code panel.', true);
    } else if (data?.bound === false && typeof data.reason === 'string') {
      this.finish(data.reason);
    }
  }

  connectionFailed() {
    this.finish('The host does not support the Ultra Code panel connection.');
  }

  close() {
    this.active = false;
    this.generation += 1;
    this.stopPolling();
  }

  retry() {
    if (!this.active || this.state.terminal) return;
    this.publish({ retry: false, status: 'Checking this panel’s binding status.' });
    this.readPending = true;
    void this.check();
  }

  async send() {
    if (
      !this.state.nonce ||
      this.state.request !== 'idle' ||
      this.state.terminal ||
      this.state.retry
    )
      return;
    const generation = this.generation;
    this.publish({ request: 'sending', status: 'Submitting the binding request to this chat.' });
    try {
      const result = await this.app.sendMessage({
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Bind Ultra Code panel nonce ${this.state.nonce} to this chat using ultra_panel_bind and the current verified context handle.`,
          },
        ],
      });
      if (!this.current(generation)) return;
      this.publish(
        result.isError
          ? { request: 'idle', status: 'The host rejected the binding request. You can retry.' }
          : {
              request: 'queued',
              status: 'Binding request queued. Waiting for this chat to process it.',
            },
      );
    } catch {
      if (this.current(generation))
        this.publish({
          request: 'idle',
          status: 'Could not send the binding request. You can retry.',
        });
    }
  }

  private prepare(nonce: string, data: Record<string, unknown>, failed?: boolean) {
    if (nonce === this.state.nonce) return;
    this.generation += 1;
    this.stopPolling();
    this.state = { ...initialState, nonce };
    if (this.initialBinding(data, failed)) return;
    this.publish({ status: 'Ready to bind this panel to the current chat.' });
    this.readPending = true;
    void this.check();
  }

  private initialBinding(data: Record<string, unknown>, failed?: boolean) {
    if (failed || data.bound === false) {
      this.finish(
        typeof data.reason === 'string'
          ? data.reason
          : 'This panel’s binding could not be verified. Open a fresh panel to try again.',
      );
      return true;
    }
    if (data.bound === true) {
      this.finish('This chat is bound to the Ultra Code panel.', true);
      return true;
    }
    return false;
  }

  private publish(change: Partial<PanelState>) {
    if (!this.active) return;
    this.state = { ...this.state, ...change };
    this.update(this.state);
  }

  private current(generation: number) {
    return this.active && generation === this.generation && !this.state.terminal;
  }

  private stopPolling() {
    clearTimeout(this.timer);
    this.readPending = false;
  }

  private finish(status: string, bound = false) {
    this.stopPolling();
    this.publish({ status, terminal: true, bound, retry: false });
  }

  private readFailure(status: string) {
    this.publish({ status, retry: true });
  }

  private acceptStatus(result: CallToolResult) {
    const data = result.structuredContent;
    if (result.isError) {
      const reason =
        typeof data?.reason === 'string'
          ? data.reason
          : 'Could not read this panel’s binding status.';
      this.readFailure(reason);
      return;
    }
    switch (data?.state) {
      case 'bound':
        this.finish('This chat is bound to the Ultra Code panel.', true);
        break;
      case 'failed':
        this.finish('This panel’s binding failed. Open a fresh panel to try again.');
        break;
      case 'pending':
      case 'binding':
        this.awaitStatus(data.state);
        break;
      default:
        this.readFailure('The host returned an invalid binding status. Retry the status check.');
    }
  }

  private awaitStatus(state: 'pending' | 'binding') {
    if (state === 'binding') {
      this.publish({ status: 'This chat is processing the binding request.', retry: false });
    } else if (this.state.status === 'Checking this panel’s binding status.') {
      this.publish({
        status:
          this.state.request === 'idle'
            ? 'Ready to bind this panel to the current chat.'
            : this.state.request === 'sending'
              ? 'Submitting the binding request to this chat.'
              : 'Binding request queued. Waiting for this chat to process it.',
        retry: false,
      });
    }
    this.timer = setTimeout(() => {
      this.readPending = true;
      void this.check();
    }, 1000);
  }

  private async check() {
    if (this.checking || !this.readPending || !this.active) return;
    this.checking = true;
    this.readPending = false;
    const generation = this.generation;
    try {
      const result = await this.app.callServerTool({
        name: 'ultra_panel_status',
        arguments: { nonce: this.state.nonce },
      });
      if (this.current(generation)) this.acceptStatus(result);
    } catch {
      if (this.current(generation))
        this.readFailure('Could not read this panel’s binding status. Retry the status check.');
    } finally {
      this.checking = false;
      if (this.readPending && this.active) void this.check();
    }
  }
}
