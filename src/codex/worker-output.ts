import Ajv from 'ajv';
import type { ValidateFunction } from 'ajv';
import type { AgentSpec, ArtifactRef, JsonValue } from '../contracts/workflow.js';
import { requireWorker, WorkerBlocked } from './worker-protocol.js';
import { nestedValueSchema } from './worker-schema.js';
import { verifyStructuredSchema } from './worker-schema-check.js';

export type WorkerOutput = {
  acceptance: 'satisfied' | 'incomplete' | 'blocked';
  value: JsonValue;
  evidence: ArtifactRef[];
  unresolved: string[];
};
type WireEvidence = {
  id: string;
  description: string;
  uri: string | null;
  revision: string | null;
};
type WireOutput = Omit<WorkerOutput, 'evidence'> & { evidence: WireEvidence[] };
export type OutputContract = { schema: JsonValue; validate: ValidateFunction<WireOutput> };

export function outputContract(spec: AgentSpec): OutputContract {
  requireWorker(
    Buffer.byteLength(JSON.stringify(spec.outputSchema)) <= 65_536,
    'Worker value schema exceeds the 64 KiB bound',
  );
  verifyStructuredSchema(spec.outputSchema);
  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['acceptance', 'value', 'evidence', 'unresolved'],
    properties: {
      acceptance: { enum: ['satisfied', 'incomplete', 'blocked'] },
      value: nestedValueSchema(spec.outputSchema),
      evidence: {
        type: 'array',
        maxItems: 100,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'description', 'uri', 'revision'],
          properties: {
            id: { type: 'string', minLength: 1, maxLength: 256 },
            description: { type: 'string', minLength: 1, maxLength: 4096 },
            uri: { type: ['string', 'null'], minLength: 1, maxLength: 4096 },
            revision: { type: ['string', 'null'], minLength: 1, maxLength: 256 },
          },
        },
      },
      unresolved: {
        type: 'array',
        maxItems: 100,
        items: { type: 'string', minLength: 1, maxLength: 4096 },
      },
    },
  };
  try {
    return { schema, validate: new Ajv({ allErrors: true }).compile<WireOutput>(schema) };
  } catch {
    throw new WorkerBlocked('Worker output schema could not be compiled');
  }
}

export function parseWorkerOutput(text: string | null, contract: OutputContract): WorkerOutput {
  requireWorker(
    text !== null && Buffer.byteLength(text) <= 262_144,
    'Worker final output is missing or exceeds the bound',
  );
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new WorkerBlocked('Worker final output is not valid JSON');
  }
  requireWorker(contract.validate(value), 'Worker final output does not satisfy its schema');
  requireWorker(
    value.acceptance !== 'satisfied' || value.unresolved.length === 0,
    'Worker claimed acceptance with unresolved work',
  );
  return {
    ...value,
    evidence: value.evidence.map((entry) => ({
      id: entry.id,
      description: entry.description,
      ...(entry.uri === null ? {} : { uri: entry.uri }),
      ...(entry.revision === null ? {} : { revision: entry.revision }),
    })),
  };
}

export function workerPrompt(spec: AgentSpec): string {
  const { outcome, inputs, ownership, constraints, acceptance, stopConditions } = spec.assignment;
  const assignment = JSON.stringify({
    outcome,
    inputs,
    ownership,
    constraints,
    acceptance,
    stopConditions,
  });
  requireWorker(
    Buffer.byteLength(assignment) <= 65_536,
    'Worker assignment exceeds the 64 KiB bound',
  );
  const commands =
    spec.capability === 'read-only'
      ? 'Read-only execution cannot create temporary files. Do not use shell heredocs, here-strings, output redirection or temporary scripts; use commands such as python3 -c with quoted inline source that require no file writes. '
      : '';
  return `Complete only this bounded assignment. Follow the stated ownership and stop conditions. ${commands}Do not delegate or request escalation. Return the required JSON envelope. Report acceptance as satisfied only with evidence that every acceptance condition holds and an empty unresolved array; otherwise report incomplete or blocked and list unfinished assignment work. Put completed review findings in value; missing evidence or checks required for acceptance belong in unresolved. The unresolved array is for unfinished assignment work, not findings from a completed review. The value field must satisfy the supplied value schema.\n${assignment}`;
}
