# Acceptance ledger

Updated 2026-10-14. Native research/comparison/coding QA passed on installed
0.2.0. Installed 0.2.4 corrects generic and single-alias MCP metadata handling;
its native worker-to-lead workflow and bound-panel close/reopen QA passed.
The selected lead model and High effort were preserved. Automatic activation requires verified Ultra effort; explicit invocation also
works at High.
The mandatory pre-push hook supplies the final combined repository gate; the
PR records its observed result. Installed-process readback is tracked below.

## Observed compatibility

- [x] Public local stdio startup, tool discovery and native MCP App rendering.
- [x] Native exact-turn Ultra activation on bundled CLI 0.162.0-alpha.17.2, including a normal submitted user turn.
- [x] Original unsupported-version error corrected with an explicit version adapter; unknown versions remain blocked.
- [x] Native automatic chat binding and saved same-chat close/reopen restoration without another message.
- [x] Restricted production adapter: actual Luna reader, isolated-worktree writer, owned turn interruption and app-server process exits.
- [x] Deterministic public API/OS checks: read-only writes denied; assigned worktree writes allowed; sibling, /tmp and TMPDIR writes denied.
- [x] Worker profile, ChatGPT account type, live model/effort catalog, ordinary usage eligibility, disabled apps/MCPs/features and local environment readback.
- [x] Capacity explicitly comes from the lead's advertised session grant; no host-wide reservation is claimed.
- [ ] Native two-chat panel isolation and live Plan/Default transition QA.
- [ ] Independent Desktop-account identity comparison beyond matching the verified profile and account type.

The public worker stream did not expose receipts for the models' denied-write
attempts. Their claims are separate from the deterministic identical-policy OS
proof. Cancellation confirmed turn interruption and app-server exits; it did not
independently sample the command's sleep PID.

## Runtime implementation and supporting checks

- [x] General QuickJS scripts: arbitrary phases, branching, discovered fan-out, pipelines and bounded loops.
- [x] SQLite immutable starts, duplicate-content checks, durable results and settlement-order replay.
- [x] Replay mismatch blocks dispatch, including a reproduced parallel-call interleaving.
- [x] Multiple runs share fair scheduling, atomic resource claims and isolated pause/cancel controls.
- [x] Unknown writes/termination retain resource and capacity quarantine across restart.
- [x] Lead handoffs use exact verified turns, atomic claims, evidence and idempotent resolution.
- [x] Routed caller identity is checked against context ownership; model controls cannot use a panel nonce to bypass mode verification.
- [x] Restricted workers use exact requested model/effort, bounded prompts and strict result validation.
- [x] Usage reconciles cumulative snapshots and includes failed attempts; missing accounting remains unknown.
- [x] Dashboard shows concurrent runs, task rationale, progress, waiting reasons, results and acceptance separately.
- [x] Short selective authoring skill and executable research/concepts/coding examples.
- [x] Read-only next-turn notices for this chat's saved work; no closed-chat wakeup promise.
- [x] Packaged daemon/QuickJS/WASM QA: three actual runs ended completed, paused and cancelled independently; no model calls.
- [x] Local socket/MCP integration, isolation, lost acknowledgement, UTF-8, payload bounds and crash-endpoint checks.
- Required final release gate: the mandatory pre-push hook runs the combined repository checks on the exact candidate; the PR records the observed result.

Worker reconciliation uses existing lead handoffs: actual
termination and write readback must be recorded before releasing quarantine. The
old run stays incomplete; a retry is a new linked run, never an automatic write.

## Remaining release acceptance

- [x] Install 0.2.0 and verify the actual running MCP/daemon versions.
- [x] Installed 0.2.1 MCP and shared daemon readback: available runtime, exact Ultra context, four preserved QA runs, isolated app-only pause/resume/cancel, and stable terminal timestamp.
- [x] Native Veridue restart loaded 0.2.1: three client process directories, daemon version, and a new native panel tab confirmed automatic binding with all five retained runs.
- [x] Native 0.2.4 metadata compatibility: verified context/start/wait/result/lead claim/resolve, one completed read-only worker, and six retained workflow cards after closing/reopening from More tools.
- [x] Real research/comparison/coding workflows completed through native MCP tools; the lead inspected evidence and resolved acceptance.
- [x] Native multi-run controls: computer-use pause; user-assisted resume/cancel/reopen; backend readback and reopened native DOM agree. Binding and results persisted.
- [x] Isolated coding fixture: checks, nine-case independent regression, review, push and ready [PR #2](https://github.com/thomast8/ultra-code-for-codex/pull/2) readback. It remains unmerged.
- [x] One paired case produced passing patches in both arms. The sequential timing protocol was violated by overlapping execution; no speed or billing advantage is established. Broader calibration is stopped.
- Required delivery sequence: just-in-time self-review, address valid findings, pass the final hook, push and read back PR state. Publication evidence is recorded on the PR.

## Usage observed so far

Production-adapter QA reported 140,617 cumulative tokens across the successful
reader, writer and interrupted worker. One earlier schema-rejected attempt has
unavailable usage and is not counted as zero. Deterministic API/OS probes made no
model calls. These totals exclude unattributable lead coordination and do not
establish billed cost.

## Evidence

Detailed local QA artifacts are under the working chat's
`work/production-worker-qa/qa-ledger.md` and `work/packaged-runtime-qa.json`.
Historical Desktop investigation remains in [docs/desktop-compatibility.md](docs/desktop-compatibility.md).
The final release must distinguish implemented, tested, native-QA-verified,
installed and published states. No Pilot, private Desktop IPC, hosted service or
broader-permission substitute is authorized.

## Native workflow results

Research discovered two questions and dispatched exactly those two checks. One
worker returned contradictory acceptance fields; validation retained an explicit
failed result and its 17,040 tokens. The lead checked the missing source evidence
and produced a bounded synthesis. Research used 51,274 reported worker tokens.

The comparison produced two alternatives using 30,578 tokens. Its pause and resume
did not stop the coding run; cancelling a fourth control run affected only that
run. Closing and reopening preserved all four cards and this chat's binding.

The coding worker changed `||` to `??`, preserving `maxRetries: 0`. Its coverage
command was denied the sandbox's system temporary directory, so it correctly
reported incomplete acceptance. The lead ran the full fixture checks, reviewed
the two-file patch and verified PR #2 at
`93bb04be3f85a99fefcee262eb6d23e576602462`. Four tests and nine independent
cases passed with 100% source coverage. The frozen fixture base has no CI workflow;
there are no claimed remote CI results.

The coding workflow reported 127,078 worker tokens; one direct Astra/ultra arm
reported 96,059. Each used one model call. Main-chat coordination and actual
charges remain unknown, and timing was not controlled. This small coupled case
supports keeping such work with the lead; it does not establish a cheaper model
routing rule. Frozen local artifacts retain the procedure deviation.

Detailed artifacts: `work/native-workflow-qa/` and
`work/end-to-end-qa/retry-zero-2026-10-13T15-53-59.629Z-12027e1f/` in the working
chat directory. Local AF_UNIX sandbox QA separately confirmed that read-only and
writing worker policies deny connection to the private daemon socket, despite
same-user file readability. No production credential was used in that probe.

Restarting the actual app hosting this chat, Codex Veridue, loaded native 0.2.1
clients. Closing and reopening then restored binding and all five workflows.
A fresh turn alone did not refresh the old client. Native context-bearing tools
still rejected the request metadata, so this did not qualify orchestration as
fully healthy. Native multi-workflow execution QA above was performed on 0.2.0.

Final review fixes also passed an actual invalid-config bundled-CLI diagnostic
check and a real-clock 60,002 ms binding timeout/status retry through the local
MCP server and SQLite. The latter used a simulated accepted host message and
made no model call; it does not claim native message-delivery timeout QA.

## MCP metadata compatibility correction

Version 0.2.2 distinguishes generic request metadata from routed chat identity.
An actual SDK-generated progress-only request reproduced the 0.2.1 failure.
For example, a progress token no longer requires chat-ID aliases when the lead
supplies its verified current-turn handle. At that release, recognized routing
fields still required both valid matching aliases and the same session. Superseded
handles remain rejected, and manual restoration still requires verified routed
identity plus an existing owner in the same profile.

The context response exposes only an absent/generic/routed classification; no
raw metadata keys or values are returned. Focused SDK and handler tests, static
gates and the real packaged stdio launch passed. Subsequent native checks isolated
the single-alias mismatch; the 0.2.4 results below supersede that pending state.

## Native 0.2.4 routing and workflow QA

The 0.2.3 native diagnostic identified `thread_id:invalid_type` while `threadId`
passed validation. Exact-handle model calls now accept either valid UUID alias
and check every supplied alias against the verified chat. Malformed, conflicting
and other-chat IDs remain rejected. Manual restoration retains its separate
two-alias, canonical-profile and saved-owner requirements.

On 2026-10-14, all three live native MCP client directories and the shared daemon
were verified at 0.2.4. Native context, start, wait, result and lead handoff calls
succeeded. One read-only `gpt-6-luna` worker at Low effort returned a valid
source-bound result with no unresolved items. The selected `gpt-6.1-sol` lead at
High effort independently checked its conclusions and resolved the handoff.
The run ended `completed` with acceptance `satisfied`; its final value exactly
matched the evidence-backed lead resolution.

The expanded panel showed a bound status, no Bind button, the completed task,
resolved handoff and all six workflow cards. The user closed that tab and reopened
from More tools without clicking Bind. A different tab and initialization ID
restored the bound status, all six cards and the completed result. Native backend
readback matched, and all five earlier run snapshots remained unchanged.

This one worker reported 15,695 input and 257 output tokens, totaling 15,952, with
6,223 ms execution time. Cached-input and reasoning-output fields were zero.
Lead overhead and actual charges remain unknown; the panel correctly labels the
total partial. No retry, extra reviewer or billing-savings claim was added.

The routing code at `f1798946421bc7d2e818c63dd45e7b4429ad1122` passed the mandatory
541-test pre-push gate, coverage thresholds, formatting, lint, strict TypeScript
and build. Actual installed stdio QA also checked both single aliases, malformed
and foreign IDs, explicit panel binding and unchanged manual restoration.
The local build pins a checksum-verified Node 26.10.0 executable; Homebrew's
26.11.1 default was not changed.

Evidence in the working chat: `work/native-workflow-qa/native-0.2.4-final-readback.json`,
`metadata-0.2.4-installed.json` and `native-0.2.4-panel.json`.
This pass qualifies the current read-only worker-to-lead and same-chat panel
workflow. It does not repeat the earlier coding/publication QA or close the native
two-chat, Plan-transition and independent account-identity gaps listed above.

## 0.2.5 review fixes

- [x] Writers require a canonical root write lease before admission and queued replay.
- [x] Different-key writers on one root serialize; invalid claims dispatch no worker.
- [x] Production writer preflight retains safe linked-worktree failure reasons.
- [x] Activation scanning fails closed within its chunk-loop deadline.
- [x] Safe per-attempt daemon startup diagnostics and concurrent cold clients pass real isolated API QA without model calls.
- [ ] Installed/native 0.2.5 readback after supported reload.
- [ ] Native full app quit during an active worker. Detached background execution is current source behavior, not a completed Desktop QA claim.

Main-agent token display is a separate requested GitHub issue #4, not part of
these fixes. Current whole-workflow accounting stays partial because lead
usage is unobserved.
