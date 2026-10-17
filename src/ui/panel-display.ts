import type { App, McpUiHostContext } from '@modelcontextprotocol/ext-apps';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { PanelState } from './binding.js';

export type PanelDisplayState = 'active' | 'reused' | 'blocked';
type Lease = { key: string; release: () => void };
type PanelLocks = {
  request(name: string, options: LockOptions, callback: LockGrantedCallback<void>): Promise<void>;
};

export class PanelDisplay {
  private connected = false;
  private active = true;
  private nonce = '';
  private key = '';
  private openNonce: string | undefined;
  private attempted: string | undefined;
  private pending: string | undefined;
  private lease: Lease | undefined;
  private wasFullscreen = false;
  private settled = Promise.resolve();
  constructor(
    private readonly app: Pick<App, 'getHostContext' | 'requestDisplayMode' | 'requestTeardown'>,
    private readonly update: (state: PanelDisplayState) => void = () => undefined,
    private readonly locks: PanelLocks | null = globalThis.navigator?.locks ?? null,
  ) {}

  receive(result: Pick<CallToolResult, 'structuredContent' | 'isError'>): void {
    const data = result.structuredContent;
    this.openNonce =
      !result.isError &&
      data?.bound === true &&
      data.openInPanel === true &&
      typeof data.bindingNonce === 'string'
        ? data.bindingNonce
        : undefined;
    this.contextChanged();
  }
  bind(state: Pick<PanelState, 'nonce' | 'bound' | 'panelKey'>): void {
    if (!this.active) return;
    const key = state.bound ? state.panelKey : '';
    if (key !== this.key) {
      this.release();
      this.wasFullscreen = false;
      this.attempted = undefined;
      this.update('active');
    }
    this.key = key;
    this.nonce = state.nonce;
    this.contextChanged();
  }
  ready(): void {
    this.connected = true;
    this.contextChanged();
  }
  contextChanged(): void {
    if (!this.active || !this.connected) return;
    const context = this.app.getHostContext();
    if (this.wasFullscreen && context?.displayMode === 'inline') {
      this.openNonce = undefined;
      this.wasFullscreen = false;
      this.attempted = undefined;
      this.release();
      return;
    }
    if (this.shouldClaim(context)) this.settled = this.claim();
  }
  private shouldClaim(context: Partial<McpUiHostContext> | undefined): boolean {
    return (
      /^[a-f0-9]{64}$/.test(this.key) &&
      this.lease?.key !== this.key &&
      this.pending !== this.key &&
      this.attempted !== this.nonce &&
      this.canDisplay(context)
    );
  }
  private canDisplay(context: Partial<McpUiHostContext> | undefined): boolean {
    if (context?.displayMode === 'fullscreen') {
      this.wasFullscreen = true;
      return true;
    }
    return (
      this.openNonce === this.nonce &&
      Boolean(context?.availableDisplayModes?.includes('fullscreen'))
    );
  }
  private current(key: string): boolean {
    return this.active && this.key === key;
  }
  private async claim(): Promise<void> {
    const key = this.key;
    this.pending = key;
    this.attempted = this.nonce;
    try {
      if (!this.locks) throw new Error('Web Locks are unavailable');
      await this.locks.request(`ultra-panel:${key}`, { ifAvailable: true }, async (lock) => {
        if (this.pending === key) this.pending = undefined;
        if (!this.current(key)) return;
        if (!this.canDisplay(this.app.getHostContext())) {
          this.attempted = undefined;
          return;
        }
        if (!lock) return this.reuse();
        let release: () => void = () => undefined;
        const closed = new Promise<void>((resolve) => (release = resolve));
        const lease = { key, release };
        this.lease = lease;
        this.update('active');
        if (this.app.getHostContext()?.displayMode !== 'fullscreen') void this.open(lease);
        await closed;
        if (this.lease === lease) this.lease = undefined;
      });
    } catch {
      if (this.current(key))
        this.update(this.app.getHostContext()?.displayMode === 'fullscreen' ? 'active' : 'blocked');
    } finally {
      if (this.pending === key) this.pending = undefined;
    }
  }
  private reuse(): void {
    this.update('reused');
    if (this.app.getHostContext()?.displayMode === 'fullscreen')
      void this.app.requestTeardown().catch(() => {
        if (this.active) this.update('blocked');
      });
  }
  private async open(lease: Lease): Promise<void> {
    try {
      const result = await this.app.requestDisplayMode({ mode: 'fullscreen' });
      if (this.lease !== lease) return;
      if (result.mode === 'fullscreen') {
        this.wasFullscreen = true;
        return;
      }
    } catch {
      if (this.lease !== lease) return;
    }
    this.update('blocked');
    this.release();
  }
  private release(): void {
    this.lease?.release();
    this.lease = undefined;
  }
  close(): Promise<void> {
    this.active = false;
    this.release();
    return this.settled;
  }
}
