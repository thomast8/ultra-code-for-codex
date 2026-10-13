// Pass this complete body to ultra_start.script with maxAgentCalls: 3.
// args: {cwd, sourceSetId, sourceIndex}; sourceIndex contains bounded {id,excerpt} records.
const sourceClaims = [{ key: args.sourceSetId, mode: 'read', path: args.cwd }];
const assessment = {
  difficulty: 'Extract bounded facts from a supplied source index.',
  uncertainty: 'Report missing or conflicting source coverage explicitly.',
  consequence: 'Read-only evidence gathering; the lead decides what follows.',
  verificationBurden: 'The lead checks cited records against the requested outcome.',
  modelRationale: 'Luna is sufficient for short, source-bound extraction.',
  delegationBenefit: 'Independent source checks can proceed while the lead integrates other work.',
  coordinationOverhead: 'At most three bounded calls and one evidence-based lead decision.',
};
const discovery = await agent({
  phase: phase('Find independent questions'),
  title: 'Identify up to two source questions',
  assignment: {
    outcome:
      'Identify at most two distinct factual questions worth checking in the supplied sources.',
    inputs: args.sourceIndex,
    ownership: { cwd: args.cwd, paths: [] },
    constraints: [
      'Use the supplied source index; do not repeat an existing completed investigation.',
    ],
    acceptance: ['Each question names its source IDs and can be checked independently.'],
    stopConditions: ['Required sources are absent, ambiguous or outside the supplied scope.'],
  },
  assessment,
  model: 'gpt-6-luna',
  effort: 'medium',
  capability: 'read-only',
  resources: sourceClaims,
  outputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['questions'],
    properties: {
      questions: {
        type: 'array',
        maxItems: 2,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['question', 'sourceIds'],
          properties: {
            question: { type: 'string' },
            sourceIds: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
  },
});
let checks = [];
if (discovery.execution === 'completed' && discovery.acceptance === 'satisfied') {
  const checking = phase('Check the selected sources');
  checks = await pipeline(discovery.value.questions, (question) =>
    agent({
      phase: checking,
      title: question.question,
      assignment: {
        outcome: 'Answer only this factual question with precise source references.',
        inputs: {
          question,
          sources: args.sourceIndex.filter((source) => question.sourceIds.includes(source.id)),
        },
        ownership: { cwd: args.cwd, paths: [] },
        constraints: ['Do not investigate another worker’s question or fetch new remote sources.'],
        acceptance: ['Every finding is tied to the supplied source IDs; gaps remain explicit.'],
        stopConditions: ['The cited source is missing or does not support an answer.'],
      },
      assessment,
      model: 'gpt-6-luna',
      effort: 'medium',
      capability: 'read-only',
      resources: sourceClaims,
      outputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['finding'],
        properties: { finding: { type: 'string' } },
      },
    }),
  );
}
log('Source checks have returned; retain incomplete results for lead verification.');
return await lead({
  phase: phase('Verify the research outcome'),
  objective:
    'Read this run’s discovery and source-check results. Verify coverage, citations and unresolved items against the user’s original question; synthesize only what the evidence supports. Do not rerun completed investigations.',
  resources: sourceClaims,
  evidence: [discovery, ...checks].flatMap((result) => result.evidence),
});
