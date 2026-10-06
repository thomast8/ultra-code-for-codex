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
are pinned to bundled CLI **0.160.0**. The installed CLI is now **0.160.1**;
its generated bindings match, but its observed session identity metadata needs
separate adapter validation. Unsupported log versions remain unknown.

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

- Plugin-owned exact-turn context registration with opaque handles.
- Versioned log adapter, explicit unknown metadata, Ultra and Plan Mode metadata.
- Local stdio MCP server and inline React MCP App resource.
- One-time explicit panel binding without choosing the latest global session.
- Secret-safe bundled app-server admission inspection and denied server requests.
- Worker execution remains unavailable until effective capabilities are verified.

The MCP tools currently expose `ultra_context`, `ultra_panel`, and
`ultra_panel_bind`. They do not start workflows. Bindings are in-process;
workflow durability, the scheduler, QuickJS execution, lead handoffs, usage
accounting and routing calibration belong to later gated slices.

## Desktop gate

See [the live compatibility procedure](docs/desktop-compatibility.md) and
[acceptance tracking](acceptance.md). `just qa-desktop` deliberately returns an
incomplete result until real host observations are recorded. A successful local
stdio check is not a Desktop UI pass.

Installation must preserve unrelated plugins and hooks. Hook trust is a separate
Codex review flow. Installation does not automatically trust the hook.
Routing evaluation is unavailable until the Desktop gate and honest usage
accounting pass; `just evaluate-routing` fails without making model calls.

## Install and use the probe

Build from this checkout before registering the local marketplace:

```sh
just setup
just build
/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex plugin marketplace add /Users/thomastiotto/GitRepos/ultra-code-for-codex
/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex plugin add ultra-code-for-codex@ultra-code-for-codex-local
```

In Codex, open a new chat and ask **“Open the Ultra Code panel for this chat.”**
You can also select Ultra Code for Codex from the Plugins and MCPs menu. Review
the plugin's `UserPromptSubmit` hook in Codex's normal hook trust UI. On a
supported exact-turn record, choose **Show this chat's workflows** in the panel
and let the lead bind its nonce. If metadata is unsupported or unavailable,
the binding must fail with an explicit reason.

This version tests context and panel integration only. It cannot run workflows,
spawn workers or produce a PR. Selecting Ultra does not enable a missing runtime.
The panel reports that limitation explicitly.

After source changes, run `just build` and repeat `codex plugin add` with the
same selector to refresh the installed copy. Close and reopen the panel after
refresh. Do not edit the generated plugin cache.
