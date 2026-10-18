// Pass this complete body to ultra_start.script with maxAgentCalls: 2 * args.items.length.
// args: {cwd,sourceSetId,sourceIndex,items:[{id,question,sourceIds}],routing?:{model,effort}}.
log('Independent questions pipeline through investigation and source-grounded verification.');
const investigationPhase = phase('Investigate independent questions');
const verificationPhase = phase('Try to refute each finding');
const resources = [{ key: args.sourceSetId, mode: 'read', path: args.cwd }];
const assessment = {
  difficulty: 'Trace a bounded question through its original sources.',
  uncertainty: 'Preserve missing evidence and contradictions.',
  consequence: 'The lead must not present unsupported claims as established.',
  verificationBurden: 'A separate source check challenges each accepted investigation.',
  modelRationale: 'Inherit the lead route unless an explicit assignment override is supplied.',
  delegationBenefit: 'Independent items advance without waiting for unrelated investigations.',
  coordinationOverhead: 'Two calls per item and one lead coverage decision.',
};
function worker(item, stage, inputs, outputSchema) {
  return agent({
    phase: stage === 'Investigate' ? investigationPhase : verificationPhase,
    title: `${stage}: ${item.id}`,
    assignment: {
      outcome:
        stage === 'Investigate'
          ? 'Answer this question using only its supplied sources; cite exact evidence.'
          : 'Try to disprove the finding against the original sources. Report support, refutations and gaps.',
      inputs,
      ownership: { cwd: args.cwd, paths: [] },
      constraints: [
        'Read only the supplied source scope; do not assume another worker is correct.',
      ],
      acceptance: ['Every conclusion is source-grounded and required gaps are explicit.'],
      stopConditions: ['Required evidence is absent or cannot be read.'],
    },
    assessment,
    model: args.routing?.model,
    effort: args.routing?.effort,
    capability: 'read-only',
    resources,
    outputSchema,
  });
}
const results = await pipeline(args.items, async (item) => {
  const sources = args.sourceIndex.filter((source) => item.sourceIds.includes(source.id));
  const investigation = await worker(
    item,
    'Investigate',
    { question: item.question, sources },
    {
      type: 'object',
      additionalProperties: false,
      required: ['finding', 'sourceIds'],
      properties: {
        finding: { type: 'string' },
        sourceIds: { type: 'array', items: { type: 'string' } },
      },
    },
  );
  let verification = null;
  if (investigation.execution === 'completed' && investigation.acceptance === 'satisfied') {
    verification = await worker(
      item,
      'Verify',
      { question: item.question, finding: investigation.value, sources },
      {
        type: 'object',
        additionalProperties: false,
        required: ['supported', 'issues'],
        properties: {
          supported: { type: 'boolean' },
          issues: { type: 'array', items: { type: 'string' } },
        },
      },
    );
  }
  return { itemId: item.id, investigation, verification };
});
return await lead({
  phase: phase('Check coverage and resolve the evidence'),
  objective:
    'Inspect every saved investigation and verification. Check original sources, refutations, gaps and cross-item completeness against the user outcome. A completed worker or supported vote is not proof. Preserve unverified claims and resolve only the acceptance actually established.',
  resources,
  evidence: results.flatMap(({ investigation, verification }) => [
    ...investigation.evidence,
    ...(verification?.evidence ?? []),
  ]),
});
