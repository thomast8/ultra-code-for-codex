import { mkdtempSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { authority, harness, output, owner, request, spec, until } from './runtime-fixture.js';

it('grants compatible readers atomically and serializes writers without occupying a waiting slot', async () => {
  const { engine, calls } = harness();
  engine.start(
    request(`const p=phase('Discover'); return await pipeline([
    {title:'reader1',key:'shared',mode:'read'}, {title:'reader2',key:'shared',mode:'read'},
    {title:'writer',key:'shared',mode:'write'}, {title:'independent',key:'elsewhere',mode:'write'}
  ],r=>agent({...args.spec,phase:p,title:r.title,resources:[{key:r.key,mode:r.mode}]}));`),
    authority,
  );
  await until(() => calls.length === 2);
  expect(calls.map((call) => call.spec.title)).toEqual(['reader1', 'reader2']);
  calls[0]!.finish(output());
  await until(() => calls.length === 3);
  expect(calls[2]!.spec.title).toBe('independent');
  calls[1]!.finish(output());
  await until(() => calls.length === 4);
  expect(calls[3]!.spec.title).toBe('writer');
  calls[2]!.finish(output());
  calls[3]!.finish(output());
  await until(() => engine.status(owner)[0]?.state === 'completed');
  await engine.close();
});

it('blocks a waiting resource when its path disappears or is replaced', async () => {
  const { engine, calls } = harness();
  const directory = mkdtempSync(join(tmpdir(), 'ultra-resource-'));
  const path = join(directory, 'document');
  writeFileSync(path, 'original');
  engine.start(
    request(
      `const p=phase('Discover'); return await pipeline([1,2],n=>agent({
    ...args.spec,phase:p,title:String(n),resources:[{key:'doc',mode:'write',path:args.path}]}));`,
      {
        args: { spec, path },
      },
    ),
    authority,
  );
  await until(() => calls.length === 1);
  renameSync(path, `${path}-original`);
  writeFileSync(path, 'replacement');
  calls[0]!.finish(output());
  await until(() => engine.status(owner)[0]?.state === 'completed');
  expect(calls).toHaveLength(1);
  expect(engine.status(owner)[0]?.tasks[1]?.result?.error).toContain('replaced');
  await engine.close();
});

it('keeps uncertain writer claims quarantined while unrelated work proceeds', async () => {
  const { engine, calls } = harness();
  engine.start(
    request(`const p=phase('Discover'); return await pipeline([
    {title:'uncertain',key:'shared'}, {title:'blocked',key:'shared'}, {title:'free',key:'free'}
  ],r=>agent({...args.spec,phase:p,title:r.title,resources:[{key:r.key,mode:'write'}]}));`),
    authority,
  );
  await until(() => calls.length === 2);
  expect(calls.map((call) => call.spec.title)).toEqual(['uncertain', 'free']);
  calls[0]!.finish(output(null, { execution: 'uncertain', acceptance: 'blocked' }));
  calls[1]!.finish(output());
  await until(() => engine.status(owner)[0]?.state === 'needs_reconciliation');
  const other = engine.start(
    request(
      `const p=phase('Discover');return await agent({...args.spec,phase:p,resources:[{key:'shared',mode:'write'}]});`,
      { requestId: 'other' },
    ),
    authority,
  );
  await until(() => engine.status(owner)[1]?.tasks.length === 1);
  expect(calls).toHaveLength(2);
  engine.control(owner, other.id, 'cancel');
  await engine.close();
});
