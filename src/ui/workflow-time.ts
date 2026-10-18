import type { RunSnapshot, TaskSnapshot } from '../contracts/workflow.js';

export function elapsed(start: number, end: number): string {
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function taskElapsed(task: TaskSnapshot, now: number): string {
  if (task.startedAt === null) return 'Not started';
  if (['completed', 'cancelled', 'failed'].includes(task.state) && task.finishedAt === null)
    return 'Elapsed unknown';
  return elapsed(task.startedAt, task.finishedAt ?? now);
}

type Interval = [number, number];

function duration(intervals: Interval[], start: number, end: number): number {
  const ordered = intervals
    .map(([a, b]): Interval => [Math.max(start, a), Math.min(end, b)])
    .filter(([a, b]) => b > a)
    .sort(([a], [b]) => a - b);
  let coveredUntil = start;
  let total = 0;
  for (const [a, b] of ordered) {
    total += Math.max(0, b - Math.max(a, coveredUntil));
    coveredUntil = Math.max(coveredUntil, b);
  }
  return total;
}

export function runTiming(run: RunSnapshot, now: number) {
  if (['completed', 'failed', 'cancelled'].includes(run.state) && run.finishedAt === null)
    return { workers: null, review: null, waiting: null };
  const end = run.finishedAt ?? now;
  const workers: Interval[] = run.tasks.flatMap((task) =>
    task.startedAt === null ? [] : [[task.startedAt, task.finishedAt ?? end]],
  );
  const reviews: Interval[] = (run.leadReviews ?? []).map((review) => [
    review.startedAt,
    review.finishedAt ?? end,
  ]);
  const unknown = run.tasks.some(
    (task) =>
      task.startedAt !== null &&
      task.finishedAt === null &&
      ['completed', 'failed', 'cancelled', 'needs_reconciliation'].includes(task.state),
  );
  const leadKnown = run.leadReviews !== undefined;
  return {
    workers: unknown ? null : duration(workers, run.createdAt, end),
    review: leadKnown ? duration(reviews, run.createdAt, end) : null,
    waiting:
      unknown || !leadKnown
        ? null
        : Math.max(0, end - run.createdAt - duration([...workers, ...reviews], run.createdAt, end)),
  };
}
