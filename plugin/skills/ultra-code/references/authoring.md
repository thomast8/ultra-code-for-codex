# Writing a workflow

The selected chat remains the lead. The runtime executes an immutable JavaScript body, records its calls and results, and schedules bounded workers. It has no research, concepts or coding presets. The three repository examples are ordinary scripts with illustrative phase labels.

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

## Choose the assignment graph first

For each requested outcome, identify independent inputs and questions before choosing
the worker ceiling. Keep real dependencies sequential, and start ready independent
assignments together. For example, partition fourteen transcripts into nonoverlapping
batches with the same extraction contract while the lead reads authenticated course
pages. Pass only each batch's sources and shared definitions to its worker; the lead
compares the returned evidence. Do not replicate the full corpus in every assignment.
Choose the number of batches from useful work, cost and observed capacity, not a fixed
agent count. A single coupled patch in one writable worktree can remain one assignment.

Record that decision using `log()` before dispatch. Include dependencies, the reason
for the partition, and actual capacity reservations. Reserve the lead plus observed
occupied slots, not a spare slot with no workload. `maxAgentCalls` covers the resulting
graph, not just the first call. A one-worker plan must name the dependency or cost
reason that makes parallel work unhelpful.

For already-prepared independent read-only specs in `args.assignments`, a script can
launch one wave and return a review handoff without a redundant discovery worker:

```js
log(args.dispatchPlan);
const checks = phase('Independent source checks');
const results = await parallel(
  args.assignments.map((spec) => () => agent({ ...spec, phase: checks })),
);
return await lead({
  kind: 'planning',
  phase: phase('Compare the evidence'),
  objective: args.reviewObjective,
  resources: [],
  evidence: results.flatMap((result) => result.evidence),
});
```

Supply complete valid worker specs and set the call ceiling to their count. This
example does not grant capacity, validate assignment usefulness or waive inspection
of failed/incomplete results. Claim the handoff when review begins, and resolve when
its acceptance checks finish; unrelated lead work should not hold it open.

## Script API

The script runs inside QuickJS, not Node. It has no filesystem, network, imports, process, timers or automatic tool discovery. `Date` and `Math.random` are unavailable. Local variables, bounded loops and conditionals are ordinary JavaScript. Return a JSON value.

| Function              | Implemented behavior                                                                                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `phase(label)`        | Synchronous; creates and returns a frozen `{id,label}`. Every worker and handoff must use a phase returned by this function. Labels and phase order are authored by the script. |
| `agent(spec)`         | Promise of a `TaskResult`. The host validates the spec, journals it, waits for capacity/resources and dispatches a restricted worker.                                           |
| `lead(spec)`          | Promise resolved by the selected lead's claimed handoff. It does not spawn a coordinator or change the lead model.                                                              |
| `parallel(factories)` | Runs zero-argument factories and returns `Promise.all` results in input order. Host admission bounds actual simultaneous workers.                                               |
| `pipeline(items, fn)` | Maps every item to `fn(item,index)` concurrently. Put sequential `await` steps inside each item function to create per-item dependencies. It is not a global serial pipeline.   |
| `log(message)`        | Synchronous journal entry of bounded nonempty text; it does not request model inference.                                                                                        |

Replay requires the same host calls and payloads in the same order. Completed calls reuse journaled results. Do not mutate a launched script, add nondeterministic inputs, or bypass exposed functions. A changed strategy is a new run with a fresh `requestId`, optional `parentRunId` and saved evidence references. Incomplete or uncertain calls need explicit reconciliation.

## Worker contracts and cost assessment

`agent()` returns a `TaskResult`, not a task snapshot. Its fields are `execution`,
`acceptance`, `value`, `evidence`, `unresolved`, `usage`, `requestedModel`,
`reportedModel` and optional `error`. There is no `taskId` or `id` on this return
value. Use `result.evidence` directly in a handoff; obtain task IDs from
`ultra_status` when needed. Do not invent an artifact ID from an undefined field
or put the serialized worker result into the handoff objective.

```js
const result = await agent(args.spec);
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

`agent(spec)` requires:

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
  model, effort,
  capability,                // "read-only" or "workspace-write"
  resources,                 // resource claims below
  outputSchema,              // JSON Schema for the result's value field only
  timeoutMs                  // optional, default 300,000; 1,000–3,600,000
}
```

Choose model and effort before dispatch, using current availability and the actual problem. Luna is a useful initial choice for a short source extraction; Sol is appropriate when an implementation requires understanding several interacting callers. Astra needs a specific reason, such as unresolved ambiguity with a consequential architectural decision that a cheaper model cannot reliably settle. The names are not automatic routing rules or performance guarantees. The backend reads all live model-catalog pages, checks the requested effort and verifies the reported selection. An unavailable pair blocks the worker. Reassess and author a new request explicitly; do not conceal a substitution.

The worker deadline is a hard wall-time bound from turn dispatch, not an inactivity
timeout. Choose an explicit deadline when the assignment needs a different bound;
ongoing activity does not extend it. Command transport frames are bounded at
16 MiB; final worker output remains bounded at 256 KiB. A transport failure keeps
termination uncertain until actual readback, even when its failure category is known.

The assessment records the reasoning at admission. Do not rewrite it after seeing results to imply a better prediction. Count total worker context, outputs, retries, duplicated reading, lead verification and coordination when evaluating value. Usage can be unknown. Run `accountingComplete` refers only to worker attempts; it never includes main-chat overhead. Cached input is part of input, and reasoning output is part of output; do not add those subsets again. No measured end-to-end savings claim follows from choosing a smaller model.

Workers receive the six assignment fields and local instruction sources. They do not receive the full parent chat. They cannot delegate, use connected apps/MCP tools, browse the web or request permission escalation. Supply any authorized remote evidence as a frozen local source or bounded input. Worker startup verifies the matching profile, live model/effort, effective capability inventories, local environment and sandbox. A sandbox label alone is insufficient.

Write workers require a canonical existing linked Git worktree. The sandbox write boundary is that entire root; `ownership.paths` further describes the assignment but is not a per-file OS sandbox. Each write worker must declare `{key, mode:"write", path: ownership.cwd}`. The canonical root claim is required before admission and queued replay, even when no other writer is running. Preserve unrelated edits and run the repository's supported setup before expecting its checks to work. Plan Mode rejects write workers and write claims.

A resource is `{key, mode:"read"|"write", path?, identity?}`. Use the same key for the same shared resource. `path`, when supplied, must already exist: the host records its canonical path/device/inode and checks for replacement. Read/read claims coexist; a write claim conflicts on matching keys, canonical paths or identities. These are local scheduler leases, not cross-process or repository-wide locks. Broad directory claims need a shared key; arbitrary parent/child paths do not imply overlapping leases.

The returned `TaskResult` includes `execution`, `acceptance`, `value`, `evidence`, `unresolved`, `usage`, `requestedModel`, `reportedModel` and optional `error`. `outputSchema` constrains `value`; the worker returns a separate envelope with `acceptance`, `value`, `evidence` and `unresolved`, which the backend validates. A completed process is not proof of acceptance. Branch on both fields; retain blockers and evidence instead of replacing a failure with an empty result.

Every object in `outputSchema`, including nested objects, must declare
`additionalProperties: false`. A worker may report `acceptance: "satisfied"` only
when its acceptance checks pass and `unresolved` is empty; limitations that leave
required work open belong in an incomplete or blocked result.

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

Load each file's complete text into `ultra_start.script`; these files are script bodies, not executable Node modules. Set the matching ceiling and supply the indicated JSON arguments. Replace illustrative paths and source identifiers with canonical paths and actual evidence. The lead performs the cost and scope decision before launching.

| File                    | `maxAgentCalls` | Arguments and purpose                                                                                                                                                                                                                |
| ----------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `workflows/research.js` | 3               | `{cwd, sourceSetId, sourceIndex}`. One bounded discovery call identifies up to two distinct questions; only successful discovery fans out to source checks. The lead verifies the synthesis.                                         |
| `workflows/concepts.js` | 2               | `{cwd, brief, lenses:[first,second]}`. Exactly two independent alternatives from one frozen brief; no automatic judges or critics. The lead selects against the brief.                                                               |
| `workflows/coding.js`   | 1               | `{worktree, worktreeKey, paths, change, context, constraints, acceptance, stopConditions}`. One independent implementation in an already-prepared linked worktree, then lead QA, review, integration and any authorized publication. |

For research, `sourceIndex` is an array of bounded `{id, excerpt}` source records; include only evidence in scope. Discovery sees the index, and each subsequent check receives only its selected source records. For concepts, choose two distinct, nonempty lens strings before launch. For coding, supply the actual acceptance criteria and stop conditions; the script adds preservation and publication boundaries without replacing them.

The deterministic example tests use a fake worker and explicit fake lead resolutions. They verify script/API behavior and branching, not model quality, real patches, live sandbox behavior, publication or cost savings.
