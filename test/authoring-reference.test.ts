import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { format } from 'prettier';
import { authoringReference } from '../src/contracts/authoring.js';
import { agentV2OptionsSchema, startV2Schema } from '../src/contracts/schema.js';
import { authority, harness, output, owner, until } from './runtime-fixture.js';

it.each([0, 1])('ships and executes complete authoring example %i', async (index) => {
  const text = readFileSync('plugin/skills/ultra-code/references/authoring.md', 'utf8');
  expect(text).toBe(
    await format(authoringReference(), {
      parser: 'markdown',
      printWidth: 100,
      singleQuote: true,
      trailingComma: 'all',
    }),
  );
  const scripts = [...text.matchAll(/```js\n([\s\S]*?)\n```/g)].map((match) => match[1]);
  expect(scripts).toHaveLength(2);
  const script = scripts[index];
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
      reviewAfterWorkers: true,
      requestId: 'documented-example',
      contextKey: 'context',
      title: 'Check sources',
      objective: 'Compare independent sources',
      acceptance: ['Lead checks evidence'],
      script: script!,
      args: {
        questions: ['Check source A', 'Check source B'],
        task: 'Implement the requested behavior and verify it',
      },
    },
    host,
  );
  await until(() => calls.length === (index === 0 ? 2 : 1));
  for (const call of calls) {
    expect(call.spec).toMatchObject({
      format: 'plain',
      capability: index === 0 ? 'read-only' : 'workspace-write',
    });
    call.finish(output('Task checked'));
  }
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

it('documents exact access values from the validator at both discovery surfaces', () => {
  const reference = authoringReference();
  const description = startV2Schema.shape.script.description!;
  expect(description).toContain('agent(prompt) is read-only and cannot edit files');
  expect(description).toContain('agent(prompt, {access: "workspace-write"})');
  for (const access of agentV2OptionsSchema.shape.access.unwrap().options) {
    expect(reference).toContain(JSON.stringify(access));
    expect(description).toContain(JSON.stringify(access));
    expect(agentV2OptionsSchema.parse({ access })).toEqual({ access });
  }
  expect(agentV2OptionsSchema.safeParse({ access: 'write' }).success).toBe(false);
});
