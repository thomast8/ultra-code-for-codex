import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { WorkflowEngine } from '../src/runtime/engine.js';
import { Journal } from '../src/runtime/journal.js';
import { parseRecord } from '../src/runtime/persistence.js';
import type { RunRecord } from '../src/runtime/types.js';
import { receipt } from './runtime-reconciliation-fixture.js';
import { authority, harness, output, owner, request, until } from './runtime-fixture.js';

afterEach(() => vi.restoreAllMocks());
const script = `const p=phase('Verify');
  const result=await agent({...args.spec,phase:p,resources:[{key:'patch',mode:'write'}]});
  log('worker result delivered'); return result;`;
const originalResult = output(
  { observed: 'worker output' },
  {
    acceptance: 'satisfied',
    evidence: [{ id: 'worker-proof', description: 'Original worker evidence' }],
    usage: {
      inputTokens: 8,
      cachedInputTokens: 2,
      outputTokens: 3,
      reasoningOutputTokens: 1,
      totalTokens: 11,
    },
  },
);

function failSaves(failures: Record<string, number>) {
  const save = Journal.prototype.save;
  const remaining = new Map(Object.entries(failures));
  return vi.spyOn(Journal.prototype, 'save').mockImplementation(function (
    this: Journal,
    run,
    type,
    data,
  ) {
    const count = remaining.get(type) ?? 0;
    if (count > 0) {
      remaining.set(type, count - 1);
      throw new Error('Injected result save failure');
    }
    save.call(this, run, type, data);
  });
}

function durable(dataDir: string): RunRecord {
  const db = new DatabaseSync(join(dataDir, 'workflow.sqlite'), { readOnly: true });
  try {
    return parseRecord(String(db.prepare('SELECT record FROM runs').get()!.record));
  } finally {
    db.close();
  }
}

it('rolls back one failed result save and preserves original worker evidence in a restartable readback', async () => {
  const { engine, calls, dataDir } = harness();
  engine.start(request(script), {
    ...authority,
    capacity: { ...authority.capacity, totalSlots: 2 },
  });
  await until(() => calls.length === 1);
  failSaves({ 'agent.result': 1 });
  calls[0]!.finish(originalResult);
  await until(() => engine.status(owner)[0]?.state === 'needs_reconciliation');
  expect(engine.status(owner)[0]?.tasks[0]?.result).toMatchObject({
    ...originalResult,
    execution: 'uncertain',
    acceptance: 'incomplete',
    error: 'Injected result save failure',
  });
  const record = durable(dataDir);
  expect(record.nextSettlement).toBe(2);
  expect(record.calls.map((call) => call.settlement)).toEqual([null, 1]);
  expect(record.calls[1]?.state).toBe('uncertain');
  expect(
    engine.events(owner, 0).events.filter((event) => event.type === 'agent.result'),
  ).toHaveLength(1);
  expect(engine.events(owner, 0).events.some((event) => event.type === 'log')).toBe(false);
  await engine.close();
  vi.restoreAllMocks();
  const execute = vi.fn(async () => output());
  const recovered = new WorkflowEngine({ dataDir, executeWorker: execute });
  try {
    const run = recovered.status(owner)[0]!;
    expect(run.state).toBe('needs_reconciliation');
    expect(run.tasks[0]?.result?.evidence).toEqual(originalResult.evidence);
    recovered.start(request(script, { requestId: 'competing', parentRunId: run.id }), authority);
    await until(() => recovered.status(owner)[1]?.tasks.length === 1);
    expect(execute).not.toHaveBeenCalled();
    const id = run.handoffs[0]!.id;
    recovered.handoff(owner, id, 'claim', authority.context);
    recovered.handoff(owner, id, 'resolve', authority.context, receipt);
    await until(() => recovered.status(owner)[1]?.state === 'completed');
    expect(execute).toHaveBeenCalledOnce();
    expect(recovered.status(owner)[0]).toMatchObject({
      state: 'failed',
      acceptanceOutcome: 'incomplete',
    });
    expect(recovered.status(owner)[0]?.tasks[0]?.result?.value).toEqual(originalResult.value);
  } finally {
    await recovered.close();
  }
});

it('keeps dispatch quarantined without acknowledging a result when the uncertainty save also fails', async () => {
  const { engine, calls, dataDir } = harness();
  engine.start(request(script), authority);
  await until(() => calls.length === 1);
  failSaves({ 'agent.result': 2 });
  calls[0]!.finish(originalResult);
  await until(() => engine.status(owner)[0]?.state === 'needs_reconciliation');
  expect(engine.status(owner)[0]?.tasks[0]?.result).toMatchObject({
    execution: 'uncertain',
    value: originalResult.value,
    evidence: originalResult.evidence,
  });
  const record = durable(dataDir);
  expect(record.nextSettlement).toBe(1);
  expect(record.calls[1]).toMatchObject({ state: 'dispatched', settlement: null, result: null });
  expect(
    engine
      .events(owner, 0)
      .events.some((event) => event.type === 'agent.result' || event.type === 'log'),
  ).toBe(false);
  await engine.close();
  vi.restoreAllMocks();
  const execute = vi.fn(async () => output());
  const recovered = new WorkflowEngine({ dataDir, executeWorker: execute });
  try {
    expect(recovered.status(owner)[0]).toMatchObject({
      state: 'needs_reconciliation',
      tasks: [{ state: 'needs_reconciliation' }],
      handoffs: [{ state: 'pending' }],
    });
    expect(execute).not.toHaveBeenCalled();
  } finally {
    await recovered.close();
  }
});

it('releases a lease after failed dispatch persistence without starting that worker', async () => {
  const { engine, calls, dataDir } = harness();
  failSaves({ 'task.dispatched': 1 });
  engine.start(request(script), authority);
  await until(() => engine.status(owner)[0]?.state === 'completed');
  expect(calls).toHaveLength(0);
  expect(engine.status(owner)[0]?.tasks[0]?.result).toMatchObject({
    execution: 'failed',
    error: 'Injected result save failure',
  });
  expect(durable(dataDir).calls[1]?.state).toBe('resolved');
  engine.start(request(script, { requestId: 'same-resource' }), authority);
  await until(() => calls.length === 1);
  expect(engine.status(owner)[1]?.tasks[0]?.state).toBe('running');
  calls[0]!.finish(output());
  await until(() => engine.status(owner)[1]?.state === 'completed');
  await engine.close();
});

it('requires readback if both dispatch persistence and recording its known failure fail', async () => {
  const { engine, calls, dataDir } = harness();
  failSaves({ 'task.dispatched': 1, 'agent.result': 1 });
  engine.start(request(script), authority);
  await until(() => engine.status(owner)[0]?.state === 'needs_reconciliation');
  expect(calls).toHaveLength(0);
  expect(durable(dataDir).nextSettlement).toBe(2);
  expect(durable(dataDir).calls[1]).toMatchObject({ state: 'uncertain', settlement: 1 });
  expect(engine.events(owner, 0).events.some((event) => event.type === 'log')).toBe(false);
  await engine.close();
  vi.restoreAllMocks();
  const execute = vi.fn(async () => output());
  const recovered = new WorkflowEngine({ dataDir, executeWorker: execute });
  try {
    expect(recovered.status(owner)[0]?.handoffs[0]?.state).toBe('pending');
    expect(execute).not.toHaveBeenCalled();
  } finally {
    await recovered.close();
  }
});
