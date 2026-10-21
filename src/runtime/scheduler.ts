import type { ResourceClaim } from '../contracts/workflow.js';
import { Resources } from './resources.js';
import type { ScheduledWork } from './types.js';

export class Scheduler {
  readonly resources = new Resources();
  private readonly queues = new Map<string, ScheduledWork[]>();
  private readonly active = new Map<Promise<void>, string>();
  private grants = new Map<string, number>();
  private readonly uncertainSlots = new Set<string>();
  private lastRun = '';
  private scheduled = false;
  private stopped = false;
  setGrant(runId: string, capacity: number): void {
    this.grants.set(runId, capacity);
  }
  removeGrant(runId: string): void {
    this.grants.delete(runId);
    this.wake();
  }
  enqueue(work: ScheduledWork): void {
    const queue = this.queues.get(work.runId) ?? [];
    queue.push(work);
    this.queues.set(work.runId, queue);
    this.wake();
  }
  remove(runId: string): void {
    this.queues.delete(runId);
  }
  wake(): void {
    if (this.scheduled || this.stopped) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      this.drain();
    });
  }
  private drain(): void {
    while (!this.stopped && this.active.size + this.uncertainSlots.size < 3) {
      const work = this.next();
      if (!work) break;
      const running = work
        .run()
        .then((certain) => {
          if (certain) this.resources.release(work.id);
          else this.uncertainSlots.add(work.id);
        })
        .catch((error: unknown) => {
          work.invalid(asError(error));
        })
        .finally(() => {
          this.active.delete(running);
          this.wake();
        });
      this.active.set(running, work.runId);
    }
  }
  private next(): ScheduledWork | undefined {
    const ids = [...this.queues.keys()];
    const start = (ids.indexOf(this.lastRun) + 1) % Math.max(ids.length, 1);
    for (let offset = 0; offset < ids.length; offset++) {
      const id = ids[(start + offset) % ids.length]!;
      const queue = this.queues.get(id)!;
      const index = queue.findIndex((work) => this.canStart(work));
      if (index < 0) continue;
      this.lastRun = id;
      return queue.splice(index, 1)[0];
    }
    return undefined;
  }
  private canStart(work: ScheduledWork): boolean {
    if (!work.ready()) return false;
    const runLimit = this.grants.get(work.runId) ?? 3;
    const active = [...this.active.values()].filter((id) => id === work.runId).length;
    const uncertain = [...this.uncertainSlots].filter((id) =>
      id.startsWith(`${work.runId}:`),
    ).length;
    if (active + uncertain >= runLimit) {
      work.waiting();
      return false;
    }
    try {
      const acquired = this.resources.acquire(work.id, work.claims);
      if (!acquired) work.waiting();
      return acquired;
    } catch (error) {
      work.invalid(asError(error));
      return false;
    }
  }
  quarantine(id: string, claims: ResourceClaim[], worker: boolean): void {
    this.resources.quarantine(id, claims);
    if (worker) this.uncertainSlots.add(id);
  }
  resolveQuarantine(id: string): void {
    this.uncertainSlots.delete(id);
    this.resources.release(id);
    this.wake();
  }
  async close(): Promise<void> {
    this.stopped = true;
    await Promise.allSettled(this.active.keys());
  }
}
export function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
