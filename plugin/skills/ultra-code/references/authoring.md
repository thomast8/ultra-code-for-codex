# Writing a workflow

The selected chat remains the lead. The runtime executes an immutable JavaScript body, records its calls and results, and schedules bounded workers. It has no research, concepts or coding presets. The repository examples are ordinary scripts with illustrative phase labels.

## Executable contract

The script runs inside QuickJS, not Node. It has no filesystem, network, imports, process, timers or automatic tool discovery. `Date` and `Math.random` are unavailable. Local variables, bounded loops and conditionals are ordinary JavaScript. Return a JSON value.

Use these typed host calls. The submitted script is plain JavaScript; type
annotations, imports, Markdown fences, paths and prose are not script bodies.

- `phase(label: string): PhaseRef` returns a frozen `{id, label}`; pass that exact reference onward.
- `log(value: JSON value): void` accepts a nonempty string or any other JSON value. Strings are saved unchanged; other values are saved as JSON text. The final saved text is limited to 32,768 UTF-16 code units.
- `agent(spec: AgentRequest): Promise<TaskResult>` accepts the worker contract below; model and effort may be omitted.
- `lead(spec: LeadHandoffSpec): Promise<LeadResult>` waits for the selected lead's evidence-backed resolution.
- `parallel<T>(factories: Array<() => T | Promise<T>>): Promise<T[]>` starts factories and returns results in input order.
- `pipeline<T, R>(items: T[], fn: (item: T, index: number) => R | Promise<R>): Promise<R[]>` runs independent items concurrently.

`log('Checking the source evidence')`, `log(plan)`, and `log(JSON.stringify(plan))` are valid.
`parallel()` takes factories, not
already-started promises; `pipeline()` runs item functions concurrently, so put
sequential awaits inside each function for dependent stages.

## Keep evidence bounded

`log()` is a progress journal, not report storage. Log short routing decisions,
counts, execution/acceptance states and evidence IDs. Never log an entire worker
result or an array of reports. Each log's final saved text is limited to 32,768 UTF-16 code units (`string.length`): strings retain their original text, and other JSON values are measured after JSON serialization.

The JSON serialization of all six `assignment` fields together must fit within
65,536 UTF-8 bytes. This includes ownership, constraints, acceptance and stop
conditions, not just `inputs`. Leave room for that metadata. Measure serialized UTF-8 size outside QuickJS before
submission; JavaScript string length is not a byte count. Forward only the
specific claims a dependent worker needs, with row IDs, source paths, revisions
and short relevant extracts. Set appropriate output-schema `maxLength` and
`maxItems` bounds before dispatch; request concise findings with source citations.
Do not copy complete TaskResults or concatenate partition reports into a critic's
assignment. Preserve coverage in the saved results; narrow the next check rather
than silently truncating required findings.

Evidence IDs and `parentRunId` retain lineage; they do not automatically load
reports into a worker. Workers cannot call `ultra_result` or other MCP tools.
The lead reads saved results, then supplies bounded claims and accessible original
source references. If an authorized local evidence file is needed, the lead must
write it outside the immutable script, verify the actual path is readable by the
worker, and pass its path and revision. QuickJS cannot write files. Plan Mode must
keep project files read-only and use only an already-authorized artifact location.

Before starting, check every authored host-call shape against this reference and
bound the planned logs and dependent assignments. On an execution error, stop new
dispatch and report the failed attempt. Preserve saved results; do not chain
corrective workflows unless recovery is authorized. A recovery never makes the
original attempt a first-pass success.

## Inspect the actual source revision

Source references from a report or CSV may describe an older revision. Before a
worker reads or searches explicit paths, verify them against the current file
inventory (`rg --files` or `git ls-files`). Use revision and rename history to
locate current equivalents. An absent historical path is evidence to investigate,
not proof that its finding is fixed. Keep missing or ambiguous mappings explicit.
Do not pass unverified paths to a multi-file search: a missing input can make the
whole command exit with an error even while other inputs produce useful matches.

Keep source reads bounded with targeted matches or line ranges. Avoid combining
unrelated guidance, implementation and test reads into one oversized command.
When a command fails, retain its specific operation, exit code and sanitized error
diagnostic in the worker result; preserve source and secret-value restrictions.
Do not replace the diagnostic with “output truncated” or increase the output
limit to dump the entire source. Honor the user's failure/stop conditions and
keep any authorized repair separate from a first-attempt success.

## Choose the assignment graph first

For each requested outcome, identify independent inputs and questions before choosing
the worker ceiling. Keep real dependencies sequential, and start ready independent
assignments together. For example, partition fourteen transcripts into nonoverlapping
batches with the same extraction contract while the lead reads authenticated course
pages. Pass only each batch's sources and shared definitions to its worker; the lead
compares the returned evidence. Do not replicate the full corpus in every assignment.
Choose the number of batches from useful coverage, dependencies and observed capacity, not a fixed
agent count. A single coupled patch in one writable worktree can remain one assignment.

Record that decision using `log()` before dispatch. Include dependencies, the reason
for the partition, and actual capacity reservations. Reserve the lead plus observed
occupied slots, not a spare slot with no workload. `maxAgentCalls` covers the resulting
graph, not just the first call. A one-worker plan must name the dependency
reason that makes parallel work unhelpful.

The following complete script illustrates a ready read-only wave and a lead review.
Choose the questions, sources and graph for the actual task; this is not a fixed
team or required sequence. Supply JSON args with `cwd` (canonical absolute root),
`capacityNote` (string describing the observed reservation), and `questions`
(array of `{title, question, sourcePath}` records with actual source paths).
Set `maxAgentCalls` to the number of questions for this example.

```js
log(
  JSON.stringify({
    assignments: args.questions.map((question) => question.title),
    dependencies: 'Independent source checks, then lead comparison',
    reservation: args.capacityNote,
  }),
);
const checks = phase('Independent source checks');
const results = await parallel(
  args.questions.map(
    (question) => () =>
      agent({
        phase: checks,
        title: question.title,
        assignment: {
          outcome: question.question,
          inputs: { sourcePath: question.sourcePath },
          ownership: { cwd: args.cwd, paths: [] },
          constraints: ['Read only the supplied source; do not change files or fetch evidence.'],
          acceptance: [
            'Cite exact source locations and distinguish findings from missing evidence.',
          ],
          stopConditions: ['The supplied source is missing or cannot support the requested check.'],
        },
        assessment: {
          difficulty: 'Bounded source investigation',
          uncertainty: 'The source may not establish an answer',
          consequence: 'Unsupported claims would mislead the final comparison',
          verificationBurden: 'Lead checks original sources and counterevidence',
          modelRationale: 'Inherit the captured lead model and effort',
          delegationBenefit: 'Independent source questions can run together',
          coordinationOverhead: 'One bounded report per question and one lead review',
        },
        capability: 'read-only',
        resources: [],
        outputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['report'],
          properties: { report: { type: 'string', maxLength: 8000 } },
        },
      }),
  ),
);
return await lead({
  kind: 'planning',
  phase: phase('Compare and verify the evidence'),
  objective:
    'Inspect every saved TaskResult, including failures. Check original sources, counterevidence and coverage against the user outcome; resolve only the acceptance established.',
  resources: [],
  evidence: results.flatMap((result) => result.evidence),
});
```

The script passes a **string** to `log()` by serializing its structured plan.
`agent()` returns the complete TaskResult envelope, not just `value`; inspect both
execution and acceptance before consuming a dependent result. Claim the handoff
when review begins and resolve it against actual evidence. A failed or incomplete
worker does not become successful because the script reached the handoff.

## Start and wait

Call `ultra_start` with these fields:

| Field                              | Contract                                                                                                                                                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `requestId`                        | Stable identifier for this exact start. Identical retries return the same run; changed payloads under that identifier fail.                                                                                                    |
| `contextKey`                       | Exact verified current-turn handle from the hook and `ultra_context`. Never reuse another chat's handle.                                                                                                                       |
| `title`, `objective`, `acceptance` | Concrete requested outcome and at least one observable completion condition.                                                                                                                                                   |
| `script`                           | Complete JavaScript body as text, up to 262,144 characters. File paths and module imports are not accepted in place of source.                                                                                                 |
| `args`                             | JSON inputs; deeply frozen inside the script. Keep evidence bounded and reusable.                                                                                                                                              |
| `maxAgentCalls`                    | Integer 1–1,000; includes every worker call on every branch, including author-written retries. This is a ceiling, not a target.                                                                                                |
| `authorityRef`                     | Reference to the existing user authorization. It does not create additional authority.                                                                                                                                         |
| `capacity`                         | `{source:"lead-session", totalSlots, reservedSlots, evidence}`. Positive integer slots; reserve at least the lead, and leave at least one worker slot. Use the observed session capacity and account for other occupied slots. |
| `parentRunId`, `evidenceRefs`      | Optional continuation link and reusable `{id, description, uri?, revision?}` references. Parent ownership is checked.                                                                                                          |
| `budget`                           | Optional `{maxObservedTokens: positiveInteger}`. Crossing produces a durable warning and blocks later worker admission. Active workers finish, so this is not a hard token or monetary cap.                                    |

Use `ultra_wait({contextKey, afterCursor, runIds?, timeoutMs?})` with the latest returned cursor. The timeout is at most 25,000 ms. Routine activity and token updates do not trigger a meaningful-event return; a threshold crossing does. A timeout is not a failure or a reason to restart work. Use `ultra_status({contextKey, runIds?})` for snapshots and `ultra_result({contextKey, runId, taskId?})` for saved results. The bound panel uses its opaque nonce for reads and its app-only `ultra_panel_control` buttons. The model must not use panel nonces as execution authority.

`ultra_control({contextKey, runId, action})` accepts `pause`, `resume` or `cancel`. Pause stops new dispatch; an already-running worker can continue. Cancel interrupts active work and preserves edits. Uncertain writes and interrupted claimed handoffs require readback; they are not automatically repeated. Controls are per run. Model-side resume requires a verified current Default-mode context; Plan or unknown mode cannot resume. Explicit panel-button controls retain the original run authority.

Replay requires the same host calls and payloads in the same order. Completed calls reuse journaled results. Do not mutate a launched script, add nondeterministic inputs, or bypass exposed functions. A changed strategy is a new run with a fresh `requestId`, optional `parentRunId` and saved evidence references. Incomplete or uncertain calls need explicit reconciliation.

## Worker contracts and quality assessment

`agent()` returns a `TaskResult`, not a task snapshot. Its fields are `execution`,
`acceptance`, `value`, `evidence`, `unresolved`, `usage`, `requestedModel`,
`reportedModel` and optional `error`. There is no `taskId` or `id` on this return
value. Use `result.evidence` directly in a handoff; obtain task IDs from
`ultra_status` when needed. Do not invent an artifact ID from an undefined field
or put the serialized worker result into the handoff objective.

```js
const sourceCheck = phase('Check the supplied source');
const result = await agent({ ...args.spec, phase: sourceCheck });
return await lead({
  kind: 'planning',
  phase: phase('Lead verifies the source findings'),
  objective: 'Verify the saved worker result and prepare the requested plan.',
  resources: [],
  evidence: result.evidence,
});
```

If a later script step fails after a worker returns, preserve the failed run and
read its saved result. Continue with a linked run and valid evidence references;
do not repeat the investigation to repair a handoff or formatting mistake.

`agent(spec)` has the following field map. This is not a script body; use the
complete executable example above and supply task-specific inputs:

```js
{
  phase, title,
  assignment: {
    outcome,                 // one concrete result
    inputs,                  // bounded JSON evidence or references
    ownership: {cwd, paths}, // canonical absolute root and owned absolute paths
    constraints,             // explicit scope and behavior limits
    acceptance,              // nonempty observable conditions
    stopConditions           // nonempty reasons to stop and report
  },
  assessment: {
    difficulty, uncertainty, consequence, verificationBurden,
    modelRationale, delegationBenefit, coordinationOverhead
  },
  model, effort,             // optional independently; inherit the frozen lead context
  capability,                // "read-only" or "workspace-write"
  resources,                 // resource claims below
  outputSchema,              // JSON Schema for the result's value field only
  timeoutMs                  // optional, default 300,000; 1,000–3,600,000
}
```

Omit model and effort to inherit each field independently from the run's frozen,
verified lead context. An explicit override replaces only that field. Choose an
override for the assignment's needs, with a concrete rationale; do not default to
a smaller model to justify delegation. The backend checks the live model catalog,
requested effort and reported selection. An unavailable pair blocks the worker;
it never silently substitutes another route. A new request requires an explicit
choice. Existing concrete calls and saved results retain their original routes.

The worker deadline is a hard wall-time bound from turn dispatch, not an inactivity
timeout. Choose an explicit deadline when the assignment needs a different bound;
ongoing activity does not extend it. Command transport frames are bounded at
16 MiB; final worker output remains bounded at 256 KiB. A transport failure keeps
termination uncertain until actual readback, even when its failure category is known.

The assessment records the reasoning at admission. Do not rewrite it after seeing results to imply a better prediction. Count total worker context, outputs, retries, duplicated reading, lead verification and coordination when evaluating value. Usage can be unknown. Run `accountingComplete` refers only to worker attempts; it never includes main-chat overhead. Cached input is part of input, and reasoning output is part of output; do not add those subsets again. No measured end-to-end savings claim follows from choosing a smaller model.

Workers receive the six assignment fields and local instruction sources. They do not receive the full parent chat. They cannot delegate, use connected apps/MCP tools, browse the web or request permission escalation. Supply any authorized remote evidence as a frozen local source or bounded input. Worker startup verifies the matching profile, live model/effort, effective capability inventories, local environment and sandbox. A sandbox label alone is insufficient.

Write workers require a canonical existing linked Git worktree. The sandbox write boundary is that entire root; `ownership.paths` further describes the assignment but is not a per-file OS sandbox. Each write worker must declare `{key, mode:"write", path: ownership.cwd}`. The canonical root claim is required before admission and queued replay, even when no other writer is running. Preserve unrelated edits and run the repository's supported setup before expecting its checks to work. Plan Mode rejects write workers and write claims.

A resource is `{key, mode:"read"|"write", path?, identity?}`. Use the same key for the same shared resource. `path`, when supplied, must already exist: the host records its canonical path/device/inode and checks for replacement. Read/read claims coexist; a write claim conflicts on matching keys, canonical paths or identities. These are local scheduler leases, not cross-process or repository-wide locks. Broad directory claims need a shared key; arbitrary parent/child paths do not imply overlapping leases.

For a writing assignment, use this exact lease shape together with the six
assignment fields above. `args.cwd` is the existing canonical worktree root and
`args.ownedPaths` contains its existing owned paths. Review workers remain read-only
with no write lease. Resource fields are `key`, `mode` and optional `path`/`identity`;
`kind` and `access` are not supported.

```js
const writing = {
  ...args.spec,
  phase: phase('Implement the authorized change'),
  assignment: {
    ...args.spec.assignment,
    ownership: { cwd: args.cwd, paths: args.ownedPaths },
  },
  capability: 'workspace-write',
  resources: [
    ...args.spec.resources,
    { key: `worktree:${args.cwd}`, mode: 'write', path: args.cwd },
  ],
};
return await agent(writing);
```

The returned `TaskResult` includes `execution`, `acceptance`, `value`, `evidence`, `unresolved`, `usage`, `requestedModel`, `reportedModel` and optional `error`. `outputSchema` constrains `value`; the worker returns a separate envelope with `acceptance`, `value`, `evidence` and `unresolved`, which the backend validates. A completed process is not proof of acceptance. Branch on both fields; retain blockers and evidence instead of replacing a failure with an empty result.

Every object in `outputSchema`, including nested objects, must declare
`additionalProperties: false`. A worker may report `acceptance: "satisfied"` only
when its acceptance checks pass and `unresolved` is empty; limitations that leave
required work open belong in an incomplete or blocked result.

## Build verification into the graph

Use `pipeline(items, async (item) => { ... })` when each independent item needs
investigation followed by verification. Await the investigation inside that item,
then start its verifier immediately when execution and acceptance both succeed.
Other items need not finish first. Use a cross-item barrier only when the next
stage needs all their evidence, such as a completeness check across the corpus.
See `workflows/investigate-verify.js` for an executable example.

Give reviewers the original sources and ask them to try to disprove consequential
claims. Preserve supporting evidence, refutations and uncertainty separately.
Independent lenses can test different failure modes; agreement or a majority vote
is not proof. For open-ended research, add a completeness critic or bounded repeat
round when it can uncover meaningful omissions. State the stop rule and include
all possible verifier, critic and repeat calls in `maxAgentCalls` before launch.
Keep unreviewed sources and gaps visible when the bound is reached.

Quality and coverage guide the graph. Respect actual capacity, user budgets and
quotas; neither a fixed team size nor a cost-justification gate determines useful
work. One coupled writer can be appropriate, while independent source checks run
in parallel. Never dispatch filler to reach a target count.

## Lead handoffs and acceptance

In Plan Mode, workers perform read-only investigation and the lead produces the implementation-ready plan. Use `lead({kind: "planning", phase, objective, resources: [], evidence})` to ask the lead to resolve design choices, dependencies, ordered edits, acceptance checks and stop conditions. Its resolution verifies the plan, not implementation or publication. Planning handoffs reject write resource claims in every mode. Omitting `kind`, or specifying `kind: "action"`, preserves the existing action handoff, which cannot be claimed when the current or original run is in Plan Mode. The runtime also rejects writing workers in Plan Mode.

Call `lead({phase, objective, resources, evidence, revision?})` when the lead must inspect results, make a decision or perform an authorized consequential action. The objective should state the required acceptance checks and point to the saved task results. A handoff has no separate `inputs` or `acceptance` property.

Use `ultra_handoff({contextKey, id, action:"claim"})`, inspect the evidence and real system, then resolve with `action:"resolve"` and `resolution:{acceptance, value, evidence, revision?}`. Resolution acceptance is `satisfied`, `incomplete` or `blocked`. A claimed handoff belongs to that exact lead turn; if it was interrupted, read back the real state before resolving from a new verified turn. Identical resolutions are idempotent; conflicting resolutions fail.

To make the run's acceptance `satisfied`, return the resolved lead result unchanged:

```js
return await lead({
  phase: phase('Verify the requested outcome'),
  objective,
  resources: [],
  evidence,
});
```

The engine requires a resolved satisfied handoff with nonempty evidence and a final value exactly equal to that resolution. Worker self-assessment or `return {acceptance:"satisfied"}` alone does not satisfy this gate. The lead still owns the truth of the evidence and must complete applicable real QA, review and publication readback. A saved record does not establish human review or adjudication.

Keep writes to external systems, merges, deployment, publication and integration with the lead under the user's existing authority. Do not delegate them to a worker or invent a review requirement merely because a workflow exists. Mandatory repository review and checks remain mandatory.

## Uncertain worker readback

An uncertain worker creates a lead handoff with the same ID as its task. Inspect the retained task result, usage and any recorded worker thread/turn references. Claim this handoff from the exact verified current **Default-mode** lead turn. This readback can reconcile a run originally started in Plan Mode, but it grants no new execution authority.

Confirm the worker has actually terminated and inspect any possible writes, including the resulting files or revision. Until both checks are supported, leave the handoff unresolved; do not guess from silence or dispatch the same task again. Resolve with nonempty evidence, acceptance `satisfied` or `incomplete`, and exactly this receipt value:

```js
{
  acceptance: "incomplete",
  value: { terminationConfirmed: true, writesReconciled: true },
  evidence: [{ id: "readback", description: "Observed termination and checked resulting file state" }]
}
```

Replace the illustrative evidence with the actual observations. A `blocked` receipt, false confirmations, extra value fields or commands are rejected. If claiming was interrupted by a restart, reclaim from a verified Default-mode turn before resolving. Identical receipt retries are idempotent; conflicting receipts fail.

The receipt is saved separately from the original uncertain task result, then releases only that task's reserved capacity and resources. After all required readbacks, the old run ends `failed`/`incomplete`, or `cancelled`/`incomplete` if cancellation was requested. Its script never resumes and its uncertain output is not relabeled as success. Any retry needs an explicitly authored new run with `parentRunId` pointing to the old run and the saved evidence carried forward.

## Repository examples

Load each file's complete text into `ultra_start.script`; these files are script bodies, not executable Node modules. Set the matching ceiling and supply the indicated JSON arguments. Replace illustrative paths and source identifiers with canonical paths and actual evidence. The lead resolves useful coverage, dependencies and scope before launching.

| File                    | `maxAgentCalls` | Arguments and purpose                                                                                                                                                                                                                |
| ----------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `workflows/research.js` | 3               | `{cwd, sourceSetId, sourceIndex}`. One bounded discovery call identifies up to two distinct questions; only successful discovery fans out to source checks. The lead verifies the synthesis.                                         |
| `workflows/concepts.js` | 2               | `{cwd, brief, lenses:[first,second]}`. Exactly two independent alternatives from one frozen brief; add verification when the task needs it. The lead selects against the brief.                                                      |
| `workflows/coding.js`   | 1               | `{worktree, worktreeKey, paths, change, context, constraints, acceptance, stopConditions}`. One independent implementation in an already-prepared linked worktree, then lead QA, review, integration and any authorized publication. |

`workflows/investigate-verify.js` takes `{cwd, sourceSetId, sourceIndex, items}` where each item has `{id, question, sourceIds}`. Allow two calls per item: investigation then source-grounded verification, with independent items pipelined. All examples accept optional `routing:{model,effort}`; omission inherits the lead.

For research, `sourceIndex` is an array of bounded `{id, excerpt}` source records; include only evidence in scope. Discovery sees the index, and each subsequent check receives only its selected source records. For concepts, choose two distinct, nonempty lens strings before launch. For coding, supply the actual acceptance criteria and stop conditions; the script adds preservation and publication boundaries without replacing them.

The deterministic example tests use a fake worker and explicit fake lead resolutions. They verify script/API behavior and branching, not model quality, real patches, live sandbox behavior, publication or cost savings.
