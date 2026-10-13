import { expect, it } from 'vitest';
import type { LeadResult } from '../src/contracts/workflow.js';
import { authority, harness, owner, request, until } from './runtime-fixture.js';

it.each(['unknown', 'Default', 'default-extra', ''])(
  'rejects verified %j mode before creating or dispatching a run',
  async (collaborationMode) => {
    const { engine, calls } = harness();
    const write = `const p=phase('Write'); return await agent({...args.spec,phase:p,capability:'workspace-write'});`;
    expect(() =>
      engine.start(request(write), {
        ...authority,
        context: { ...authority.context, collaborationMode },
      }),
    ).toThrow('collaboration mode');
    expect(engine.status(owner)).toEqual([]);
    expect(calls).toHaveLength(0);
    await engine.close();
  },
);

it('rejects unknown-mode lead claim and resolution without changing the handoff', async () => {
  const { engine } = harness();
  engine.start(
    request(`const p=phase('Verify'); return await lead({phase:p,
    objective:'Inspect patch',resources:[],evidence:[]});`),
    authority,
  );
  await until(() => engine.status(owner)[0]!.handoffs.length === 1);
  const id = engine.status(owner)[0]!.handoffs[0]!.id;
  const unknown = { ...authority.context, collaborationMode: 'unknown' };
  const resolution: LeadResult = {
    acceptance: 'satisfied',
    value: 'checked',
    evidence: [{ id: 'readback', description: 'Observed patch' }],
  };
  expect(() => engine.handoff(owner, id, 'claim', unknown)).toThrow('collaboration mode');
  expect(engine.status(owner)[0]!.handoffs[0]!.state).toBe('pending');
  engine.handoff(owner, id, 'claim', authority.context);
  expect(() => engine.handoff(owner, id, 'resolve', unknown, resolution)).toThrow(
    'collaboration mode',
  );
  expect(engine.status(owner)[0]!.handoffs[0]).toMatchObject({ state: 'claimed', result: null });
  engine.handoff(owner, id, 'resolve', authority.context, resolution);
  await until(() => engine.status(owner)[0]!.state === 'completed');
  await engine.close();
});
