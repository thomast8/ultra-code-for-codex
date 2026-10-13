import { expect, it, vi } from 'vitest';
import type { LeadResult } from '../src/contracts/workflow.js';
import { WorkflowEngine } from '../src/runtime/engine.js';
import { authority, harness, output, owner, request, until } from './runtime-fixture.js';

const script = `const p=phase('Verify'); return await lead({phase:p,objective:'Inspect resulting patch',
  resources:[{key:'patch',mode:'write'}],evidence:[{id:'patch',description:'Candidate diff'}],revision:'abc'});`;
const resolution: LeadResult = {
  acceptance: 'satisfied',
  value: 'checked',
  evidence: [{ id: 'qa', description: 'Observed workflow' }],
  revision: 'abc',
};

it('atomically claims exact lead turns and accepts only identical resolution retries', async () => {
  const { engine } = harness();
  engine.start(request(script), authority);
  await until(() => engine.status(owner)[0]?.handoffs.length === 1);
  const id = engine.status(owner)[0]!.handoffs[0]!.id;
  expect(() => engine.handoff(owner, id, 'resolve', authority.context, resolution)).toThrow(
    'claimed',
  );
  expect(() =>
    engine.handoff(owner, id, 'claim', { ...authority.context, resolutionStatus: 'unknown' }),
  ).toThrow('verified');
  expect(() =>
    engine.handoff({ ...owner, sessionId: 'other' }, id, 'claim', authority.context),
  ).toThrow('selected lead');
  engine.handoff(owner, id, 'claim', authority.context);
  expect(engine.handoff(owner, id, 'claim', authority.context).state).toBe('claimed');
  expect(() =>
    engine.handoff(owner, id, 'claim', { ...authority.context, turnId: 'other' }),
  ).toThrow('claimed');
  expect(() =>
    engine.handoff(owner, id, 'resolve', { ...authority.context, turnId: 'other' }, resolution),
  ).toThrow('another turn');
  engine.handoff(owner, id, 'resolve', authority.context, resolution);
  expect(engine.handoff(owner, id, 'resolve', authority.context, resolution).result).toEqual(
    resolution,
  );
  expect(() =>
    engine.handoff(owner, id, 'resolve', authority.context, { ...resolution, value: 'conflict' }),
  ).toThrow('Conflicting');
  await until(() => engine.status(owner)[0]?.state === 'completed');
  expect(engine.status(owner)[0]?.acceptanceOutcome).toBe('satisfied');
  await engine.close();
});

it('requires explicit readback resolution after a claimed handoff is interrupted', async () => {
  const { engine, dataDir } = harness();
  engine.start(request(script), authority);
  await until(() => engine.status(owner)[0]?.handoffs.length === 1);
  const id = engine.status(owner)[0]!.handoffs[0]!.id;
  engine.handoff(owner, id, 'claim', authority.context);
  await engine.close();
  const execute = vi.fn(async () => output());
  const recovered = new WorkflowEngine({ dataDir, executeWorker: execute });
  expect(recovered.status(owner)[0]?.state).toBe('needs_reconciliation');
  expect(recovered.status(owner)[0]?.handoffs[0]?.state).toBe('needs_reconciliation');
  expect(() => recovered.handoff(owner, id, 'claim', authority.context)).toThrow(
    'needs_reconciliation',
  );
  recovered.handoff(
    owner,
    id,
    'resolve',
    { ...authority.context, turnId: 'readback-turn' },
    resolution,
  );
  await until(() => recovered.status(owner)[0]?.state === 'completed');
  expect(recovered.status(owner)[0]?.handoffs[0]?.result?.revision).toBe('abc');
  expect(execute).not.toHaveBeenCalled();
  await recovered.close();
});

it('keeps a cancelled claimed handoff blocked until readback without restarting its workflow', async () => {
  const { engine, calls } = harness();
  const run = engine.start(
    request(`${script.replace('return await lead', 'await lead')} await agent(args.spec);`),
    authority,
  );
  await until(() => engine.status(owner)[0]?.handoffs.length === 1);
  const id = engine.status(owner)[0]!.handoffs[0]!.id;
  engine.control(owner, run.id, 'pause');
  expect(() => engine.handoff(owner, id, 'claim', authority.context)).toThrow('paused');
  engine.control(owner, run.id, 'resume');
  engine.handoff(owner, id, 'claim', authority.context);
  engine.control(owner, run.id, 'cancel');
  expect(engine.status(owner)[0]?.state).toBe('needs_reconciliation');
  engine.handoff(owner, id, 'resolve', { ...authority.context, turnId: 'readback' }, resolution);
  expect(engine.status(owner)[0]?.state).toBe('cancelled');
  expect(calls).toHaveLength(0);
  await engine.close();
  await engine.close();
});

it('blocks consequential lead claims in current or frozen Plan mode', async () => {
  const { engine } = harness();
  engine.start(request(script), authority);
  await until(() => engine.status(owner)[0]?.handoffs.length === 1);
  const id = engine.status(owner)[0]!.handoffs[0]!.id;
  expect(() =>
    engine.handoff(owner, id, 'claim', { ...authority.context, collaborationMode: 'plan' }),
  ).toThrow('Plan mode');
  engine.start(request(script, { requestId: 'plan' }), {
    ...authority,
    context: { ...authority.context, collaborationMode: 'plan' },
  });
  await until(() => engine.status(owner)[1]?.handoffs.length === 1);
  const planId = engine.status(owner)[1]!.handoffs[0]!.id;
  expect(() => engine.handoff(owner, planId, 'claim', authority.context)).toThrow('Plan mode');
  await engine.close();
});
