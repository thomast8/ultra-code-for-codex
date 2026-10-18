import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import type { RunRecord } from '../src/runtime/types.js';
import { WorkflowEngine } from '../src/runtime/engine.js';
import { resolveAgentRequest } from '../src/runtime/agent-request.js';
import { authority, harness, output, owner, request, spec, until } from './runtime-fixture.js';

const inheriting = `const p=phase('Discover'); const a={...args.spec,phase:p};
delete a.model; delete a.effort;
const result=await agent({...a,...args.routing});
return await lead({phase:p,objective:'Inspect saved result',resources:[],evidence:result.evidence});`;

function savedRecord(dataDir: string): RunRecord {
  const db = new DatabaseSync(join(dataDir, 'workflow.sqlite'), { readOnly: true });
  try {
    return JSON.parse(String(db.prepare('SELECT record FROM runs').get()!.record)) as RunRecord;
  } finally {
    db.close();
  }
}

it.each([
  [{}, 'lead-model', 'high'],
  [{ model: 'override' }, 'override', 'high'],
  [{ effort: 'low' }, 'lead-model', 'low'],
  [{ model: 'override', effort: 'medium' }, 'override', 'medium'],
])('resolves independent worker routing overrides %j', async (routing, model, effort) => {
  const h = harness();
  const initial = structuredClone(authority);
  try {
    h.engine.start(request(inheriting, { args: { spec, routing } }), initial);
    initial.context.model = 'later-model';
    initial.context.effort = 'max';
    await until(() => h.calls.length === 1);
    expect(h.calls[0]!.spec).toMatchObject({ model, effort });
    expect(h.engine.status(owner)[0]!.tasks[0]).toMatchObject({ requestedModel: model });
    h.calls[0]!.finish(output(null, { requestedModel: model, reportedModel: model }));
    await until(() => h.engine.status(owner)[0]!.handoffs.length === 1);
    const call = savedRecord(h.dataDir).calls.find((item) => item.kind === 'agent')!;
    expect(call.payload).toMatchObject({ model, effort });
  } finally {
    await h.engine.close();
  }
});

it.each([{ model: null }, { model: '' }, { effort: null }, { effort: '' }])(
  'rejects invalid supplied routing rather than inheriting %j',
  async (routing) => {
    const h = harness();
    try {
      h.engine.start(request(inheriting, { args: { spec, routing } }), authority);
      await until(() => h.engine.status(owner)[0]?.state === 'failed');
      expect(h.calls).toHaveLength(0);
    } finally {
      await h.engine.close();
    }
  },
);

it.each(['model', 'effort'] as const)('blocks unusable inherited %s', (field) => {
  const authored = { ...spec };
  delete authored[field];
  expect(() => resolveAgentRequest(authored, { ...authority.context, [field]: '' })).toThrow(
    `Verified lead ${field} is unavailable`,
  );
});

it.each([true, false])(
  'replays settled routing without redispatch; inherit=%s',
  async (inherit) => {
    const h = harness();
    const script = inherit
      ? inheriting
      : `const p=phase('Discover');
       const a=Object.fromEntries(Object.entries({...args.spec,phase:p}).reverse());
       const result=await agent(a);
       return await lead({phase:p,objective:'Inspect saved result',resources:[],evidence:result.evidence});`;
    h.engine.start(request(script, { args: { spec, routing: {} } }), authority);
    await until(() => h.calls.length === 1);
    h.calls[0]!.finish(output());
    await until(() => h.engine.status(owner)[0]!.handoffs.length === 1);
    await h.engine.close();
    const before = savedRecord(h.dataDir);
    const payload = before.calls.find((item) => item.kind === 'agent')!.payload;
    if (!inherit) expect(Object.keys(payload!)).toEqual(Object.keys(spec).reverse());
    const execute = vi.fn(async () => output());
    const recovered = new WorkflowEngine({ dataDir: h.dataDir, executeWorker: execute });
    try {
      await until(() =>
        recovered.events(owner, 0).events.some((e) => e.type === 'run.replay_ready'),
      );
      const current = {
        ...authority.context,
        turnId: 'later-turn',
        model: 'later-model',
        effort: 'max',
      };
      const handoff = recovered.status(owner)[0]!.handoffs[0]!;
      recovered.handoff(owner, handoff.id, 'claim', current);
      recovered.handoff(owner, handoff.id, 'resolve', current, {
        acceptance: 'incomplete',
        value: null,
        evidence: [],
      });
      await until(() => recovered.status(owner)[0]!.state === 'completed');
      const after = savedRecord(h.dataDir);
      expect(JSON.stringify(after.calls.find((item) => item.kind === 'agent')!.payload)).toBe(
        JSON.stringify(payload),
      );
      expect(after.requestBytes).toBe(before.requestBytes);
      expect(execute).not.toHaveBeenCalled();
    } finally {
      await recovered.close();
    }
  },
);
