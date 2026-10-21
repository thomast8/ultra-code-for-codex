# Workflow examples

These are contract version 1 workflow bodies for the internal engine. They are not
valid `ultra_start.script` input: `ultra_start` runs contract version 2, where
`agent(prompt, options?)` takes a string prompt. For chat workflows, follow the
installed authoring reference (`plugin/skills/ultra-code/references/authoring.md`),
whose two examples run through `ultra_start` in the test suite. Each body here
declares its argument contract and required `maxAgentCalls` in a header.

- `research.js`: discover up to two source questions, investigate only the returned
  questions, and pass evidence to the lead. Maximum three worker calls.
- `investigate-verify.js`: pipeline independent source questions through investigation
  and source-grounded verification. Maximum two calls per item; fast items advance
  while other investigations run.
- `concepts.js`: compare two independent design lenses, preserving both results for
  the lead's decision. Maximum two worker calls.
- `coding.js`: one bounded implementation in a lead-prepared isolated worktree,
  followed by a lead handoff for required checks, real QA, review and publication.
  Maximum one worker call; the example does not waive independent review when required.

The coding example is intentionally one coupled write assignment, not the default
shape for every request. Before selecting an example, identify independent work and
dependencies. Prepare useful independent checks together using `parallel()` and give
each only its source batch. Record the graph and the reason for a one-worker choice
with `log()`, and reserve only the lead and observed occupied slots. The authoring
reference includes a direct parallel wave for inputs that need no discovery worker.

They illustrate dynamic graphs, not a fixed team or sequence. Model and effort
inherit the frozen lead context unless `args.routing` explicitly overrides them.
Verify any override against the live catalog before submission. Do not change an already running script; create a new
linked run instead. A returned result with blocked or incomplete acceptance remains
visible. Final success requires evidence-backed lead resolution.

`test/workflow-examples.test.ts` executes all bodies in the actual QuickJS
runtime with deterministic worker responses. Live QA is recorded separately in
[the acceptance ledger](../acceptance.md).
