import type { TaskSnapshot } from '../contracts/workflow.js';

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
