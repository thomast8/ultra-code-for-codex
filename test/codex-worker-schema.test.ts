import { expect, it } from 'vitest';
import { nestedValueSchema } from '../src/codex/worker-schema.js';
import { outputContract, parseWorkerOutput } from '../src/codex/worker-output.js';
import { outputText, workerSpec } from './codex-worker-fixture.js';

it('preserves standalone value-schema references inside the envelope', () => {
  const spec = workerSpec({
    outputSchema: {
      type: 'object',
      required: ['answer'],
      additionalProperties: false,
      properties: { answer: { $ref: '#/definitions/answer' } },
      definitions: { answer: { type: 'string', const: 'COBALT-47' } },
    },
  });
  expect(parseWorkerOutput(outputText(), outputContract(spec)).value).toEqual({
    answer: 'COBALT-47',
  });
  expect(() =>
    parseWorkerOutput(outputText({ value: { answer: 'WRONG' } }), outputContract(spec)),
  ).toThrow('schema');
  expect(spec.outputSchema.properties).toEqual({ answer: { $ref: '#/definitions/answer' } });
});

it('preserves schema data and separate id scopes while rebasing schema keywords', () => {
  expect(
    nestedValueSchema({
      anyOf: [{ $ref: '#' }],
      items: [{ $ref: '#/definitions/x' }],
      additionalProperties: { $ref: '#' },
      properties: { scoped: { $id: 'urn:test:scoped', $ref: '#' } },
      definitions: { x: { $ref: '#anchor' } },
      const: { $ref: '#/literal' },
    }),
  ).toEqual({
    anyOf: [{ $ref: '#/properties/value' }],
    items: [{ $ref: '#/properties/value/definitions/x' }],
    additionalProperties: { $ref: '#/properties/value' },
    properties: { scoped: { $id: 'urn:test:scoped', $ref: '#' } },
    definitions: { x: { $ref: '#anchor' } },
    const: { $ref: '#/literal' },
  });
  expect(
    nestedValueSchema({ properties: null, items: { type: 'string' }, additionalProperties: false }),
  ).toEqual({ properties: null, items: { type: 'string' }, additionalProperties: false });
});

it('keeps an explicit standalone schema ID and its local references intact', () => {
  const contract = outputContract(
    workerSpec({
      outputSchema: {
        $id: 'urn:worker:test',
        type: 'object',
        additionalProperties: false,
        required: ['answer'],
        properties: { answer: { $ref: '#/definitions/answer' } },
        definitions: { answer: { type: 'string' } },
      },
    }),
  );
  expect(parseWorkerOutput(outputText(), contract).acceptance).toBe('satisfied');
});

it('requires nullable wire evidence fields and removes only their null values', () => {
  const contract = outputContract(workerSpec());
  expect(parseWorkerOutput(outputText(), contract).evidence).toEqual([
    { id: 'input', description: 'Read fixture' },
  ]);
  expect(
    parseWorkerOutput(
      outputText({
        evidence: [
          { id: 'input', description: 'Read fixture', uri: 'file:///fixture', revision: 'v1' },
        ],
      }),
      contract,
    ).evidence,
  ).toEqual([{ id: 'input', description: 'Read fixture', uri: 'file:///fixture', revision: 'v1' }]);
  expect(() =>
    parseWorkerOutput(
      outputText({ evidence: [{ id: 'input', description: 'Read fixture' }] }),
      contract,
    ),
  ).toThrow('schema');
});

it.each([
  { type: 'object', properties: { answer: { type: 'string' } }, additionalProperties: false },
  { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'] },
  { type: 'array', items: { type: 'object', properties: { item: { type: 'string' } } } },
  { anyOf: [{ type: 'object', properties: { item: { type: 'string' } } }] },
  { allOf: [{ type: 'string' }] },
])(
  'rejects known incompatible caller schemas without altering accepted values %#',
  (outputSchema) => {
    expect(() => outputContract(workerSpec({ outputSchema }))).toThrow('Worker value schema');
  },
);
