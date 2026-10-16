import type { RunSnapshot, TaskSnapshot } from '../src/contracts/workflow.js';
import { runFixture, taskFixture, threeRuns, usage } from './panel-ui-dashboard-fixture.js';

// The dashboard fixtures are written against a frozen clock of 3_661_000.
const fixtureNow = 3_661_000;

function shiftTime(value: number | null, delta: number): number | null {
  return value === null ? null : value + delta;
}

function shiftTask(task: TaskSnapshot, delta: number): TaskSnapshot {
  return {
    ...task,
    createdAt: task.createdAt + delta,
    startedAt: shiftTime(task.startedAt, delta),
    finishedAt: shiftTime(task.finishedAt, delta),
    lastActivityAt: task.lastActivityAt + delta,
  };
}

function shiftRun(run: RunSnapshot, delta: number): RunSnapshot {
  return {
    ...run,
    createdAt: run.createdAt + delta,
    updatedAt: run.updatedAt + delta,
    finishedAt: shiftTime(run.finishedAt, delta),
    tasks: run.tasks.map((task) => shiftTask(task, delta)),
  };
}

const repair = { id: 'repair', label: 'Repair the frozen zero case' };

// Mirrors the completed 0.2.5 run whose result used to render as raw JSON.
function explicitZeroRun(now: number): RunSnapshot {
  const worker = taskFixture({
    id: 'qa-worker',
    title: 'Repair the frozen zero case',
    state: 'completed',
    phase: repair,
    createdAt: now - 820_000,
    startedAt: now - 800_000,
    finishedAt: now - 300_000,
    lastActivityAt: now - 300_000,
    result: {
      execution: 'completed',
      acceptance: 'incomplete',
      value: { changedFiles: ['src/retry.ts', 'test/retry.test.ts'], assertions: 4 },
      evidence: [{ id: 'head', description: 'HEAD matched the frozen base', revision: '6e5876e' }],
      unresolved: ['Coverage initialisation failed with EPERM, so the gate did not complete.'],
      usage,
      requestedModel: 'gpt-6-luna',
      reportedModel: 'gpt-6-luna',
    },
  });
  return runFixture({
    id: 'qa-zero',
    title: 'QA fixture · Preserve an explicit zero',
    state: 'completed',
    acceptanceOutcome: 'satisfied',
    createdAt: now - 866_000,
    updatedAt: now - 1_000,
    finishedAt: now - 1_000,
    accountingComplete: false,
    usage: { ...usage, totalTokens: 127_078 },
    result: {
      summary:
        'Explicit zero is preserved; lead checks and review passed; fixture PR left unmerged.',
      testCases: 9,
      repositoryTests: 4,
      coveragePercent: 100,
      workerAcceptancePreserved: 'incomplete',
      readyPr: 'https://github.com/thomast8/ultra-code-for-codex/pull/2',
    },
    phases: [repair],
    handoffs: [],
    tasks: [worker],
  });
}

export function qaRuns(now: number): RunSnapshot[] {
  const live = threeRuns().map((run) => shiftRun(run, now - fixtureNow));
  const costUsage = {
    inputTokens: 168_686,
    cachedInputTokens: 132_608,
    outputTokens: 2_237,
    reasoningOutputTokens: 1_000,
    totalTokens: 170_923,
  };
  const cost = runFixture({
    id: 'qa-cost',
    title: 'QA fixture · Cost and soft threshold',
    createdAt: now - 60_000,
    updatedAt: now,
    budget: { maxObservedTokens: 50_000 },
    usage: costUsage,
    tasks: [taskFixture({ id: 'qa-cost-worker', usage: costUsage })],
  });
  return [cost, explicitZeroRun(now), ...live];
}
