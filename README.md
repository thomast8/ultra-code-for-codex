# Ultra Code for Codex

A local compatibility probe for a general, adaptive Codex orchestration plugin.
**The full orchestration runtime is not implemented.** It remains gated on live
Desktop integration and verified worker capabilities.

The selected chat model will remain the lead. The approved design uses selective,
bounded delegation, arbitrary workflow phases and multiple concurrent workflows.
There is no Codex Pilot, private Desktop IPC or hosted service dependency.

## Local setup and checks

Node **26.10.0**, `just`, and the bundled Codex CLI **0.160.0** are required.

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
Codex review flow. No global integration has been installed by this branch.
Routing evaluation is unavailable until the Desktop gate and honest usage
accounting pass; `just evaluate-routing` fails without making model calls.
