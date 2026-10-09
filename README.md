# Ultra Code for Codex

Personal local Codex orchestration compatibility probe; full runtime remains gated.

Repository: `ultra-code-for-codex`.
A local compatibility probe for a general, adaptive Codex orchestration plugin.
**The full orchestration runtime is not implemented.** It remains gated on live
Desktop integration and verified worker capabilities.

The selected chat model will remain the lead. The approved design uses selective,
bounded delegation, arbitrary workflow phases and multiple concurrent workflows.
There is no Codex Pilot, private Desktop IPC or hosted service dependency.

## Local setup and checks

Node **26.10.0** and `just` are required. Protocol generation and backend QA
are pinned to bundled CLI **0.160.1**. The log adapter accepts **0.160.0** and
**0.160.1** root-chat records, with exact session, turn and cwd matching.
Descendant sessions with different thread/root IDs remain ineligible for lead
activation. Unsupported log versions remain unknown.

```sh
just setup
just quality
just test
just build
node scripts/check-mcp.mjs
node scripts/check-backend.mjs
just check
```

`just setup` installs locked dependencies and installs this repository's local
pre-push hook. It does not change global Codex configuration. The hook runs
`just check`; do not repeat the full suite immediately before an eventual push.
`node scripts/generate-protocol.mjs` regenerates version-pinned protocol types.
Generated types are excluded only from manual-code style and coverage gates.

## Implemented probe

- Codex legacy plugin packaging with a discoverable plugin-owned activation hook.
- Plugin-owned exact-turn context registration with opaque handles.
- Versioned log adapter, explicit unknown metadata, Ultra and Plan Mode metadata.
- Local stdio MCP server and inline React MCP App resource.
- Automatic binding from a verified lead handle; explicit fallback for manual panels.
- Secret-safe bundled app-server admission inspection and denied server requests.
- Worker execution remains unavailable until effective capabilities are verified.

The lead tools expose `ultra_context`, `ultra_panel`, and `ultra_panel_bind`.
An app-only `ultra_panel_status` reads the existing panel nonce state without
revealing chat metadata or using a model call. They do not start workflows. Panel nonces and verified ownership are shared in
a private SQLite store under this profile's plugin data directory;
workflow durability, the scheduler, QuickJS execution, lead handoffs, usage
accounting and routing calibration belong to later gated slices.

## Desktop gate

See [the live compatibility procedure](docs/desktop-compatibility.md) and
[acceptance tracking](acceptance.md). `just qa-desktop` deliberately returns an
incomplete result until real host observations are recorded. A successful local
stdio check is not a Desktop UI pass.

Installation must preserve unrelated plugins and hooks. Hook trust is a separate
Codex review flow. Installation does not automatically trust the hook. The active manifest is
`plugin/.codex-plugin/plugin.json`; the original portable manifest is preserved
at `plugin/.codex-plugin/portable.plugin.json`. The portable format currently
fails to expose hooks in the installed Codex host. `plugin/.mcp.json` is the
active MCP declaration; `plugin/mcp.json` preserves the original portable one.
The legacy MCP loader does not expand `${PLUGIN_ROOT}` or `${PLUGIN_DATA}`.
Its launcher therefore uses supported plugin-relative `cwd: "."`, then derives
this installation's data directory from the verified Codex cache layout. No
profile is selected through the most recent session or a default home path.
`node scripts/check-mcp.mjs` exercises that declared launcher in an isolated
cache, rather than bypassing it with an independently supplied command.

Routing evaluation is unavailable until the Desktop gate and honest usage
accounting pass; `just evaluate-routing` fails without making model calls.

## Install and use the probe

Build from this checkout before registering the local marketplace:

```sh
just setup
just build
/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex plugin marketplace add "$(pwd)"
/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex plugin add ultra-code-for-codex@ultra-code-for-codex-local
```

Ask **“Open the Ultra Code panel for this chat.”** The lead resolves its current
hook handle with `ultra_context` and passes the same `contextKey` to `ultra_panel`.
Version 0.1.4 verifies and binds the panel before returning it; the bound panel
shows no binding button and submits no extra chat message. Review the plugin's
`UserPromptSubmit` hook through Codex's normal trust UI when required.

A manual **More tools > Plugins and MCPs > Open Ultra Code panel** launch has no
verified lead handle. Only that fallback asks **Show this chat's workflows** and
queues one request for the lead. The original panel reads nonce status directly
once a second and stops when binding finishes. Repeated pending requests are
disabled. The panel and lead may use separate MCP server instances.

Close old panels and reopen after refreshing the plugin. An active Desktop turn
can retain its old MCP server and UI; a fresh turn is needed to revalidate the
installed update. Unsupported or unavailable exact-turn metadata fails explicitly.

On verified Ultra turns, the hook emits selective delegation policy. Non-Ultra
or unknown metadata does not activate that policy. Plan Mode stays read-only.

This version tests context and panel integration only. It cannot run workflows,
spawn workers or produce a PR. Selecting Ultra does not enable a missing runtime.
The panel reports that limitation explicitly.

After source changes, run `just build` and repeat `codex plugin add` with the
same selector to refresh the installed copy. Close and reopen the panel after
refresh. Do not edit the generated plugin cache.
