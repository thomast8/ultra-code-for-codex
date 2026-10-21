import { expect, it } from 'vitest';
import { WorkflowEngine } from '../src/runtime/engine.js';
import { authority, harness, output, owner, request, until } from './runtime-fixture.js';
const host = {
  ...authority,
  capacity: {
    source: 'host-profile' as const,
    totalSlots: 3,
    reservedSlots: 0,
    evidence: 'Ultra profile limit',
  },
};

const resolution = {
  acceptance: 'satisfied' as const,
  value: 'Verified',
  evidence: [{ id: 'checks', description: 'Lead verified the outcome' }],
};
function start(script = 'return await agent("Inspect");') {
  const base = request(script);
  delete base.authorityRef;
  return { ...base, contractVersion: 2 as const, reviewAfterWorkers: true };
}

it('persists automatic review and the proposed result across restart without redispatch', async () => {
  const f = harness();
  const run = f.engine.start(start(), host);
  await until(() => f.calls.length === 1);
  f.calls[0]!.finish(output('Saved evidence'));
  await until(() => f.engine.status(owner)[0]?.handoffs.length === 1);
  expect(f.engine.status(owner)[0]).toMatchObject({
    state: 'running',
    acceptanceOutcome: 'unverified',
    proposedResult: 'Saved evidence',
  });
  const cursor = f.engine.events(owner, 0).cursor;
  await f.engine.close();
  const restored = new WorkflowEngine({ dataDir: f.dataDir, executeWorker: f.execute });
  await until(() =>
    restored.events(owner, cursor).events.some((event) => event.type === 'run.replay_ready'),
  );
  const id = restored.status(owner)[0]!.handoffs[0]!.id;
  restored.handoff(owner, id, 'claim', authority.context);
  restored.handoff(owner, id, 'resolve', authority.context, resolution);
  await until(() => restored.status(owner)[0]?.state === 'completed');
  expect(restored.result(owner, run.id)).toMatchObject({
    acceptanceOutcome: 'satisfied',
    proposedResult: 'Saved evidence',
    result: resolution,
  });
  expect(f.calls).toHaveLength(1);
  await restored.close();
});

it('does not duplicate an explicit final review', async () => {
  const f = harness();
  f.engine.start(start('await agent("Inspect"); return await lead("Review");'), host);
  await until(() => f.calls.length === 1);
  f.calls[0]!.finish(output('Saved'));
  await until(() => f.engine.status(owner)[0]?.handoffs.length === 1);
  const id = f.engine.status(owner)[0]!.handoffs[0]!.id;
  f.engine.handoff(owner, id, 'claim', authority.context);
  f.engine.handoff(owner, id, 'resolve', authority.context, resolution);
  await until(() => f.engine.status(owner)[0]?.state === 'completed');
  expect(f.engine.status(owner)[0]?.handoffs).toHaveLength(1);
  await f.engine.close();
});

it('cannot turn a discarded worker failure into accepted work through automatic review', async () => {
  const f = harness();
  f.engine.start(start('await agent("Inspect"); return "done";'), host);
  await until(() => f.calls.length === 1);
  f.calls[0]!.finish(output(null, { execution: 'failed', error: 'Terminal failure' }));
  await until(() => f.engine.status(owner)[0]?.handoffs.length === 1);
  const id = f.engine.status(owner)[0]!.handoffs[0]!.id;
  f.engine.handoff(owner, id, 'claim', authority.context);
  f.engine.handoff(owner, id, 'resolve', authority.context, resolution);
  await until(() => f.engine.status(owner)[0]?.state === 'completed');
  expect(f.engine.status(owner)[0]?.acceptanceOutcome).toBe('incomplete');
  await f.engine.close();
});

it('requires another review when workers return after an earlier lead decision', async () => {
  const f = harness();
  f.engine.start(start('await lead("Decide"); return await agent("Implement decision");'), host);
  await until(() => f.engine.status(owner)[0]?.handoffs.length === 1);
  const first = f.engine.status(owner)[0]!.handoffs[0]!.id;
  f.engine.handoff(owner, first, 'claim', authority.context);
  f.engine.handoff(owner, first, 'resolve', authority.context, resolution);
  await until(() => f.calls.length === 1);
  f.calls[0]!.finish(output('New work'));
  await until(() => f.engine.status(owner)[0]?.handoffs.length === 2);
  expect(f.engine.status(owner)[0]).toMatchObject({
    state: 'running',
    acceptanceOutcome: 'unverified',
    proposedResult: 'New work',
  });
  const last = f.engine.status(owner)[0]!.handoffs[1]!.id;
  f.engine.handoff(owner, last, 'claim', authority.context);
  f.engine.handoff(owner, last, 'resolve', authority.context, resolution);
  await until(() => f.engine.status(owner)[0]?.state === 'completed');
  await f.engine.close();
});
