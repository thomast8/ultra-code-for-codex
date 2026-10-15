import type { App } from '@modelcontextprotocol/ext-apps';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { RunSnapshot } from '../contracts/workflow.js';
import { workflowSnapshot } from './snapshots.js';

export type RunAction = 'pause' | 'resume' | 'cancel';
export type DashboardState = {
  runs: RunSnapshot[];
  cursor: number;
  loading: boolean;
  error: string | null;
  busyRuns: string[];
  controlErrors: Record<string, string>;
};
export const emptyDashboard: DashboardState = {
  runs: [],
  cursor: 0,
  loading: true,
  error: null,
  busyRuns: [],
  controlErrors: {},
};

function toolError(result: CallToolResult, fallback: string): string {
  if (typeof result.structuredContent?.reason === 'string') return result.structuredContent.reason;
  const messages = (result.content ?? []).flatMap((content) =>
    content.type === 'text' ? [content.text] : [],
  );
  return messages.join('\n').trim() || fallback;
}

export class WorkflowFeed {
  private state = { ...emptyDashboard };
  private nonce = '';
  private generation = 0;
  private revision = 0;
  private active = true;
  private checking = false;
  private readPending = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private app: Pick<App, 'callServerTool'>,
    private update: (state: DashboardState) => void,
  ) {}

  bind(nonce: string): void {
    if (!this.active || nonce === this.nonce) return;
    this.generation += 1;
    this.nonce = nonce;
    clearTimeout(this.timer);
    this.state = { ...emptyDashboard };
    this.publish({});
    this.refresh();
  }

  close(): void {
    this.active = false;
    this.generation += 1;
    this.readPending = false;
    clearTimeout(this.timer);
  }

  refresh(): void {
    if (!this.active || !this.nonce) return;
    clearTimeout(this.timer);
    this.readPending = true;
    void this.read();
  }

  async control(runId: string, action: RunAction): Promise<void> {
    if (!this.active || !this.nonce || this.state.busyRuns.includes(runId)) return;
    const generation = this.generation;
    this.publish({
      busyRuns: [...this.state.busyRuns, runId],
      controlErrors: { ...this.state.controlErrors, [runId]: '' },
    });
    try {
      const result = await this.app.callServerTool({
        name: 'ultra_panel_control',
        arguments: { nonce: this.nonce, runId, action },
      });
      if (!this.current(generation)) return;
      if (result.isError) throw new Error(toolError(result, 'The workflow control was rejected.'));
      this.revision += 1;
      this.refresh();
    } catch (error) {
      if (this.current(generation))
        this.publish({
          controlErrors: {
            ...this.state.controlErrors,
            [runId]: error instanceof Error ? error.message : 'Could not control this workflow.',
          },
        });
    } finally {
      if (this.current(generation))
        this.publish({ busyRuns: this.state.busyRuns.filter((id) => id !== runId) });
    }
  }

  private current(generation: number): boolean {
    return this.active && generation === this.generation;
  }

  private publish(change: Partial<DashboardState>): void {
    if (!this.active) return;
    this.state = { ...this.state, ...change };
    this.update(this.state);
  }

  private accept(result: CallToolResult): void {
    if (result.isError) throw new Error(toolError(result, 'Workflow status is unavailable.'));
    const parsed = workflowSnapshot.safeParse(result.structuredContent);
    if (!parsed.success) throw new Error('The host returned an invalid workflow snapshot.');
    if (parsed.data.cursor < this.state.cursor) return;
    this.publish({ ...parsed.data, loading: false, error: null });
  }

  private schedule(): void {
    if (!this.active) return;
    if (this.readPending) void this.read();
    else if (!this.state.error) this.timer = setTimeout(() => this.refresh(), 1000);
  }

  private async read(): Promise<void> {
    if (!this.active || this.checking || !this.readPending) return;
    this.checking = true;
    this.readPending = false;
    const generation = this.generation;
    const revision = this.revision;
    try {
      const result = await this.app.callServerTool({
        name: 'ultra_status',
        arguments: { nonce: this.nonce },
      });
      if (this.current(generation) && revision === this.revision) this.accept(result);
    } catch (error) {
      if (this.current(generation) && revision === this.revision)
        this.publish({
          loading: false,
          error: error instanceof Error ? error.message : 'Could not read workflow status.',
        });
    } finally {
      this.checking = false;
      this.schedule();
    }
  }
}
