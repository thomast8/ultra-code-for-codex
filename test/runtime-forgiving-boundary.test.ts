import { expect, it } from 'vitest';
import { agentV2OptionsSchema } from '../src/contracts/schema.js';
import { WorkflowEngine } from '../src/runtime/engine.js';
import { authority, harness, output, owner, until } from './runtime-fixture.js';

const host = {
  ...authority,
  capacity: {
    source: 'host-profile' as const,
    totalSlots: 3 as const,
    reservedSlots: 0 as const,
    evidence: 'Ultra profile limit' as const,
  },
};
const resolution = {
  acceptance: 'satisfied' as const,
  value: 'Verified',
  evidence: [{ id: 'checks', description: 'Lead verified the outcome' }],
};
function request(script: string, requestId = 'forgiving') {
  return {
    contractVersion: 2 as const,
    reviewAfterWorkers: true,
    requestId,
    contextKey: 'context',
    title: 'Forgiving boundary',
    objective: 'Inspect evidence',
    acceptance: ['Lead verifies evidence'],
    script,
    args: null,
  };
}
const threeWorkers =
  'const results = await parallel([() => agent("A", {label:"A"}), () => agent("B", {label:"B"}), () => agent("C", {label:"C"})]);';

it('turns worker text and failed-worker null into lead evidence artifacts', async () => {
  const { engine, calls } = harness();
  engine.start(
    request(
      `${threeWorkers} return await lead("Synthesize distinct evidence", [...results, "  "]);`,
    ),
    host,
  );
  await until(() => calls.length === 3);
  calls[0]!.finish(output('Report A'));
  calls[1]!.finish(output(null, { execution: 'failed', error: 'Terminal failure' }));
  calls[2]!.finish(output({ description: 'Report C', findings: [] }));
  await until(() => engine.status(owner)[0]?.handoffs.length === 1);
  const handoff = engine.status(owner)[0]!.handoffs[0]!;
  expect(handoff.spec.evidence).toEqual([
    { id: 'evidence-1', description: 'Report A' },
    { id: 'evidence-2', description: 'Worker result unavailable: terminal failure or null' },
    { id: 'evidence-3', description: '{"description":"Report C","findings":[]}' },
    { id: 'evidence-4', description: 'Worker returned empty output' },
  ]);
  await engine.close();
});

it('accepts the single-object lead form from older examples', async () => {
  const { engine, calls } = harness();
  engine.start(
    request(
      'const r = await agent("A"); return await lead({ objective: "Review", evidence: [r, {id:"x", description:"Kept"}] });',
    ),
    host,
  );
  await until(() => calls.length === 1);
  calls[0]!.finish(output('Report A'));
  await until(() => engine.status(owner)[0]?.handoffs.length === 1);
  expect(engine.status(owner)[0]!.handoffs[0]!.spec).toMatchObject({
    objective: 'Review',
    evidence: [
      { id: 'evidence-1', description: 'Report A' },
      { id: 'x', description: 'Kept' },
    ],
  });
  await engine.close();
});

it('completes a script that forgets to await its final lead call', async () => {
  const { engine, calls } = harness();
  const run = engine.start(request(`${threeWorkers} lead("Synthesize", results);`), host);
  await until(() => calls.length === 3);
  for (const call of calls) call.finish(output('Report'));
  await until(() => engine.status(owner)[0]?.handoffs.length === 1);
  expect(engine.status(owner)[0]?.state).toBe('running');
  const id = engine.status(owner)[0]!.handoffs[0]!.id;
  engine.handoff(owner, id, 'claim', authority.context);
  engine.handoff(owner, id, 'resolve', authority.context, resolution);
  await until(() => engine.status(owner)[0]?.state === 'completed');
  expect(engine.result(owner, run.id)).toMatchObject({
    acceptanceOutcome: 'satisfied',
    result: resolution,
  });
  expect(engine.status(owner)[0]?.handoffs).toHaveLength(1);
  await engine.close();
});

it('surfaces a rejected unawaited call instead of dropping it', async () => {
  const { engine } = harness();
  engine.start(request('lead(""); return "done";'), host);
  await until(() => engine.status(owner)[0]?.state === 'failed');
  expect(engine.status(owner)[0]?.error).toMatch(/objective|Too small|string/i);
  await engine.close();
});

it('restores an unawaited final lead across restart without redispatch', async () => {
  const f = harness();
  const run = f.engine.start(request('const r = await agent("A"); lead("Review", [r]);'), host);
  await until(() => f.calls.length === 1);
  f.calls[0]!.finish(output('Report A'));
  await until(() => f.engine.status(owner)[0]?.handoffs.length === 1);
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
    result: resolution,
  });
  expect(f.calls).toHaveLength(1);
  await restored.close();
});

it('maps common access aliases onto the two supported worker capabilities', async () => {
  for (const [alias, capability] of Object.entries({
    read: 'read-only',
    readonly: 'read-only',
    write: 'workspace-write',
    edit: 'workspace-write',
  }))
    expect(agentV2OptionsSchema.parse({ access: alias })).toEqual({ access: capability });
  const { engine, calls } = harness();
  engine.start(request('return await agent("R", {access:"readonly"});'), host);
  await until(() => calls.length === 1);
  expect(calls[0]!.spec.capability).toBe('read-only');
  await engine.close();
});
