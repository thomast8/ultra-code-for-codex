import { expect, it } from 'vitest';
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
function request(script: string, requestId = 'v2') {
  return {
    contractVersion: 2 as const,
    requestId,
    contextKey: 'context',
    title: 'V2 workflow',
    objective: 'Inspect evidence',
    acceptance: ['Lead verifies evidence'],
    script,
    args: null,
  };
}

it('dispatches plain-text workers from a small call and keeps completion separate from acceptance', async () => {
  const { engine, calls } = harness();
  const run = engine.start(
    request('return await agent("Inspect current source", {label:"Source", phase:"Review"});'),
    host,
  );
  await until(() => calls.length === 1);
  expect(calls[0]!.spec).toMatchObject({
    format: 'plain',
    title: 'Source',
    phase: { label: 'Review' },
    model: 'lead-model',
    effort: 'high',
    capability: 'read-only',
    resources: [{ mode: 'read', path: '/private/tmp' }],
  });
  calls[0]!.finish(output('Found the source'));
  await until(() => engine.status(owner)[0]?.state === 'completed');
  expect(engine.result(owner, run.id)).toMatchObject({
    result: 'Found the source',
    acceptanceOutcome: 'unverified',
    tasks: [{ state: 'completed', result: { value: 'Found the source' } }],
  });
  await engine.close();
});

it('uses three shared profile slots and does not turn a discarded failure into acceptance', async () => {
  const { engine, calls } = harness();
  const script =
    'const results=await parallel([0,1,2,3].map(i=>()=>agent("Check item "+i))); return {acceptance:"satisfied",results};';
  engine.start(request(script), host);
  await until(() => calls.length === 3);
  expect(engine.status(owner)[0]?.tasks).toHaveLength(4);
  calls[0]!.finish(output(null, { execution: 'failed', error: 'Backend failed' }));
  await until(() => calls.length === 4);
  for (const call of calls.slice(1)) call.finish(output('ok'));
  await until(() => engine.status(owner)[0]?.state === 'completed');
  expect(engine.status(owner)[0]).toMatchObject({ acceptanceOutcome: 'incomplete' });
  expect(engine.status(owner)[0]?.tasks.filter((task) => task.state === 'failed')).toHaveLength(1);
  await engine.close();
});

it('does not dispatch a dependent pipeline stage after a terminal worker failure', async () => {
  const { engine, calls } = harness();
  engine.start(
    request('return await pipeline([1,2], n=>agent("Check "+n), result=>agent("Verify "+result));'),
    host,
  );
  await until(() => calls.length === 2);
  calls[0]!.finish(output(null, { execution: 'failed', error: 'Source unavailable' }));
  calls[1]!.finish(output('Source two'));
  await until(() => calls.length === 3);
  expect(calls[2]!.spec.prompt).toBe('Verify Source two');
  calls[2]!.finish(output('Verified'));
  await until(() => engine.status(owner)[0]?.state === 'completed');
  expect(engine.status(owner)[0]?.tasks).toHaveLength(3);
  expect(engine.status(owner)[0]?.acceptanceOutcome).toBe('incomplete');
  await engine.close();
});

it('prevalidates syntax, blocks plan writes and accepts bounded structured logs', async () => {
  const { engine, calls } = harness();
  expect(() => engine.start(request('return await agent('), host)).toThrow();
  expect(engine.status(owner)).toHaveLength(0);
  engine.start(request('log({report:"x".repeat(100000)}); return 1;', 'log'), host);
  await until(() => engine.status(owner)[0]?.state === 'completed');
  expect(engine.events(owner, 0).events.find((event) => event.type === 'log')?.data).toBeDefined();
  engine.start(request('return await agent("Edit", {access:"workspace-write"});', 'plan'), {
    ...host,
    context: { ...host.context, collaborationMode: 'plan' },
  });
  await until(() => engine.status(owner)[1]?.state === 'failed');
  expect(calls).toHaveLength(0);
  await engine.close();
});

it('reloads a completed v2 record without replaying its worker', async () => {
  const { engine, calls, dataDir, execute } = harness();
  engine.start(request('return await agent("Inspect");'), host);
  await until(() => calls.length === 1);
  calls[0]!.finish(output('Saved'));
  await until(() => engine.status(owner)[0]?.state === 'completed');
  await engine.close();
  const restored = new WorkflowEngine({ dataDir, executeWorker: execute });
  expect(restored.status(owner)[0]).toMatchObject({ state: 'completed', result: 'Saved' });
  expect(calls).toHaveLength(1);
  await restored.close();
});

it('continues only an owned, returned durable worker and retains the original result', async () => {
  const { engine, calls } = harness();
  const first = engine.start(request('return await agent("Inspect");'), host);
  await until(() => calls.length === 1);
  await calls[0]!.options.onEvent({
    type: 'thread',
    threadId: 'durable-worker',
    instructionSources: [],
    reportedModel: 'lead-model',
    reportedEffort: 'high',
  });
  calls[0]!.finish(output('Original evidence'));
  await until(() => engine.status(owner)[0]?.state === 'completed');
  const taskId = `${first.id}:1`;
  const continuation = engine.start(
    {
      ...request('return await agent("Check the original finding");', 'follow'),
      parentRunId: first.id,
      continuationOf: { runId: first.id, taskId },
    },
    host,
  );
  await until(() => calls.length === 2);
  expect(calls[1]!.spec).toMatchObject({ resumeThreadId: 'durable-worker' });
  expect(engine.status(owner)[1]?.continuationOf?.kind).toBe('follow-up');
  expect(() =>
    engine.start(
      {
        ...request('return await agent("Again");', 'forged'),
        parentRunId: first.id,
        continuationOf: { runId: first.id, taskId },
      },
      { ...host, context: { ...host.context, sessionId: 'foreign' } },
    ),
  ).toThrow('selected lead');
  calls[1]!.finish(output('Checked'));
  await until(() => engine.status(owner)[1]?.state === 'completed');
  expect(engine.result(owner, first.id, taskId)).toMatchObject({ value: 'Original evidence' });
  expect(engine.result(owner, continuation.id)).toMatchObject({ result: 'Checked' });
  await engine.close();
});

it('marks continuation after a terminal worker failure as a repair', async () => {
  const { engine, calls } = harness();
  const first = engine.start(request('return await agent("Inspect");'), host);
  await until(() => calls.length === 1);
  await calls[0]!.options.onEvent({
    type: 'thread',
    threadId: 'repair-thread',
    instructionSources: [],
    reportedModel: 'lead-model',
  });
  calls[0]!.finish(output(null, { execution: 'failed', error: 'Terminal failure' }));
  await until(() => engine.status(owner)[0]?.state === 'completed');
  expect(engine.status(owner)[0]?.acceptanceOutcome).toBe('incomplete');
  engine.start(
    {
      ...request('return await agent("Repair");', 'repair'),
      parentRunId: first.id,
      continuationOf: { runId: first.id, taskId: `${first.id}:1` },
    },
    host,
  );
  await until(() => calls.length === 2);
  expect(engine.status(owner)[1]?.continuationOf?.kind).toBe('repair');
  calls[1]!.finish(output('Repaired'));
  await until(() => engine.status(owner)[1]?.state === 'completed');
  expect(engine.status(owner)[0]?.acceptanceOutcome).toBe('incomplete');
  await engine.close();
});

it('hydrates owned saved-result references into worker evidence with a size bound', async () => {
  const { engine, calls } = harness();
  const source = engine.start(request('return await agent("Read source");'), host);
  await until(() => calls.length === 1);
  calls[0]!.finish(output({ claim: 'Verified source fact' }));
  await until(() => engine.status(owner)[0]?.state === 'completed');
  const ref = {
    id: 'source-fact',
    description: 'Prior source finding',
    uri: `ultra://run/${source.id}/task/${source.id}:1`,
  };
  engine.start(
    { ...request('return await agent("Check it");', 'dependent'), evidenceRefs: [ref] },
    host,
  );
  await until(() => calls.length === 2);
  expect(calls[1]!.spec.prompt).toContain('Verified source fact');
  expect(calls[1]!.spec.prompt).toContain('"acceptance":"unverified"');
  expect(() =>
    engine.start(
      {
        ...request('return 1;', 'foreign'),
        evidenceRefs: [ref],
      },
      { ...host, context: { ...host.context, sessionId: 'foreign' } },
    ),
  ).toThrow('selected lead');
  calls[1]!.finish(output('Checked'));
  await until(() => engine.status(owner)[1]?.state === 'completed');
  await engine.close();
});
