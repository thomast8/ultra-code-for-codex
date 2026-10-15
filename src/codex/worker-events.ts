import type { TaskResult, TokenUsage, WorkerOptions } from '../contracts/workflow.js';
import type { ServerNotification } from './generated/ServerNotification.js';
import type { ThreadItem } from './generated/v2/ThreadItem.js';
import type { TokenUsageBreakdown } from './generated/v2/TokenUsageBreakdown.js';
import type { Turn } from './generated/v2/Turn.js';
import { requireWorker } from './worker-protocol.js';

export class WorkerTurnEvents {
  turnId: string | null = null;
  completed: Turn | null = null;
  output: string | null = null;
  usage: TokenUsage | null = null;
  reportedModel: string;
  stopReason: string | null = null;
  readonly wakeup: Promise<void>;
  readonly completion: Promise<void>;
  private wake!: () => void;
  private finish!: () => void;
  private queue = Promise.resolve();
  private activityCount = 0;
  private active = true;

  constructor(
    readonly threadId: string,
    model: string,
    private readonly options: WorkerOptions,
  ) {
    this.reportedModel = model;
    this.wakeup = new Promise((resolve) => {
      this.wake = resolve;
    });
    this.completion = new Promise((resolve) => {
      this.finish = resolve;
    });
  }

  receive(notification: ServerNotification): Promise<void> {
    this.queue = this.queue
      .then(() => this.handle(notification))
      .catch(() => this.stop('Worker event recording or validation failed'));
    return this.queue;
  }

  stop(reason: string): void {
    if (this.stopReason === null) this.stopReason = reason;
    this.wake();
  }

  recordTurnResponse(turn: Turn): Promise<void> {
    this.queue = this.queue
      .then(() => this.observeTurn(turn))
      .catch(() => this.stop('Worker turn recording or validation failed'));
    return this.queue;
  }

  private async observeTurn(turn: Turn): Promise<void> {
    requireWorker(
      typeof turn.id === 'string' && turn.id.length > 0,
      'Worker turn identity is unavailable',
    );
    if (this.turnId !== null)
      requireWorker(this.turnId === turn.id, 'Worker received an unexpected turn identity');
    else {
      this.turnId = turn.id;
      await this.options.onEvent({ type: 'turn', threadId: this.threadId, turnId: turn.id });
    }
    if (turn.status !== 'inProgress') await this.complete(turn);
  }

  async drain(): Promise<void> {
    await this.queue;
  }
  dispose(): void {
    this.active = false;
  }

  private async complete(turn: Turn): Promise<void> {
    requireWorker(
      ['completed', 'failed', 'interrupted'].includes(turn.status),
      'Worker terminal status is unknown',
    );
    for (const item of turn.items) this.captureOutput(item);
    this.completed = turn;
    this.finish();
    this.wake();
  }

  private async handle(notification: ServerNotification): Promise<void> {
    if (!this.active) return;
    const params = notification.params;
    if (!('threadId' in params) || params.threadId !== this.threadId) return;
    if ('turnId' in params && this.turnId !== null && params.turnId !== this.turnId) return;
    await this.handleOwned(notification);
  }

  private async handleOwned(notification: ServerNotification): Promise<void> {
    switch (notification.method) {
      case 'turn/started':
      case 'turn/completed':
        await this.observeTurn(notification.params.turn);
        break;
      case 'thread/tokenUsage/updated':
        await this.recordUsage(notification.params.tokenUsage.total);
        break;
      case 'model/rerouted':
        this.reportedModel = notification.params.toModel;
        this.stop('Worker model was rerouted');
        break;
      case 'item/started':
      case 'item/completed':
        await this.recordItem(notification.params.item, notification.method);
        break;
      case 'error':
        await this.activity('Worker backend reported a turn error');
        break;
    }
  }

  private async recordUsage(total: TokenUsageBreakdown): Promise<void> {
    const usage = {
      inputTokens: total.inputTokens,
      cachedInputTokens: total.cachedInputTokens,
      cacheWriteInputTokens: total.cacheWriteInputTokens,
      outputTokens: total.outputTokens,
      reasoningOutputTokens: total.reasoningOutputTokens,
      totalTokens: total.totalTokens,
    };
    requireWorker(
      Object.values(usage).every((value) => Number.isSafeInteger(value) && value >= 0),
      'Worker token usage is invalid',
    );
    if (this.usage && usage.totalTokens < this.usage.totalTokens) return;
    this.usage = usage;
    await this.options.onEvent({ type: 'usage', usage });
  }

  private captureOutput(item: ThreadItem): void {
    if (item.type === 'agentMessage' && item.phase === 'final_answer') {
      requireWorker(Buffer.byteLength(item.text) <= 262_144, 'Worker output exceeds the bound');
      this.output = item.text;
    }
  }

  private async recordItem(item: ThreadItem, method: string): Promise<void> {
    if (method === 'item/completed') this.captureOutput(item);
    if (item.type === 'commandExecution') {
      await this.recordCommand(item, method);
    } else if (item.type === 'fileChange') {
      requireWorker(
        ['inProgress', 'completed', 'failed', 'declined'].includes(item.status),
        'Worker file change status is unknown',
      );
      await this.activity(`File change ${item.status}; paths=${item.changes.length}`);
    } else if (item.type === 'agentMessage' && method === 'item/completed')
      await this.activity(`Worker message completed; bytes=${Buffer.byteLength(item.text)}`);
  }

  private async recordCommand(
    item: Extract<ThreadItem, { type: 'commandExecution' }>,
    method: string,
  ): Promise<void> {
    requireWorker(
      ['inProgress', 'completed', 'failed', 'declined'].includes(item.status),
      'Worker command status is unknown',
    );
    requireWorker(
      item.exitCode === null || Number.isSafeInteger(item.exitCode),
      'Worker command exit status is invalid',
    );
    const outputBytes = Buffer.byteLength(item.aggregatedOutput ?? '');
    const denied = /operation not permitted|permission denied|read-only file system/i.test(
      item.aggregatedOutput ?? '',
    );
    await this.activity(
      `Command ${method === 'item/started' ? 'started' : 'completed'}; status=${item.status}; exit=${item.exitCode ?? 'pending'}; outputBytes=${outputBytes}; denied=${denied}`,
    );
  }

  private async activity(message: string): Promise<void> {
    if (this.activityCount >= 200) return;
    this.activityCount += 1;
    await this.options.onEvent({ type: 'activity', message: message.slice(0, 512) });
  }

  failureResult(requestedModel: string): TaskResult {
    return {
      execution:
        this.completed === null
          ? 'uncertain'
          : this.completed.status === 'interrupted'
            ? 'interrupted'
            : 'failed',
      acceptance: 'unverified',
      value: null,
      evidence: [],
      unresolved: [this.stopReason ?? 'Worker termination was not confirmed'],
      usage: this.usage,
      requestedModel,
      reportedModel: this.reportedModel,
      error: this.stopReason ?? 'Worker termination was not confirmed',
    };
  }
}
