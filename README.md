# Ultra Code for Codex

A personal local plugin for selective, adaptive workflows beside a Codex chat.
The selected chat model remains the lead. It delegates bounded work when the
benefit justifies worker usage and coordination, and retains decisions, real QA,
integration and verified completion.

The plugin includes the execution runtime, verified with native research,
comparison and isolated coding workflows. See [acceptance.md](acceptance.md)
for the separate automated, installed-process and native Desktop QA results.
There is no Codex Pilot, private Desktop IPC or hosted service dependency.

## Use

On a verified native **Ultra** turn, the hook activates the orchestration policy
automatically. You do not need to say “Use Ultra Code.” For example, ask
**“Investigate these three independent questions, then compare the evidence.”**
The lead decides whether delegation is useful; a small task such as correcting
one label stays with the lead. Ultra does not require fan-out or grant authority.

At another reasoning level, explicit invocation also works when capabilities are
verified: **“Use Ultra Code to investigate these independent questions.”** Native
0.2.4 QA completed one worker-to-lead workflow at the selected lead's High effort.

Ask **“Open the Ultra Code panel for this chat.”** An agent-opened panel binds from
its exact-turn context without another message. After that first verified binding,
opening from **More tools > Plugins and MCPs** restores the same chat when Desktop
supplies its routed identity. Missing or conflicting metadata retains the explicit
**Show this chat’s workflows** fallback. No global latest-chat lookup is used.

The panel keeps active and unresolved workflows visible, with agent status squares,
live time/tokens and drill-down details. The latest settled result stays compact;
earlier results are available in History. Task models/rationale, phases, evidence,
known waits and separate execution/acceptance outcomes remain available. See
[the panel design and verification](docs/panel-design.md). Pause
stops new dispatch while active tasks drain; cancel interrupts only that run and
preserves edits. Closing the panel does not stop the local daemon. Results persist.
A returned worker result is not a verified goal: the lead must inspect evidence
and resolve the final handoff.

## Setup and installation

Use Node **26.10.0** and `just`. The worker adapter and generated protocol are
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
in the plugin data directory. Do not edit the generated plugin cache. The daemon uses the pinned Node
executable recorded by the local build, so rebuild after moving that executable.

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
[Research, concepts and coding examples](workflows/README.md) use the same runtime.

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
adapter accepts the verified 0.160.0, 0.160.1, 0.162.0-alpha.17.2 and 0.163.0-alpha.10.2 formats; unknown
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
