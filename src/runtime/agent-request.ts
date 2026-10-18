import type { LeadContext } from '../activation/types.js';
import { agentRequestSchema, agentSchema } from '../contracts/schema.js';
import type { JsonValue } from '../contracts/workflow.js';

export function resolveAgentRequest(
  value: JsonValue,
  context: Pick<LeadContext, 'model' | 'effort'>,
): JsonValue {
  const request = agentRequestSchema.parse(value);
  // Keep authored key order: older journals compare serialized host payloads.
  const resolved = { ...(value as Record<string, JsonValue>) };
  for (const field of ['model', 'effort'] as const) {
    if (request[field] !== undefined) continue;
    const inherited = context[field];
    if (typeof inherited !== 'string' || !inherited.trim())
      throw new Error(`Verified lead ${field} is unavailable for inheritance`);
    resolved[field] = inherited;
  }
  agentSchema.parse(resolved);
  return resolved;
}
