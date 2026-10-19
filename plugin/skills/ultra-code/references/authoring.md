# Ultra workflow authoring (contract version 2)

The selected chat remains the lead. Submit a JavaScript function body to `ultra_start` with the task title, objective, acceptance criteria, and JSON `args`. The runtime verifies worker readiness and shares three worker slots across this profile. It saves all calls and results.

agent(prompt, options?) requires a nonempty string prompt. agent(prompt) is read-only and cannot edit files. For an authorized coding task call agent(prompt, {access: "workspace-write"}). Both return final text or null on terminal failure. Options: label, phase, cwd, access, schema, model, effort. access must be "read-only" or "workspace-write". phase is a string label. Omit schema for text; if supplied, it must be a JSON Schema.

All options are optional. These types and values are generated from the runtime validator:

| Option   | Type or values                       | Meaning                                                                                    |
| -------- | ------------------------------------ | ------------------------------------------------------------------------------------------ |
| `label`  | string                               | Short worker title.                                                                        |
| `phase`  | string                               | Phase label, not a phase object.                                                           |
| `cwd`    | string                               | Absolute authorized working directory; defaults to the chat directory.                     |
| `access` | `"read-only"` or `"workspace-write"` | Defaults to read-only. Authorized edits require workspace-write; Plan mode rejects writes. |
| `schema` | object                               | Optional JSON Schema for the result; omit for plain text.                                  |
| `model`  | string                               | Omit to inherit the verified lead model.                                                   |
| `effort` | string                               | Omit to inherit the verified lead reasoning effort.                                        |

A supplied schema returns a validated JSON value. Terminal failure remains in the journal even if the script discards null. The lead checks the saved task result before claiming acceptance.

New runs automatically pause for lead review when a script ends with unreviewed worker results. The lead claims the pending handoff, checks the results and diff, completes required checks that worker permissions prevented, and resolves it with evidence. Explicit lead(...) calls still support decisions between phases; a final resolved review is not duplicated. Previously saved runs keep their original completion behavior.

The installed plugin's contract is authoritative for calling its tools, including when the task reviews or edits an older plugin checkout. Treat that checkout's historical API docs as task source, not the active tool contract.

Other calls: `phase(label)`, `log(value)`, `parallel(factories)`, `pipeline(items, ...stages)`, and `lead(objective, evidence?)`. Pipeline stops an item's later stages when a stage returns `null`. A phase label in an agent's options is safe inside a concurrent wave. `log` stores only a bounded preview. `lead` pauses for an explicit decision by the selected chat. The script has no filesystem, network, imports, timers, or direct tool access; workers do the source work.

`ultra_start` accepts an optional `maxAgentCalls` ceiling and soft observed-token budget. The budget counts cumulative worker input plus output, including repeated cached input on each call, not just new output. It stops new dispatch after the ceiling and does not interrupt running workers. Omit it unless a cumulative ceiling is wanted. The runtime derives canonical workspace claims. Writers require an existing isolated linked worktree, and workers writing the same worktree run one at a time. Plan mode rejects writes. Do not request additional workers just to fill slots.

`ultra_start` returns a run ID before the script dispatches workers. It confirms run creation only. Read `ultra_status` before claiming a worker launched; check active workers or returned task counts. Use `ultra_result` for full saved results, `ultra_inspect` for a bounded page of the owned worker's local history, and `ultra_continue` to continue a returned worker in its thread. Continuing failed work is recorded as a repair. An orchestration repair or replacement never turns an earlier failed first attempt into a pass.

To give a worker a saved result, put the `savedReference` returned by `ultra_result(runId, taskId)` in `ultra_start.savedTaskRefs`. This field accepts prior Ultra task results only. Put CSV paths, source files, and web URLs in the worker prompt so the worker reads them directly. Ultra verifies that this chat owns a saved result, loads its actual value, and adds it to the worker prompt. Saved evidence is limited to 48,000 UTF-8 bytes in total; use a smaller result if that bound is exceeded.

Correct ordinary source-path, truncation and command errors in the same assignment. A failed, truncated or locally denied tool or shell command inside a running worker is local to that worker, not a workflow execution or dispatch failure. A local operation-not-permitted or read-only-filesystem result is a recoverable sandbox/tool limitation unless required task access itself was revoked or is absent. Do not strengthen a workflow-failure stop rule into a command-failure stop rule. Retry the same operation at most twice with a smaller, corrected or permitted command, then report the blocker. Stop when required workspace or capability authority cannot be verified or has been lost. In a read-only worker, avoid heredocs, here-strings, output redirection, and temporary scripts; use bounded inline commands such as `python3 -c`. Keep independent inspection commands in separate tool calls so their exit statuses remain visible. State uncertainty and missing coverage plainly; a worker's return is not goal acceptance.

## Independent source review

Status includes current worker activity and its timestamp. Inspection starts with the newest events; follow nextCursor for older events. A pending final result is not evidence of a stalled worker. Before cancelling or reporting that no edits/tests occurred, inspect recent activity and the workspace diff. Repository checks needing capabilities unavailable to a worker belong with the lead during normal review; a locally denied check does not itself mean terminal worker failure.

Pass `args: {questions:["Check source A", "Check source B"]}` with actual independent questions. The lead examines the saved results, then claims and resolves the handoff with evidence.

```js
const reports = await parallel(
  args.questions.map(
    (question) => () => agent(question, { label: question, phase: 'Source review' }),
  ),
);
log({ returned: reports.filter((report) => report !== null).length });
if (reports.some((report) => report === null)) return { acceptance: 'incomplete', reports };
return await lead('Check both reports against the requested outcome and source evidence');
```

## Authorized coding work

Pass `args: {task: "The requested behavior change and its checks"}` in an already-authorized isolated worktree. The worker must receive the full task; it cannot read the workflow title, objective, acceptance list, or the lead's chat history. The selected chat inspects changes and verification evidence at the handoff.

```js
return await agent(args.task, {
  label: 'Implement and verify',
  phase: 'Implementation',
  access: 'workspace-write',
});
```

Results remain linked to their individual tasks. Use specific source references and bounded excerpts for dependent calls; do not copy an entire report into another worker prompt. Any prompt over 64 KiB or schema over 64 KiB is rejected before worker launch with its measured size.
