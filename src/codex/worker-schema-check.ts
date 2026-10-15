import type { JsonValue } from '../contracts/workflow.js';
import { requireWorker } from './worker-protocol.js';

const unsupported = [
  'allOf',
  'oneOf',
  'not',
  'dependentRequired',
  'dependentSchemas',
  'if',
  'then',
  'else',
];

function isObject(value: JsonValue | undefined): value is { [key: string]: JsonValue } {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// The public structured-output protocol requires closed objects and every
// property present. Reject incompatible caller schemas instead of changing
// which caller values are accepted.
export function verifyStructuredSchema(schema: JsonValue): void {
  if (!isObject(schema)) return;
  requireWorker(
    !unsupported.some((key) => key in schema),
    'Worker value schema uses unsupported structured-output composition',
  );
  if (
    schema.type === 'object' ||
    (Array.isArray(schema.type) && schema.type.includes('object')) ||
    schema.properties !== undefined
  )
    verifyObjectSchema(schema);
  verifySchemaChildren(schema);
}

function verifySchemaChildren(schema: { [key: string]: JsonValue }): void {
  for (const key of ['properties', 'definitions', '$defs']) {
    const map = schema[key];
    if (isObject(map)) for (const value of Object.values(map)) verifyStructuredSchema(value);
  }
  if (schema.items !== undefined) verifyStructuredSchema(schema.items);
  if (Array.isArray(schema.anyOf)) for (const value of schema.anyOf) verifyStructuredSchema(value);
}

function verifyObjectSchema(schema: { [key: string]: JsonValue }): void {
  requireWorker(
    schema.additionalProperties === false,
    'Worker value schema objects must set additionalProperties:false',
  );
  const properties = isObject(schema.properties) ? Object.keys(schema.properties) : [];
  const required = schema.required;
  requireWorker(
    Array.isArray(required) && properties.every((key) => required.includes(key)),
    'Worker value schema must require every declared object property',
  );
}
