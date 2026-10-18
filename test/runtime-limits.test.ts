import { expect, it, vi } from 'vitest';
import { ScriptMachine } from '../src/runtime/sandbox.js';
import { WorkflowEngine } from '../src/runtime/engine.js';
import { authority, harness, output, owner, request, single, until } from './runtime-fixture.js';

it('does not promote invented script evidence or worker completion into verified goal acceptance', async () => {
  const { engine } = harness();
  engine.start(
    request(
      `return {acceptance:'satisfied',value:null,evidence:[{id:'made-up',description:'claimed'}]};`,
    ),
    authority,
  );
  engine.start(
    request(`return {acceptance:'blocked',value:null};`, { requestId: 'blocked' }),
    authority,
  );
  await until(() => engine.status(owner).every((run) => run.state === 'completed'));
  expect(engine.status(owner)[0]?.acceptanceOutcome).toBe('unverified');
  expect(engine.status(owner)[1]?.acceptanceOutcome).toBe('blocked');
  await engine.close();
});

it('records thread, turn and activity events and never repeats an uncertain backend failure', async () => {
  const { engine, calls, dataDir } = harness();
  engine.start(request(single), authority);
  await until(() => calls.length === 1);
  const { onEvent } = calls[0]!.options;
  await onEvent({
    type: 'thread',
    threadId: 'worker-thread',
    reportedModel: 'actual',
    instructionSources: ['AGENTS.md'],
  });
  await onEvent({ type: 'turn', threadId: 'worker-thread', turnId: 'worker-turn' });
  await onEvent({ type: 'activity', message: 'Inspected source' });
  expect(engine.status(owner)[0]?.tasks[0]).toMatchObject({
    reportedModel: 'actual',
    lastActivity: 'Inspected source',
  });
  await engine.close();
  const execute = vi.fn(async () => {
    throw new Error('transport interrupted');
  });
  const recovered = new WorkflowEngine({ dataDir, executeWorker: execute });
  recovered.start(request(single, { requestId: 'failure' }), authority);
  await until(() => recovered.status(owner)[1]?.state === 'needs_reconciliation');
  expect(recovered.status(owner)[1]?.tasks[0]?.result?.error).toContain('transport interrupted');
  expect(execute).toHaveBeenCalledOnce();
  await recovered.close();
});

it('fails invalid phases, non-JSON arguments and unavailable host capabilities', async () => {
  const { engine } = harness();
  engine.start(request('return await agent(args.spec);'), authority);
  engine.start(request('const p=phase(5);', { requestId: 'phase' }), authority);
  engine.start(request('await import("node:fs");', { requestId: 'imports' }), authority);
  await until(() => engine.status(owner).every((run) => run.state === 'failed'));
  expect(engine.status(owner)[0]?.error).toContain('phase(label)');
  expect(engine.status(owner)[1]?.error).toContain('phase() expects a nonempty string');
  await engine.close();
});

it('applies host-payload and memory limits to guest execution', async () => {
  const failures: Error[] = [];
  const machine = await ScriptMachine.create({
    call: async () => null,
    sync: () => null,
    done: () => undefined,
    failed: (error) => failures.push(error),
  });
  machine.start('await __call("agent",JSON.stringify("x".repeat(1100000)));', null);
  await until(() => failures.length === 1);
  expect(failures[0]?.message).toContain('one MiB');
  const { engine } = harness();
  engine.start(request('const a=[]; for(;;) a.push(new Array(10000).fill("bytes"));'), authority);
  await until(() => engine.status(owner)[0]?.state === 'failed');
  await engine.close();
});

it('lets a paused final worker drain to a completed run', async () => {
  const { engine, calls } = harness();
  const run = engine.start(request(single), authority);
  await until(() => calls.length === 1);
  engine.control(owner, run.id, 'pause');
  calls[0]!.finish(output());
  await until(() => engine.status(owner)[0]?.state === 'completed');
  await engine.close();
});

it('rejects non-JSON script results and keeps authority immutable', async () => {
  const { engine } = harness();
  engine.start(request('return NaN;'), authority);
  await until(() => engine.status(owner)[0]?.state === 'failed');
  const invalid = {
    ...authority,
    context: { ...authority.context, resolutionStatus: 'unknown' as const },
  };
  expect(() => engine.start(request('return 1;', { requestId: 'invalid' }), invalid)).toThrow(
    'verified',
  );
  expect(() => engine.events(owner, -1)).toThrow('cursor');
  expect(() => engine.result(owner, 'missing')).toThrow('not found');
  await engine.close();
  expect(() => engine.start(request(), authority)).toThrow('closing');
});
