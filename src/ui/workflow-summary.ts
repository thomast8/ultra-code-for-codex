import type { RunSnapshot, TaskSnapshot, TokenUsage } from '../contracts/workflow.js';
import { elapsed } from './workflow-time.js';
export { taskElapsed } from './workflow-time.js';

export function terminal(state: string): boolean {
  return ['completed', 'cancelled', 'failed'].includes(state);
}

export function visibleHandoffs(run: RunSnapshot) {
  return run.handoffs.filter((handoff) => !terminal(run.state) || handoff.state !== 'pending');
}

export function needsAttention(run: RunSnapshot): boolean {
  return (
    run.state === 'failed' ||
    run.state === 'needs_reconciliation' ||
    Boolean(run.error) ||
    (run.state === 'completed' && run.acceptanceOutcome !== 'satisfied') ||
    run.tasks.some(taskNeedsAttention) ||
    visibleHandoffs(run).some((handoff) => handoff.state !== 'resolved')
  );
}

export function runGroups(runs: RunSnapshot[]) {
  const ordered = [...runs].sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
  const current = ordered.filter((run) => !terminal(run.state) || needsAttention(run));
  const finished = ordered
    .filter((run) => terminal(run.state) && !needsAttention(run))
    .sort((a, b) => (b.finishedAt ?? b.updatedAt) - (a.finishedAt ?? a.updatedAt));
  return { current, latest: finished.slice(0, 1), history: finished.slice(1) };
}

export function tokenLabel(usage: Pick<TokenUsage, 'totalTokens'> | null, complete = true): string {
  if (!usage) return 'Tokens not reported';
  const total = usage.totalTokens;
  const count =
    total >= 1000
      ? `${(total / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })}k`
      : total.toLocaleString();
  return `${count} worker tokens${complete ? '' : ' (partial)'}`;
}

export function runElapsed(run: RunSnapshot, now: number): string {
  if (terminal(run.state) && run.finishedAt === null) return 'Elapsed unknown';
  return `${elapsed(run.createdAt, run.finishedAt ?? now)} elapsed`;
}

export function taskUsage(task: TaskSnapshot): TokenUsage | null {
  return task.usage ?? task.result?.usage ?? null;
}

export function taskLabel(task: TaskSnapshot): string {
  if (task.state === 'running') return 'Working';
  return task.state.replaceAll('_', ' ');
}

export function agentCounts(tasks: TaskSnapshot[]): string {
  const counts = new Map<string, number>();
  for (const task of tasks) {
    const label = taskLabel(task).toLowerCase();
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return (
    [...counts].map(([label, count]) => `${count} ${label}`).join(' · ') ||
    'No agents dispatched yet'
  );
}

function taskNeedsAttention(task: TaskSnapshot): boolean {
  return (
    ['failed', 'needs_reconciliation'].includes(task.state) ||
    (task.state === 'completed' && Boolean(task.result) && task.result?.acceptance !== 'satisfied')
  );
}

export function finishedAgentLabel(tasks: TaskSnapshot[]): string {
  const known = tasks.flatMap((task) => {
    const usage = taskUsage(task);
    return usage ? [usage.totalTokens] : [];
  });
  const usage = known.length ? { totalTokens: known.reduce((sum, value) => sum + value, 0) } : null;
  const state = tasks.every((task) => task.state === 'completed') ? 'completed' : 'finished';
  return `${tasks.length} ${state} · ${tokenLabel(usage, known.length === tasks.length)}`;
}
