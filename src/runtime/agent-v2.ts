import { realpathSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { agentSchema, agentV2Schema, leadV2Schema } from '../contracts/schema.js';
import type { AgentSpec, JsonValue, LeadHandoffSpec, PhaseRef } from '../contracts/workflow.js';
import { outputContract } from '../codex/worker-output.js';
import type { RunRecord } from './types.js';

function workspace(path: string): string {
  if (!isAbsolute(path)) throw new Error('Worker cwd must be absolute');
  const canonical = realpathSync(path);
  if (!statSync(canonical).isDirectory()) throw new Error('Worker cwd must be a directory');
  return canonical;
}

function phase(run: RunRecord, label: string): PhaseRef {
  const existing = run.snapshot.phases.find((item) => item.label === label);
  if (existing) return existing;
  const created = { id: `phase-${run.snapshot.phases.length + 1}`, label };
  run.snapshot.phases.push(created);
  return created;
}

export function resolveAgentV2(value: JsonValue, run: RunRecord): JsonValue {
  const { prompt, options } = agentV2Schema.parse(value);
  return normalizedAgent(prompt, options ?? {}, run) as unknown as JsonValue;
}

export function resolveLeadV2(value: JsonValue, run: RunRecord): JsonValue {
  const { objective, evidence } = leadV2Schema.parse(leadCall(value));
  const spec: LeadHandoffSpec = {
    kind: run.authority.context.collaborationMode === 'plan' ? 'planning' : 'action',
    phase: phase(run, 'Lead review'),
    objective,
    resources: [],
    evidence: (evidence ?? []).map((item) => ({
      id: item.id,
      description: item.description,
      ...(item.uri ? { uri: item.uri } : {}),
      ...(item.revision ? { revision: item.revision } : {}),
    })),
  };
  return spec as unknown as JsonValue;
}

/** Forgive the shapes a chat-authored script commonly uses for lead(). */
function leadCall(value: JsonValue): JsonValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  let { objective, evidence } = value;
  if (objective && typeof objective === 'object' && !Array.isArray(objective)) {
    evidence = objective.evidence ?? evidence;
    objective = objective.objective ?? null;
  }
  if (!Array.isArray(evidence)) return { objective, evidence } as JsonValue;
  return {
    objective,
    evidence: evidence.map((item, index) => artifact(item, index)),
  } as JsonValue;
}

function artifact(item: JsonValue, index: number): JsonValue {
  if (
    item &&
    typeof item === 'object' &&
    !Array.isArray(item) &&
    typeof item.id === 'string' &&
    typeof item.description === 'string'
  )
    return item;
  const id = `evidence-${index + 1}`;
  if (item === null || item === undefined)
    return { id, description: 'Worker result unavailable: terminal failure or null' };
  const description = (typeof item === 'string' ? item : JSON.stringify(item)).trim();
  return {
    id,
    description: description ? description.slice(0, 32_768) : 'Worker returned empty output',
  };
}

function normalizedAgent(
  prompt: string,
  options: NonNullable<ReturnType<typeof agentV2Schema.parse>['options']>,
  run: RunRecord,
): AgentSpec {
  const { cwd, capability, model, effort } = workerSettings(options, run);
  const workerPrompt = run.sourceEvidence?.length
    ? `${prompt}\n\nAuthorized saved evidence:\n${run.sourceEvidence.join('\n\n')}`
    : prompt;
  const promptBytes = Buffer.byteLength(workerPrompt);
  if (promptBytes > 65_536)
    throw new Error(`Worker prompt is ${promptBytes} bytes; limit is 65536 bytes`);
  const spec: AgentSpec = {
    format: options.schema ? 'json' : 'plain',
    prompt: workerPrompt,
    ...(run.continuation ? { resumeThreadId: run.continuation.threadId } : {}),
    phase: phase(run, options.phase ?? 'Work'),
    title: options.label ?? prompt.slice(0, 120),
    assignment: {
      outcome: prompt,
      inputs: null,
      ownership: { cwd, paths: [] },
      constraints: [],
      acceptance: ['Lead review required'],
      stopConditions: ['Stop on authority or permission failure'],
    },
    model,
    effort,
    assessment: {
      difficulty: 'Not assessed',
      uncertainty: 'Not assessed',
      consequence: 'Not assessed',
      verificationBurden: 'Lead review',
      modelRationale: 'Inherited unless overridden',
      delegationBenefit: 'Not assessed',
      coordinationOverhead: 'Not assessed',
    },
    capability,
    resources: [
      {
        key: `workspace:${cwd}`,
        mode: capability === 'workspace-write' ? 'write' : 'read',
        path: cwd,
      },
    ],
    outputSchema: options.schema ?? {},
  };
  agentSchema.parse(spec);
  outputContract(spec);
  return spec;
}

function workerSettings(
  options: NonNullable<ReturnType<typeof agentV2Schema.parse>['options']>,
  run: RunRecord,
) {
  const cwd = workspace(options.cwd ?? run.continuation?.cwd ?? run.authority.context.cwd);
  const capability = options.access ?? run.continuation?.capability ?? 'read-only';
  verifyContinuation(run, cwd, capability);
  return {
    cwd,
    capability,
    model: options.model ?? run.authority.context.model,
    effort: options.effort ?? run.authority.context.effort,
  };
}

function verifyContinuation(
  run: RunRecord,
  cwd: string,
  capability: AgentSpec['capability'],
): void {
  if (!run.continuation) return;
  if (cwd !== run.continuation.cwd || capability !== run.continuation.capability)
    throw new Error('Continuation must retain the original workspace and access');
}
