import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { format } from 'prettier';
import { authoringReference } from '../src/contracts/authoring.js';
import { authority, harness, output, owner, until } from './runtime-fixture.js';

it('ships the generated contract reference and executes its complete example', async () => {
  const text = readFileSync('plugin/skills/ultra-code/references/authoring.md', 'utf8');
  expect(text).toBe(
    await format(authoringReference(), {
      parser: 'markdown',
      printWidth: 100,
      singleQuote: true,
      trailingComma: 'all',
    }),
  );
  const script = text.match(/```js\n([\s\S]*?)\n```/)?.[1];
  expect(script).toBeTruthy();
  const host = {
    ...authority,
    capacity: {
      source: 'host-profile' as const,
      totalSlots: 3 as const,
      reservedSlots: 0 as const,
      evidence: 'Ultra profile limit' as const,
    },
  };
  const { engine, calls } = harness();
  const run = engine.start(
    {
      contractVersion: 2,
      requestId: 'documented-example',
      contextKey: 'context',
      title: 'Check sources',
      objective: 'Compare independent sources',
      acceptance: ['Lead checks evidence'],
      script: script!,
      args: { questions: ['Check source A', 'Check source B'] },
    },
    host,
  );
  await until(() => calls.length === 2);
  expect(calls.map((call) => call.spec.format)).toEqual(['plain', 'plain']);
  calls[0]!.finish(output('A checked'));
  calls[1]!.finish(output('B checked'));
  await until(() => engine.status(owner)[0]?.handoffs.length === 1);
  const id = engine.status(owner)[0]!.handoffs[0]!.id;
  engine.handoff(owner, id, 'claim', authority.context);
  engine.handoff(owner, id, 'resolve', authority.context, {
    acceptance: 'satisfied',
    value: 'Both checked',
    evidence: [{ id: 'source-check', description: 'Lead checked saved source results' }],
  });
  await until(() => engine.status(owner)[0]?.state === 'completed');
  expect(engine.result(owner, run.id)).toMatchObject({ acceptanceOutcome: 'satisfied' });
  await engine.close();
});
