import { expect, it } from 'vitest';
import { WorkflowEngine } from '../src/runtime/engine.js';
import { authority, harness, output, owner, request, until } from './runtime-fixture.js';

const planning = `return await lead({kind:"planning",phase:phase("Investigate and plan"),
  objective:"Verify a concrete plan",resources:[{key:"evidence",mode:"read"}],evidence:[]});`;
const resolution = {
  acceptance: 'satisfied' as const,
  value: { outcome: 'Plan only', edits: ['Named file changes'], checks: ['Acceptance test'] },
  evidence: [{ id: 'plan', description: 'Lead verified the bounded planning evidence' }],
};

it.each([
  ['plan', 'plan'],
  ['default', 'plan'],
  ['plan', 'default'],
])(
  'completes a read-only planning handoff from run %s in current %s mode',
  async (runMode, currentMode) => {
    const { engine, calls } = harness();
    try {
      engine.start(request(planning), {
        ...authority,
        context: { ...authority.context, collaborationMode: runMode! },
      });
      await until(() => engine.status(owner)[0]?.handoffs.length === 1);
      const handoff = engine.status(owner)[0]!.handoffs[0]!;
      expect(handoff.spec.kind).toBe('planning');
      const context = { ...authority.context, collaborationMode: currentMode! };
      engine.handoff(owner, handoff.id, 'claim', context);
      engine.handoff(owner, handoff.id, 'resolve', context, resolution);
      await until(() => engine.status(owner)[0]?.state === 'completed');
      expect(engine.status(owner)[0]?.acceptanceOutcome).toBe('satisfied');
      expect(calls).toHaveLength(0);
    } finally {
      await engine.close();
    }
  },
);

it.each(['plan', 'default'])('rejects a planning write claim in %s mode', async (mode) => {
  const { engine, calls } = harness();
  try {
    engine.start(request(planning.replace('mode:"read"', 'mode:"write"')), {
      ...authority,
      context: { ...authority.context, collaborationMode: mode },
    });
    await until(() => engine.status(owner)[0]?.state === 'failed');
    expect(engine.status(owner)[0]?.error).toContain('Planning handoffs require read-only');
    expect(engine.status(owner)[0]?.handoffs).toHaveLength(0);
    expect(calls).toHaveLength(0);
  } finally {
    await engine.close();
  }
});

it('keeps explicitly tagged action handoffs blocked in Plan Mode', async () => {
  const { engine } = harness();
  try {
    engine.start(request(planning.replace('kind:"planning"', 'kind:"action"')), {
      ...authority,
      context: { ...authority.context, collaborationMode: 'plan' },
    });
    await until(() => engine.status(owner)[0]?.handoffs.length === 1);
    const id = engine.status(owner)[0]!.handoffs[0]!.id;
    expect(() => engine.handoff(owner, id, 'claim', authority.context)).toThrow('Plan mode');
  } finally {
    await engine.close();
  }
});

it('preserves a pending planning handoff across runtime recovery', async () => {
  const { engine, dataDir } = harness();
  const plan = { ...authority, context: { ...authority.context, collaborationMode: 'plan' } };
  engine.start(request(planning), plan);
  await until(() => engine.status(owner)[0]?.handoffs.length === 1);
  await engine.close();
  const recovered = new WorkflowEngine({ dataDir, executeWorker: async () => output() });
  try {
    await until(() =>
      recovered.events(owner, 0).events.some((event) => event.type === 'run.replay_ready'),
    );
    const handoff = recovered.status(owner)[0]!.handoffs[0]!;
    expect(handoff.spec.kind).toBe('planning');
    recovered.handoff(owner, handoff.id, 'claim', plan.context);
    recovered.handoff(owner, handoff.id, 'resolve', plan.context, resolution);
    await until(() => recovered.status(owner)[0]?.state === 'completed');
    expect(recovered.status(owner)[0]?.acceptanceOutcome).toBe('satisfied');
  } finally {
    await recovered.close();
  }
});
