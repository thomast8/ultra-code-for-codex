# Ultra Code for Codex

A local Codex plugin for quality-first dynamic workflows beside a chat.
The selected chat model remains the lead. In Ultra, substantive work normally uses
scripted investigation and verification. Workers inherit the captured lead model
and effort unless explicitly overridden. The lead retains decisions, real QA,
integration and verified completion.

The plugin includes the execution runtime, verified with native research,
comparison and isolated coding workflows. See [acceptance.md](acceptance.md)
for the separate automated, installed-process and native Desktop QA results.
There is no Codex Pilot, private Desktop IPC or hosted service dependency.

## Use

On a verified native **Ultra** turn, the hook activates the orchestration policy
automatically. You do not need to say “Use Ultra Code.” For example, ask
**“Investigate these three independent questions, then compare the evidence.”**
The lead chooses an investigation and verification graph appropriate to the task;
conversation and trivial mechanical edits stay direct. Ultra does not grant
additional authority or require a fixed number of agents. Workflows record a run in the panel.
Native subagents are not a fallback. An unavailable engine or worker capability
is reported as a blocker; opening the panel alone does not start a workflow.

At another reasoning level, explicit invocation also works when capabilities are
verified: **“Use Ultra Code to investigate these independent questions.”** Native
0.2.4 QA completed one worker-to-lead workflow at the selected lead's High effort.

Ask **“Open the Ultra Code panel for this chat.”** An agent-opened panel binds from
its exact-turn context without another message. After that first verified binding,
opening from **More tools > Plugins and MCPs** restores the same chat when Desktop
supplies its routed identity. Missing or conflicting metadata retains the explicit
**Show this chat’s workflows** fallback. No global latest-chat lookup is used.
The opener's display guard uses a browser-owned lock for the verified profile and
chat. Repeated calls reuse an open panel, including one opened manually, without
promoting another tab. Closing the panel releases the lock so a later call can
open it again. Automatic opening requires Web Locks; unsupported hosts remain
inline rather than opening an unchecked duplicate.

The panel keeps active and unresolved workflows visible, with agent status squares,
live time/tokens and drill-down details. The latest settled result stays compact;
earlier results are available in History. Task models/rationale, phases, evidence,
known waits and separate execution/acceptance outcomes remain available. See
[the panel design and verification](docs/panel-design.md). Pause
stops new dispatch while active tasks drain; cancel interrupts only that run and
preserves edits. Closing the panel does not stop the local daemon. Results persist.
A returned worker result is not a verified goal: the lead must inspect evidence
and resolve the final handoff.

Verification and worker problems always return to the lead. The panel shows
“Waiting for lead” or “Lead is verifying”, with internal handoff payloads kept
inside closed details. A worker's incomplete result does not override the lead's
verified final outcome. Uncertain execution remains visible until reconciled.
Only the lead asks the user directly in chat for a necessary decision or authority.

## Install the plugin

The GitHub plugin includes the built runtime, panel, authoring skill and hooks.
No source build, npm install or hosted service is needed to use it. This release
is verified on macOS with Codex Desktop CLI **0.163.0-alpha.10.2**, the official
app at `/Applications/ChatGPT.app`, and Node **26.10.0 or 26.12.0** on the app's
PATH. Other operating systems and unlisted Codex versions are not qualified.

```sh
codex plugin marketplace add thomast8/ultra-code-for-codex --ref v0.2.15
codex plugin add ultra-code-for-codex@ultra-code-for-codex-local
```

If `codex` is not on PATH, use the bundled executable shown below. The marketplace
name retains its original `-local` suffix to preserve existing workflow storage.
For an isolated or Doppel-managed instance, run both commands with that instance's
`CODEX_HOME`; install separately for each profile. Account access, workflows and
bindings are not copied between profiles. The plugin uses the selected profile's
existing ChatGPT authentication and never asks for an API key.

Codex reviews the plugin-owned hook through its normal trust flow. Enable the
plugin in the app's Plugins settings. Reload the plugin connection after an update;
close and reopen an old panel to load the new UI. Reopening from More tools restores
the verified chat binding without a Bind click. Ultra activates the authoring policy
automatically; Plan + Ultra keeps investigations read-only and produces a plan.

The [GitHub release](https://github.com/thomast8/ultra-code-for-codex/releases/latest)
also provides a standalone archive and SHA-256 checksums. Extract it and register
the extracted directory with `codex plugin marketplace add /path/to/extracted`.
To change a pinned release or switch from a source checkout, unregister the old
marketplace source with `codex plugin marketplace remove ultra-code-for-codex-local`,
then run the installation commands with the desired release tag. This removes the
source registration, not the plugin or its workflow data. Do not use `plugin remove`
for an update. Keep the same profile and marketplace name. Workers can continue using
tokens when Codex is closed; pause or cancel runs before updating the runtime.

## Develop from source

Use Node **26.10.0 or 26.12.0** and `just`. The worker adapter and generated protocol are
verified against the Desktop-bundled CLI **0.163.0-alpha.10.2** at
`/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex`.

```sh
just setup
just build
/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex plugin marketplace add "$(pwd)"
/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex plugin add ultra-code-for-codex@ultra-code-for-codex-local
```

`just setup` installs locked dependencies and the repository's mandatory pre-push
hook. It does not rewrite global Codex guidance. The plugin-owned prompt hook uses
Codex's normal trust review. The active package is `plugin/.codex-plugin/plugin.json`
with `plugin/.mcp.json`; original portable declarations are retained separately.
The legacy loader uses a verified relative cache layout because it does not expand
root/data placeholders. Unsupported layouts fail instead of selecting a profile.

Build and repeat `codex plugin add` after updating this checkout. An already running
MCP server can retain its previous build; confirm the live version before assessing
an update. If Desktop retains the previous connection across turns, fully quit
and reopen the app hosting this chat. An already-open panel can also need
closing and reopening to load its new UI. Saved chat bindings and workflows stay
in the plugin data directory. Do not edit the generated plugin cache. The daemon uses
the same local Node executable as the MCP server; published builds contain no
developer-machine runtime path. `npm run package:release` creates the installable
archive and checksums from an explicit file allowlist. Bundled dependency licenses
are included in `plugin/dist/THIRD_PARTY_NOTICES.txt`.

When workflows start, the authoring policy asks the lead to open the dashboard
with its verified context. The app requests the host's expanded display mode
when supported. On a first manual open, exact routed chat identity can also
bind through that chat's verified current registration, without a queued message
or an earlier panel binding. Missing or conflicting identity still requires the
explicit binding fallback; the server never selects a global latest chat.

## Runtime and boundaries

The lead tools are `ultra_context`, `ultra_start`, `ultra_status`, `ultra_wait`,
`ultra_result`, `ultra_control`, `ultra_handoff`, `ultra_panel`, and `ultra_panel_bind`.
App-only `ultra_panel_status` and `ultra_panel_control` serve the binding fallback
and explicit panel buttons. Model controls require the exact current context;
only a verified Default-mode lead can resume execution. Read the bundled
[authoring skill](plugin/skills/ultra-code/SKILL.md) and its
[API reference](plugin/skills/ultra-code/references/authoring.md) before authoring.
[Research, concepts and coding examples](workflows/README.md) show contract version 1 graphs for the internal engine; chat workflows use the version 2 authoring reference.

Scripts run in bounded QuickJS instances with immutable JSON inputs and no shell,
filesystem, imports, network, timers, clock or randomness. SQLite records immutable
starts, host calls, result delivery order, task assessments, usage and handoffs.
Retries are new attempts; uncertain writes are never automatically repeated.

Quitting Codex does not pause the detached local runtime. Workers can continue
and use tokens while the app is closed; steps needing the lead wait until you
return. Pause stops new dispatch while current workers drain. Cancel interrupts
that workflow's workers. Saved results survive a runtime restart; uncertain
interrupted work requires readback before retrying. An app quit during an active
worker has not yet been verified in native Desktop QA.

Workers use fresh ephemeral app-server threads. They receive bounded assignments,
normal repository guidance, explicit model/effort and either read-only access or
writes in an assigned isolated Git worktree. Nested agents, inherited apps/MCPs,
plugins, hooks, network access and escalation are disabled and checked before
model dispatch. The lead performs authenticated actions, browser QA, commits and
publication through its normal tools and existing authority.

All workflows share the lead's explicitly advertised available capacity. This is
local scheduling, not a host-wide slot reservation. Requested models are checked
against the live catalog; unavailable models fail without silent substitution.
Observed worker usage includes attempts and retries. Worker accounting is complete
only when every attempt is settled with known usage; main chat usage remains
unknown. Cached input and reasoning output are subsets, not extra tokens. New
worker snapshots also retain cache-write input. The panel shows a conditional
[Standard rate-card credit equivalent](docs/cost-accounting.md) by reported
worker model, never a claimed bill. Missing rates or inconsistent usage stay
unknown. An optional observed-token threshold warns on crossing and blocks new
worker dispatch; active work continues and can exceed it.

## Checks and limits

```sh
just quality
just test -- test/runtime-engine.test.ts
just build
node scripts/check-mcp.mjs
just check
```

The mandatory pre-push hook runs `just check`; do not duplicate the full suite
immediately before a push. TypeScript is strict. ESLint enforces complexity 10,
80-line functions and 400-line source files. Coverage requires 90% statements,
lines and functions, and 85% branches. Generated protocol files are exempt only
from manual code style and coverage.

See [Desktop compatibility evidence](docs/desktop-compatibility.md). Local tests
and standalone MCP checks do not establish native Desktop QA. The exact-turn log
adapter accepts the verified 0.160.0, 0.160.1, 0.162.0-alpha.17.2, 0.163.0-alpha.10.2 and 0.163.0-alpha.11 formats; unknown
versions remain unknown. Plan Mode stays read-only. Changing mode does not silently
cancel an already authorized immutable run.

With Ultra selected in Plan Mode, the hook activates the planning policy. The
lead uses bounded read-only investigations where useful and produces a concrete
implementation plan. A `lead({kind: "planning", ...})` handoff can be accepted
in Plan Mode and permits only read resource claims. Ordinary action handoffs
still require Default mode; writing workers remain blocked in Plan Mode.

V1 does not promise automatic wakeup of a closed chat, recovery of an interrupted
worker's private conversation, or fencing against unrelated processes deleting a
worktree. New turns receive a compact notice of this chat's saved work. Routing
savings require measured comparisons; no broad default fan-out is enabled.
