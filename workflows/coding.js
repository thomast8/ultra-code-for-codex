// Pass this complete body to ultra_start.script with maxAgentCalls: 1.
// args: {worktree,worktreeKey,paths,change,context,constraints,acceptance,stopConditions}.
// The lead prepares the linked worktree and resolves repository quality gates first.
const ownership = { cwd: args.worktree, paths: args.paths };
const lease = [{ key: args.worktreeKey, mode: 'write', path: args.worktree }];
const implementation = await agent({
  phase: phase('Implement the bounded change'),
  title: args.change,
  assignment: {
    outcome: args.change,
    inputs: args.context,
    ownership,
    constraints: [
      ...args.constraints,
      'You are not alone in the codebase. Preserve unrelated edits and remain inside the assigned scope.',
      'Follow repository guidance and mandatory checks without weakening gates or bypassing hooks.',
      'Do not commit, push, publish, merge, deploy, contact colleagues or create more workers.',
    ],
    acceptance: args.acceptance,
    stopConditions: [
      ...args.stopConditions,
      'Stop and report if the root cause needs a scope expansion, unavailable dependency or additional authority.',
    ],
  },
  assessment: {
    difficulty: 'Implement one resolved design across its known callers and tests.',
    uncertainty:
      'The lead supplies the design; any new architectural ambiguity returns to the lead.',
    consequence: 'Local edits in one isolated worktree, with no external publication authority.',
    verificationBurden:
      'Focused worker checks plus required lead real-system QA and repository review.',
    modelRationale:
      'Sol is appropriate for interacting code paths; routine extraction would use Luna.',
    delegationBenefit:
      'This bounded change is independent enough for the lead to progress other work.',
    coordinationOverhead:
      'One implementation result and one lead verification; no speculative review team.',
  },
  model: 'gpt-6.1-sol',
  effort: 'high',
  capability: 'workspace-write',
  resources: lease,
  outputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['changedFiles', 'checks', 'remainingQA'],
    properties: {
      changedFiles: { type: 'array', items: { type: 'string' } },
      checks: { type: 'array', items: { type: 'string' } },
      remainingQA: { type: 'array', items: { type: 'string' } },
    },
  },
});
return await lead({
  phase: phase('Verify and integrate'),
  objective:
    'Inspect the stored implementation result and actual diff. Complete required real-system QA and repository review, address valid findings, then integrate and perform any already-authorized publication with readback. Preserve incomplete acceptance and blockers; worker completion alone does not make the change ready.',
  resources: lease,
  evidence: implementation.evidence,
});
