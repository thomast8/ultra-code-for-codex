# Workflow examples

These are raw QuickJS workflow bodies for `ultra_start.script`, not Node scripts or
engine presets. Each declares its argument contract and required `maxAgentCalls`
in a header. Supply the exact current context handle, immutable request ID,
existing authority and an honest lead-session capacity grant separately.

- `research.js`: discover up to two source questions, investigate only the returned
  questions, and pass evidence to the lead. Maximum three worker calls.
- `concepts.js`: compare two independent design lenses, preserving both results for
  the lead's decision. Maximum two worker calls.
- `coding.js`: one bounded implementation in a lead-prepared isolated worktree,
  followed by a lead handoff for required checks, real QA, review and publication.
  Maximum one worker call; the example does not waive independent review when required.

They illustrate selective delegation, not a fixed sequence or a claim that these
models are available in every installation. Resolve the live catalog and adapt
routing before submission. Do not change an already running script; create a new
linked run instead. A returned result with blocked or incomplete acceptance remains
visible. Final success requires evidence-backed lead resolution.

`test/workflow-examples.test.ts` executes all three bodies in the actual QuickJS
runtime with deterministic worker responses. Live QA is recorded separately in
[the acceptance ledger](../acceptance.md).
