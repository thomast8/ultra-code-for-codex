import { expect, it } from 'vitest';
import type { AgentSpec } from '../src/contracts/workflow.js';
import { authority, owner, until } from './runtime-fixture.js';
import {
  callLimits,
  exampleHarness,
  pendingHandoff,
  questions,
  resolveExample,
} from './workflow-examples-fixture.js';

function verifyAssignment(spec: AgentSpec) {
  expect(Object.keys(spec.assignment).sort()).toEqual([
    'acceptance',
    'constraints',
    'inputs',
    'outcome',
    'ownership',
    'stopConditions',
  ]);
  expect(Object.keys(spec.assessment).sort()).toEqual([
    'consequence',
    'coordinationOverhead',
    'delegationBenefit',
    'difficulty',
    'modelRationale',
    'uncertainty',
    'verificationBurden',
  ]);
  expect(spec.assignment.acceptance.length).toBeGreaterThan(0);
  expect(spec.assignment.stopConditions.length).toBeGreaterThan(0);
}

it('executes bounded discovery and dynamic source checks before lead acceptance', async () => {
  const { engine, calls, script, start, root } = exampleHarness('research');
  try {
    start();
    const run = await pendingHandoff(engine);
    expect(script).toContain(`maxAgentCalls: ${callLimits.research}`);
    expect(calls).toHaveLength(3);
    expect(calls.map((spec) => spec.title)).toEqual([
      'Identify up to two source questions',
      ...questions.map((item) => item.question),
    ]);
    expect(calls.slice(1).map((spec) => spec.assignment.inputs)).toEqual([
      { question: questions[0], sources: [{ id: 'source-a', excerpt: 'First fact' }] },
      { question: questions[1], sources: [{ id: 'source-b', excerpt: 'Second fact' }] },
    ]);
    for (const spec of calls) {
      verifyAssignment(spec);
      expect(spec).toMatchObject({
        model: authority.context.model,
        effort: authority.context.effort,
        capability: 'read-only',
      });
      expect(spec.assignment.ownership).toEqual({ cwd: root, paths: [] });
    }
    expect(run.tasks.map((task) => task.assessment)).toEqual(calls.map((spec) => spec.assessment));
    expect(run.phases.map((phase) => phase.label)).toEqual([
      'Find independent questions',
      'Check the selected sources',
      'Verify the research outcome',
    ]);
    expect(run.handoffs[0]?.spec.evidence).toHaveLength(3);
    await resolveExample(engine);
    expect(authority.context.model).toBe('lead-model');
  } finally {
    await engine.close();
  }
});

it('retains a discovery blocker and goes to the lead without retries or source fan-out', async () => {
  const { engine, calls, start } = exampleHarness('research', () => ({
    acceptance: 'blocked',
    value: { questions: [] },
    unresolved: ['Missing source'],
  }));
  try {
    start();
    const run = await pendingHandoff(engine);
    expect(calls).toHaveLength(1);
    expect(run.tasks[0]?.result?.unresolved).toEqual(['Missing source']);
    expect(run.handoffs[0]?.spec.evidence).toEqual(run.tasks[0]?.result?.evidence);
    await resolveExample(engine, 'blocked');
  } finally {
    await engine.close();
  }
});

it('accepts empty successful discovery without inventing follow-up calls', async () => {
  const { engine, calls, start } = exampleHarness('research', () => ({ value: { questions: [] } }));
  try {
    start();
    await pendingHandoff(engine);
    expect(calls).toHaveLength(1);
    await resolveExample(engine, 'incomplete');
  } finally {
    await engine.close();
  }
});

it('executes exactly two isolated concept lenses and returns the lead decision unchanged', async () => {
  const { engine, calls, start, script } = exampleHarness('concepts');
  try {
    start();
    const run = await pendingHandoff(engine);
    expect(script).toContain(`maxAgentCalls: ${callLimits.concepts}`);
    expect(calls).toHaveLength(2);
    expect(calls.map((spec) => spec.assignment.inputs)).toEqual([
      { brief: 'A compact offline task view', lens: 'timeline' },
      { brief: 'A compact offline task view', lens: 'priority' },
    ]);
    for (const spec of calls) {
      verifyAssignment(spec);
      expect(spec).toMatchObject({
        model: authority.context.model,
        effort: authority.context.effort,
        capability: 'read-only',
      });
    }
    expect(run.tasks.every((task) => task.result?.acceptance === 'satisfied')).toBe(true);
    expect(run.acceptanceOutcome).toBe('unverified');
    await resolveExample(engine);
  } finally {
    await engine.close();
  }
});

it.each([[], ['one'], ['one', 'one'], ['one', ''], ['one', 2], ['one', 'two', 'three']])(
  'rejects invalid concept lenses %j before spending a worker call',
  async (...lenses) => {
    const { engine, calls, start, root } = exampleHarness('concepts');
    try {
      start({ cwd: root, brief: 'Frozen brief', lenses });
      await until(() => engine.status(owner)[0]?.state === 'failed');
      expect(engine.status(owner)[0]?.error).toContain('exactly two distinct concept lenses');
      expect(calls).toHaveLength(0);
    } finally {
      await engine.close();
    }
  },
);

it('keeps coding ownership, checks and external actions assigned to the intended actors', async () => {
  const { engine, calls, start, script, root } = exampleHarness('coding');
  try {
    start();
    const run = await pendingHandoff(engine);
    expect(script).toContain(`maxAgentCalls: ${callLimits.coding}`);
    expect(calls).toHaveLength(1);
    const spec = calls[0]!;
    verifyAssignment(spec);
    expect(spec).toMatchObject({
      model: authority.context.model,
      effort: authority.context.effort,
      capability: 'workspace-write',
    });
    expect(spec.assignment.ownership).toEqual({ cwd: root, paths: [`${root}/example.ts`] });
    expect(spec.assignment.inputs).toEqual({ design: 'Validate at the existing input boundary' });
    expect(spec.assignment.constraints.join(' ')).toContain('Do not commit, push, publish');
    expect(spec.resources).toEqual([
      { key: 'isolated-fixture-worktree', mode: 'write', path: root },
    ]);
    expect(run.handoffs[0]?.spec.resources).toEqual(spec.resources);
    expect(run.handoffs[0]?.spec.objective).toContain(
      'required real-system QA and repository review',
    );
    expect(run.tasks[0]?.result?.value).toMatchObject({ remainingQA: ['Live QA'] });
    await resolveExample(engine);
  } finally {
    await engine.close();
  }
});
