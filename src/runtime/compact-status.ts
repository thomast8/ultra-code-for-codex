import type { RunSnapshot } from '../contracts/workflow.js';
import { runTiming } from '../ui/workflow-time.js';

export function compactStatus(runs: RunSnapshot[]) {
  return runs.map((run) => {
    const counts: Record<string, number> = {};
    for (const task of run.tasks) counts[task.state] = (counts[task.state] ?? 0) + 1;
    const pending = run.handoffs.filter((item) => item.state !== 'resolved').slice(0, 10);
    return {
      id: run.id,
      title: run.title.slice(0, 160),
      state: run.state,
      acceptance: run.acceptanceOutcome,
      usage: run.usage,
      budget: run.budget ?? null,
      workerCounts: counts,
      activeWorkers: run.tasks
        .filter((task) =>
          ['queued', 'waiting', 'running', 'needs_reconciliation'].includes(task.state),
        )
        .slice(0, 10)
        .map((task) => ({
          id: task.id,
          state: task.state,
          requestedModel: task.requestedModel,
          verifiedModel: task.reportedModel ?? 'Unknown',
          requestedEffort: task.effort,
          verifiedEffort: task.reportedEffort ?? 'Unknown',
          startedAt: task.startedAt,
          lastActivityAt: task.lastActivityAt,
          lastActivity: task.lastActivity?.slice(0, 240) ?? null,
        })),
      pendingHandoffs: pending.map((item) => item.id),
      ...(pending.length
        ? {
            nextAction: `Lead review ${pending[0]!.id} is waiting for you; it is not a worker task. Call ultra_handoff {id, action: "claim"}, inspect the saved results, then ultra_handoff {id, action: "resolve", resolution: {acceptance, value, evidence: [{id, description}]}}. The run stays running and unverified until you resolve it; do not reply to the user first.`,
          }
        : {}),
      timing: runTiming(run, Date.now()),
      error: run.error?.slice(0, 240) ?? null,
    };
  });
}
