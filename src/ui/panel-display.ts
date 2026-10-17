import type { App } from '@modelcontextprotocol/ext-apps';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export class PanelDisplay {
  private connected = false;
  private active = true;
  private nonce: string | undefined;
  private requested: string | undefined;
  constructor(private readonly app: Pick<App, 'getHostContext' | 'requestDisplayMode'>) {}

  receive(result: Pick<CallToolResult, 'structuredContent' | 'isError'>): void {
    const data = result.structuredContent;
    this.nonce =
      !result.isError &&
      data?.bound === true &&
      data.openInPanel === true &&
      typeof data.bindingNonce === 'string'
        ? data.bindingNonce
        : undefined;
    this.contextChanged();
  }
  ready(): void {
    this.connected = true;
    this.contextChanged();
  }
  contextChanged(): void {
    if (!this.active || !this.connected || !this.nonce || this.requested === this.nonce) return;
    const context = this.app.getHostContext();
    if (context?.displayMode === 'fullscreen') {
      this.requested = this.nonce;
      return;
    }
    if (!context?.availableDisplayModes?.includes('fullscreen')) return;
    this.requested = this.nonce;
    void this.app.requestDisplayMode({ mode: 'fullscreen' }).catch(() => undefined);
  }
  close(): void {
    this.active = false;
  }
}
