# Ultra workflow authoring (contract version 2)

The selected chat remains the lead. Submit a JavaScript function body to `ultra_start` with the task title, objective, acceptance criteria, and JSON `args`. The runtime verifies worker readiness and shares three worker slots across this profile. It saves all calls and results.

Inside the script, use `agent(prompt, options?)`. The prompt is required; available options are `label`, `phase`, `cwd`, `access`, `schema`, `model`, `effort`. The default is read-only work in the verified chat directory with the lead's verified model and effort. A worker returns text, or a validated JSON value when `schema` is supplied. Terminal failure returns `null` and remains a failed task in the journal. The lead checks the saved task result before claiming acceptance.

Other calls: `phase(label)`, `log(value)`, `parallel(factories)`, `pipeline(items, ...stages)`, and `lead(objective, evidence?)`. Pipeline stops an item's later stages when a stage returns `null`. A phase label in an agent's options is safe inside a concurrent wave. `log` stores only a bounded preview. `lead` pauses for an explicit decision by the selected chat. The script has no filesystem, network, imports, timers, or direct tool access; workers do the source work.

`ultra_start` accepts an optional `maxAgentCalls` ceiling and soft observed-token budget. The runtime derives canonical workspace claims. Writers require an existing isolated linked worktree, and workers writing the same worktree run one at a time. Plan mode rejects writes. Do not request additional workers just to fill slots.

`ultra_status` is compact; use `ultra_result` for full saved results, `ultra_inspect` for a bounded page of the owned worker's local history, and `ultra_continue` to continue a returned worker in its thread. Continuing failed work is recorded as a repair. An orchestration repair or replacement never turns an earlier failed first attempt into a pass.

To give a worker a saved result, put the `savedReference` returned by `ultra_result(runId, taskId)` in `ultra_start.savedTaskRefs`. This field accepts prior Ultra task results only. Put CSV paths, source files, and web URLs in the worker prompt so the worker reads them directly. Ultra verifies that this chat owns a saved result, loads its actual value, and adds it to the worker prompt. Saved evidence is limited to 48,000 UTF-8 bytes in total; use a smaller result if that bound is exceeded.

Correct ordinary source-path, truncation and command errors in the same assignment. A tool or shell command error inside a running worker is local to that worker, not a workflow execution or dispatch failure. Do not strengthen a workflow-failure stop rule into a command-failure stop rule. Retry the same operation at most twice with a smaller or corrected command, then report the blocker. Stop on authority or permission failure. In a read-only worker, avoid heredocs, here-strings, output redirection, and temporary scripts; use bounded inline commands such as `python3 -c`. Keep independent inspection commands in separate tool calls so their exit statuses remain visible. State uncertainty and missing coverage plainly; a worker's return is not goal acceptance.

## Complete example

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

Results remain linked to their individual tasks. Use specific source references and bounded excerpts for dependent calls; do not copy an entire report into another worker prompt. Any prompt over 64 KiB or schema over 64 KiB is rejected before worker launch with its measured size.
