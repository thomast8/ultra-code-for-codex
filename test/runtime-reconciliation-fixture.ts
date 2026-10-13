import { expect } from 'vitest';
import type { LeadResult } from '../src/contracts/workflow.js';
import type { WorkflowEngine } from '../src/runtime/engine.js';
import { authority, owner } from './runtime-fixture.js';

export const receipt: LeadResult = {
  acceptance: 'incomplete',
  value: { terminationConfirmed: true, writesReconciled: true },
  evidence: [{ id: 'readback', description: 'Verified worker termination and resulting revision' }],
  revision: 'reviewed-revision',
};

export function rejectUnsafeResolutions(engine: WorkflowEngine, id: string): void {
  const invalid: LeadResult[] = [
    { ...receipt, evidence: [] },
    { ...receipt, acceptance: 'blocked' },
    { ...receipt, value: { terminationConfirmed: false, writesReconciled: true } },
    { ...receipt, value: { terminationConfirmed: true, writesReconciled: false } },
    { ...receipt, value: { terminationConfirmed: true } },
    {
      ...receipt,
      value: { terminationConfirmed: true, writesReconciled: true, command: 'not allowed' },
    },
  ];
  for (const resolution of invalid)
    expect(() => engine.handoff(owner, id, 'resolve', authority.context, resolution)).toThrow();
}
