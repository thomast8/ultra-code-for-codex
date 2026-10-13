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

Ask **“Use Ultra Code to investigate these independent questions, then compare the
findings.”** On a verified native Ultra turn the hook also enables the selective
authoring policy. A small task, such as correcting one label, stays with the lead.
Ultra does not require fan-out or grant additional authority.

Ask **“Open the Ultra Code panel for this chat.”** An agent-opened panel binds from
its exact-turn context without another message. After that first verified binding,
opening from **More tools > Plugins and MCPs** restores the same chat when Desktop
supplies its routed identity. Missing or conflicting metadata retains the explicit
**Show this chat’s workflows** fallback. No global latest-chat lookup is used.

The panel shows multiple workflows, arbitrary phases, task models and rationale,
usage, evidence, known waits and separate execution/acceptance outcomes. Pause
stops new dispatch while active tasks drain; cancel interrupts only that run and
preserves edits. Closing the panel does not stop the local daemon. Results persist.
A returned worker result is not a verified goal: the lead must inspect evidence
and resolve the final handoff.

## Setup and installation

Use Node **26.10.0** and `just`. The worker adapter and generated protocol are
verified against the Desktop-bundled CLI **0.162.0-alpha.17.2** at
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
an update. If Desktop retains the previous connection, finish the current turn
and use a fresh turn to verify the refresh. An already-open panel can also need
closing and reopening to load its new UI. Saved chat bindings and workflows stay
in the plugin data directory. Do not edit the generated plugin cache. The daemon uses the pinned Node
executable recorded by the local build, so rebuild after moving that executable.

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

Workers use fresh ephemeral app-server threads. They receive bounded assignments,
normal repository guidance, explicit model/effort and either read-only access or
writes in an assigned isolated Git worktree. Nested agents, inherited apps/MCPs,
plugins, hooks, network access and escalation are disabled and checked before
model dispatch. The lead performs authenticated actions, browser QA, commits and
publication through its normal tools and existing authority.

All workflows share the lead's explicitly advertised available capacity. This is
local scheduling, not a host-wide slot reservation. Requested models are checked
against the live catalog; unavailable models fail without silent substitution.
Observed usage includes attempts and retries. Cached input and reasoning output
are subsets, not extra tokens. Unattributable lead overhead and missing usage stay
unknown; token totals are not billed money. Optional token budgets stop new work
but cannot impose an exact ceiling on in-flight usage.

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
adapter accepts the verified 0.160.0, 0.160.1 and 0.162.0-alpha.17.2 formats; unknown
versions remain unknown. Plan Mode stays read-only. Changing mode does not silently
cancel an already authorized immutable run.

V1 does not promise automatic wakeup of a closed chat, recovery of an interrupted
worker's private conversation, or fencing against unrelated processes deleting a
worktree. New turns receive a compact notice of this chat's saved work. Routing
savings require measured comparisons; no broad default fan-out is enabled.
