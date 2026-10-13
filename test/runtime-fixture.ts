import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vi } from 'vitest';
import type {
  AgentSpec,
  ExecuteWorker,
  RunAuthority,
  StartRequest,
  TaskResult,
  WorkerOptions,
} from '../src/contracts/workflow.js';
import { WorkflowEngine } from '../src/runtime/engine.js';

export const authority: RunAuthority = {
  context: {
    instanceId: 'instance',
    sessionId: 'lead',
    turnId: 'turn',
    cwd: '/tmp',
    model: 'lead-model',
    effort: 'high',
    collaborationMode: 'default',
    resolutionStatus: 'verified',
    resolutionReason: 'fixture',
  },
  capacity: {
    source: 'lead-session',
    totalSlots: 3,
    reservedSlots: 1,
    evidence: 'fixture lead grant',
  },
};
export const owner = { instanceId: 'instance', sessionId: 'lead' };
export const spec: AgentSpec = {
  phase: { id: 'phase-1', label: 'Discover' },
  title: 'Inspect',
  assignment: {
    outcome: 'Find entries',
    inputs: null,
    ownership: { cwd: '/tmp', paths: [] },
    constraints: [],
    acceptance: ['Return entries'],
    stopConditions: ['No access'],
  },
  assessment: {
    difficulty: 'small',
    uncertainty: 'low',
    consequence: 'low',
    verificationBurden: 'inspect',
    modelRationale: 'enough',
    delegationBenefit: 'parallel',
    coordinationOverhead: 'small',
  },
  model: 'small',
  effort: 'low',
  capability: 'read-only',
  resources: [],
  outputSchema: {},
};
export const args = { spec } as unknown as StartRequest['args'];
export function request(script = 'return 7;', extra: Partial<StartRequest> = {}): StartRequest {
  return {
    requestId: 'request',
    contextKey: 'context',
    authorityRef: 'authority',
    title: 'Workflow',
    objective: 'Test durable execution',
    acceptance: ['Inspect returned evidence'],
    script,
    args,
    maxAgentCalls: 20,
    ...extra,
  };
}
export function output(
  value: TaskResult['value'] = 1,
  extra: Partial<TaskResult> = {},
): TaskResult {
  return {
    execution: 'completed',
    acceptance: 'unverified',
    value,
    evidence: [],
    unresolved: [],
    usage: null,
    requestedModel: 'small',
    reportedModel: 'small',
    ...extra,
  };
}
export function harness() {
  const calls: { spec: AgentSpec; options: WorkerOptions; finish: (result: TaskResult) => void }[] =
    [];
  const execute: ExecuteWorker = vi.fn(
    (task, options) =>
      new Promise<TaskResult>((resolve) => {
        calls.push({ spec: task, options, finish: resolve });
        options.signal.addEventListener(
          'abort',
          () => resolve(output(null, { execution: 'interrupted' })),
          { once: true },
        );
      }),
  );
  const dataDir = mkdtempSync(join(tmpdir(), 'ultra-runtime-'));
  const engine = new WorkflowEngine({ dataDir, executeWorker: execute });
  return { dataDir, engine, calls, execute };
}
export async function until(predicate: () => boolean): Promise<void> {
  await vi.waitFor(
    () => {
      if (!predicate()) throw new Error('Waiting for runtime');
    },
    { timeout: 4000, interval: 5 },
  );
}
export const single = 'const p = phase("Discover"); return await agent({...args.spec, phase:p});';
