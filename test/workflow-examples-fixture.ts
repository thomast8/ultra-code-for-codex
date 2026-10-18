import { mkdtempSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'vitest';
import { outputContract, parseWorkerOutput } from '../src/codex/worker-output.js';
import type { AgentSpec, JsonValue, LeadResult, TaskResult } from '../src/contracts/workflow.js';
import { WorkflowEngine } from '../src/runtime/engine.js';
import { authority, output, owner, request, until } from './runtime-fixture.js';

export type ExampleName = 'research' | 'concepts' | 'coding' | 'investigate-verify';
export const callLimits = { research: 3, concepts: 2, coding: 1, 'investigate-verify': 4 };
export const questions = [
  { question: 'Check the first source', sourceIds: ['source-a'] },
  { question: 'Check the second source', sourceIds: ['source-b'] },
];

export function exampleArgs(name: ExampleName, root: string): JsonValue {
  const values = {
    research: {
      cwd: root,
      sourceSetId: 'frozen-sources',
      sourceIndex: [
        { id: 'source-a', excerpt: 'First fact' },
        { id: 'source-b', excerpt: 'Second fact' },
      ],
    },
    'investigate-verify': {
      cwd: root,
      sourceSetId: 'frozen-sources',
      sourceIndex: [
        { id: 'source-a', excerpt: 'First fact' },
        { id: 'source-b', excerpt: 'Second fact' },
      ],
      items: [
        { id: 'a', question: 'First fact?', sourceIds: ['source-a'] },
        { id: 'b', question: 'Second fact?', sourceIds: ['source-b'] },
      ],
    },
    concepts: { cwd: root, brief: 'A compact offline task view', lenses: ['timeline', 'priority'] },
    coding: {
      worktree: root,
      worktreeKey: 'isolated-fixture-worktree',
      paths: [join(root, 'example.ts')],
      change: 'Reject a blank title before saving',
      context: { design: 'Validate at the existing input boundary' },
      constraints: ['Change only title validation and its focused test'],
      acceptance: ['A blank title produces the existing validation response'],
      stopConditions: ['The storage contract requires a migration'],
    },
  };
  return values[name];
}

export function fixtureValue(name: ExampleName, spec: AgentSpec): JsonValue {
  if (name === 'investigate-verify') {
    return spec.title.startsWith('Verify:')
      ? { supported: true, issues: [] }
      : { finding: 'Fixture fact', sourceIds: ['source-a'] };
  }
  if (name === 'research') {
    return spec.title === 'Identify up to two source questions'
      ? { questions }
      : { finding: `Fixture answer to ${spec.title}` };
  }
  if (name === 'concepts') {
    return { concept: spec.title, tradeoffs: ['Fixture comparison'], openQuestions: [] };
  }
  return { changedFiles: [], checks: ['Deterministic fixture only'], remainingQA: ['Live QA'] };
}

export function exampleHarness(
  name: ExampleName,
  result?: (spec: AgentSpec) => Partial<TaskResult>,
) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'ultra-examples-')));
  const calls: AgentSpec[] = [];
  const executeWorker = async (spec: AgentSpec): Promise<TaskResult> => {
    calls.push(structuredClone(spec));
    const candidate = output(fixtureValue(name, spec), {
      acceptance: 'satisfied',
      requestedModel: spec.model,
      reportedModel: spec.model,
      evidence: [{ id: `fixture-${calls.length}`, description: 'Deterministic fixture only' }],
      ...result?.(spec),
    });
    const { acceptance, value, evidence, unresolved } = candidate;
    parseWorkerOutput(
      JSON.stringify({
        acceptance,
        value,
        evidence: evidence.map((entry) => ({
          ...entry,
          uri: entry.uri ?? null,
          revision: entry.revision ?? null,
        })),
        unresolved,
      }),
      outputContract(spec),
    );
    return candidate;
  };
  const engine = new WorkflowEngine({ dataDir: join(root, 'state'), executeWorker });
  const script = readFileSync(new URL(`../workflows/${name}.js`, import.meta.url), 'utf8');
  const start = (args = exampleArgs(name, root)) =>
    engine.start(
      request(script, {
        args,
        maxAgentCalls: callLimits[name],
      }),
      authority,
    );
  return { root, calls, engine, script, start };
}

export async function pendingHandoff(engine: WorkflowEngine) {
  await until(() => {
    const snapshot = engine.status(owner)[0];
    return snapshot?.handoffs.length === 1 || snapshot?.state === 'failed';
  });
  const run = engine.status(owner)[0]!;
  expect(run.error).toBeNull();
  expect(run.acceptanceOutcome).toBe('unverified');
  expect(run.handoffs[0]?.state).toBe('pending');
  return run;
}

export async function resolveExample(
  engine: WorkflowEngine,
  acceptance: LeadResult['acceptance'] = 'satisfied',
) {
  const run = engine.status(owner)[0]!;
  const id = run.handoffs[0]!.id;
  const resolution: LeadResult = {
    acceptance,
    value: 'Explicit fake lead resolution; no live QA claim',
    evidence: [{ id: 'fake-lead-proof', description: 'Script acceptance protocol fixture only' }],
  };
  engine.handoff(owner, id, 'claim', authority.context);
  engine.handoff(owner, id, 'resolve', authority.context, resolution);
  await until(() => engine.status(owner)[0]?.state === 'completed');
  expect(engine.status(owner)[0]?.result).toEqual(resolution);
  expect(engine.status(owner)[0]?.acceptanceOutcome).toBe(acceptance);
}
