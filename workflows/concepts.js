// Pass this complete body to ultra_start.script with maxAgentCalls: 2.
// args: optional routing {model,effort}; other args: {cwd, brief, lenses:[first,second]}; choose distinct lenses before launch.
if (
  !Array.isArray(args.lenses) ||
  args.lenses.length !== 2 ||
  args.lenses.some((lens) => typeof lens !== 'string' || !lens.trim()) ||
  args.lenses[0] === args.lenses[1]
) {
  throw new Error('Supply exactly two distinct concept lenses or keep the task with the lead.');
}
const developing = phase('Develop two alternatives');
const alternatives = await parallel(
  args.lenses.map(
    (lens) => () =>
      agent({
        phase: developing,
        title: `Develop the ${lens} alternative`,
        assignment: {
          outcome: 'Develop one concrete alternative from this lens without seeing sibling drafts.',
          inputs: { brief: args.brief, lens },
          ownership: { cwd: args.cwd, paths: [] },
          constraints: [
            'Use the frozen brief; do not rewrite its requirements or commission additional agents.',
          ],
          acceptance: [
            'Explain a concrete user flow, relevant trade-offs and unresolved assumptions.',
          ],
          stopConditions: [
            'A missing requirement changes the intended outcome or requires new authority.',
          ],
        },
        assessment: {
          difficulty: 'Synthesize a coherent alternative across several product constraints.',
          uncertainty: 'Design assumptions need explicit comparison, not majority voting.',
          consequence: 'Options only; the lead owns selection and validation.',
          verificationBurden: 'Compare each option with the same brief and acceptance criteria.',
          modelRationale:
            'Inherit the captured lead route for synthesis unless deliberately overridden.',
          delegationBenefit: 'Two isolated alternatives reduce anchoring on one early draft.',
          coordinationOverhead: 'Two independent proposals feed an evidence-based lead comparison.',
        },
        model: args.routing?.model,
        effort: args.routing?.effort,
        capability: 'read-only',
        resources: [],
        outputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['concept', 'tradeoffs', 'openQuestions'],
          properties: {
            concept: { type: 'string' },
            tradeoffs: { type: 'array', items: { type: 'string' } },
            openQuestions: { type: 'array', items: { type: 'string' } },
          },
        },
      }),
  ),
);
return await lead({
  phase: phase('Choose against the brief'),
  objective:
    'Inspect both stored alternatives and their unresolved assumptions. Select, combine or reject them against the original brief. Verify the resulting proposal and record evidence; two agreeing agents do not establish correctness.',
  resources: [],
  evidence: alternatives.flatMap((result) => result.evidence),
});
