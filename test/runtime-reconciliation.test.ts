import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { receipt, rejectUnsafeResolutions } from './runtime-reconciliation-fixture.js';
import { authority, harness, output, owner, request, spec, until } from './runtime-fixture.js';

it('requires exact owner/turn and evidence before releasing an ambiguous write without repeating it', async () => {
  const { engine, calls } = harness();
  const path = join(mkdtempSync(join(tmpdir(), 'ultra-write-readback-')), 'owned.txt');
  writeFileSync(path, 'before');
  const run = engine.start(
    request(
      `const p=phase('Discover');
    await agent({...args.spec,phase:p,resources:[{key:'file',mode:'write',path:args.path}]});
    return await agent({...args.spec,phase:p,title:'must not repeat'});`,
      { args: { spec, path } },
    ),
    authority,
  );
  await until(() => calls.length === 1);
  await calls[0]!.options.onEvent({
    type: 'thread',
    threadId: 'thread',
    reportedModel: 'actual',
    instructionSources: ['AGENTS.md'],
  });
  await calls[0]!.options.onEvent({ type: 'turn', threadId: 'thread', turnId: 'worker-turn' });
  writeFileSync(path, 'possible worker write');
  const original = output(
    { maybeWritten: true },
    {
      execution: 'uncertain',
      evidence: [{ id: 'worker', description: 'Partial worker evidence' }],
    },
  );
  calls[0]!.finish(original);
  await until(() => engine.status(owner)[0]?.handoffs.length === 1);
  const handoff = engine.status(owner)[0]!.handoffs[0]!;
  expect(handoff.id).toBe(engine.status(owner)[0]!.tasks[0]!.id);
  expect(handoff.spec.evidence.map((item) => item.description).join(' ')).toContain('worker-turn');
  expect(() =>
    engine.handoff({ ...owner, sessionId: 'other' }, handoff.id, 'claim', authority.context),
  ).toThrow('selected lead');
  expect(() =>
    engine.handoff(owner, handoff.id, 'claim', { ...authority.context, collaborationMode: 'plan' }),
  ).toThrow('Default');
  engine.handoff(owner, handoff.id, 'claim', authority.context);
  expect(engine.handoff(owner, handoff.id, 'claim', authority.context).state).toBe('claimed');
  expect(() =>
    engine.handoff(
      owner,
      handoff.id,
      'resolve',
      { ...authority.context, turnId: 'other' },
      receipt,
    ),
  ).toThrow('exact verified turn');
  rejectUnsafeResolutions(engine, handoff.id);
  engine.handoff(owner, handoff.id, 'resolve', authority.context, receipt);
  expect(engine.handoff(owner, handoff.id, 'resolve', authority.context, receipt).result).toEqual(
    receipt,
  );
  expect(() =>
    engine.handoff(owner, handoff.id, 'resolve', authority.context, {
      ...receipt,
      revision: 'conflict',
    }),
  ).toThrow('Conflicting');
  expect(engine.status(owner)[0]).toMatchObject({
    state: 'failed',
    acceptanceOutcome: 'incomplete',
  });
  expect(engine.result(owner, run.id, handoff.id)).toMatchObject(original);
  expect(readFileSync(path, 'utf8')).toBe('possible worker write');
  expect(calls).toHaveLength(1);
  await engine.close();
});

it('releases only the reconciled task resource and slot while another uncertain task stays quarantined', async () => {
  const { engine, calls } = harness();
  const script = `const p=phase('Discover');return await pipeline(['a','b'],key=>agent({...args.spec,phase:p,title:key,resources:[{key,mode:'write'}]}));`;
  const old = engine.start(request(script), authority);
  await until(() => calls.length === 2);
  calls[0]!.finish(output(null, { execution: 'uncertain' }));
  calls[1]!.finish(output(null, { execution: 'uncertain' }));
  await until(() => engine.status(owner)[0]?.handoffs.length === 2);
  engine.start(
    request(script, { requestId: 'linked', parentRunId: old.id, evidenceRefs: receipt.evidence }),
    authority,
  );
  await until(() => engine.status(owner)[1]?.tasks.length === 2);
  const handoffs = engine.status(owner)[0]!.handoffs;
  engine.handoff(owner, handoffs[0]!.id, 'claim', authority.context);
  engine.handoff(owner, handoffs[0]!.id, 'resolve', authority.context, receipt);
  await until(() => calls.length === 3);
  expect(calls[2]!.spec.title).toBe('a');
  expect(engine.status(owner)[0]?.state).toBe('needs_reconciliation');
  engine.handoff(owner, handoffs[1]!.id, 'claim', authority.context);
  engine.handoff(owner, handoffs[1]!.id, 'resolve', authority.context, receipt);
  await until(() => calls.length === 4);
  expect(calls[3]!.spec.title).toBe('b');
  expect(calls[2]!.options.signal.aborted).toBe(false);
  expect(engine.status(owner)[0]?.state).toBe('failed');
  calls[2]!.finish(output());
  calls[3]!.finish(output());
  await engine.close();
});

it('reconciles an uncertain read-only Plan worker from a later verified Default turn', async () => {
  const { engine, calls } = harness();
  engine.start(request(`const p=phase('Discover');return await agent({...args.spec,phase:p});`), {
    ...authority,
    context: { ...authority.context, collaborationMode: 'plan' },
  });
  await until(() => calls.length === 1);
  calls[0]!.finish(output(null, { execution: 'uncertain' }));
  await until(() => engine.status(owner)[0]?.handoffs.length === 1);
  const id = engine.status(owner)[0]!.handoffs[0]!.id;
  const context = { ...authority.context, turnId: 'default-readback' };
  engine.handoff(owner, id, 'claim', context);
  engine.handoff(owner, id, 'resolve', context, receipt);
  expect(engine.status(owner)[0]?.state).toBe('failed');
  expect(calls).toHaveLength(1);
  await engine.close();
});

it('retains other active claims after readback and can cancel them even though the old run is failed', async () => {
  const { engine, calls } = harness();
  const run = engine.start(
    request(`const p=phase('Discover');return await pipeline(['a','b'],key=>agent({
    ...args.spec,phase:p,title:key,resources:[{key,mode:'write'}]}));`),
    authority,
  );
  await until(() => calls.length === 2);
  calls[0]!.finish(output(null, { execution: 'uncertain' }));
  await until(() => engine.status(owner)[0]?.handoffs.length === 1);
  const id = engine.status(owner)[0]!.handoffs[0]!.id;
  engine.handoff(owner, id, 'claim', authority.context);
  engine.handoff(owner, id, 'resolve', authority.context, receipt);
  expect(engine.status(owner)[0]?.state).toBe('failed');
  expect(calls[1]!.options.signal.aborted).toBe(false);
  engine.start(
    request(
      `const p=phase('Discover');return await agent({...args.spec,phase:p,
    resources:[{key:'b',mode:'write'}]});`,
      { requestId: 'linked', parentRunId: run.id },
    ),
    authority,
  );
  await until(() => engine.status(owner)[1]?.tasks[0]?.state === 'waiting');
  expect(calls).toHaveLength(2);
  engine.control(owner, run.id, 'cancel');
  expect(calls[1]!.options.signal.aborted).toBe(true);
  await until(() => calls.length === 3);
  expect(calls[2]!.options.signal.aborted).toBe(false);
  calls[2]!.finish(output());
  await engine.close();
});
