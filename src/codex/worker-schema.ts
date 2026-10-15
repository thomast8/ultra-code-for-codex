import type { JsonValue } from '../contracts/workflow.js';

const schemaMaps = new Set([
  'definitions',
  '$defs',
  'properties',
  'patternProperties',
  'dependencies',
  'dependentSchemas',
]);
const schemaArrays = new Set(['allOf', 'anyOf', 'oneOf']);
const schemaValues = new Set([
  'additionalProperties',
  'additionalItems',
  'contains',
  'propertyNames',
  'not',
  'if',
  'then',
  'else',
  'unevaluatedProperties',
  'unevaluatedItems',
]);

// JSON Pointer references in a standalone value schema must still target that
// schema after it moves under the worker envelope's `value` property.
export function nestedValueSchema(schema: JsonValue, rebase = true): JsonValue {
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) return schema;
  const moveReferences = rebase && typeof schema.$id !== 'string';
  return Object.fromEntries(
    Object.entries(schema).map(([key, value]) => [key, nestedEntry(key, value, moveReferences)]),
  );
}

function nestedEntry(key: string, value: JsonValue, rebase: boolean): JsonValue {
  if (key === '$ref' && rebase && typeof value === 'string') return localReference(value);
  if (schemaMaps.has(key)) return nestedMap(value, rebase);
  if (schemaArrays.has(key) || key === 'items') return nestedItems(value, rebase);
  if (schemaValues.has(key)) return nestedValueSchema(value, rebase);
  return value;
}

function localReference(reference: string): string {
  return reference === '#' || reference.startsWith('#/')
    ? `#/properties/value${reference.slice(1)}`
    : reference;
}

function nestedMap(value: JsonValue, rebase: boolean): JsonValue {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, schema]) => [key, nestedValueSchema(schema, rebase)]),
  );
}

function nestedItems(value: JsonValue, rebase: boolean): JsonValue {
  return Array.isArray(value)
    ? value.map((schema) => nestedValueSchema(schema, rebase))
    : nestedValueSchema(value, rebase);
}
