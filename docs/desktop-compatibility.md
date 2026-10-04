# Desktop compatibility gate

This branch is a compatibility probe, not the complete orchestration runtime.
Later implementation slices remain gated on all checks below.

## Current evidence

On 2026-10-04, the bundled CLI was verified as 0.160.0 and its protocol bindings
were regenerated. The local Node runtime is 26.10.0. Read-only app-server
initialization, account metadata and model catalog inspection succeeded.

The computer-use API rejected `/Applications/ChatGPT.app` with:

> Computer Use is not allowed to use the app 'com.openai.codex' for safety reasons.

The real admission probe also rejects worker dispatch: effective worker
app/MCP/plugin exposure and managed policy have not yet been verified. Its generated
`ThreadStartResponse.disabledPluginIds` comment explicitly says the field does
not yet filter plugin capabilities. Configuration overlays are proposed inputs,
not proof of enforcement. No model turn was dispatched by the probe.

A dedicated restricted app-server process is a supported candidate, not an
intrinsic API dead end. The generated public protocol has thread-specific
`app/installed` and `mcpServerStatus/list` readbacks. The next admission experiment
must inspect effective enabled/callable app state, fully paginated MCP status,
plugin provenance and safe managed-policy fields for the actual worker cwd.
Named local plugin disables do not override workspace-managed enabled states;
managed policy can also pin hooks. Do not treat an uninitialized empty inventory
or configured plugin IDs as proof of enforcement.

This prevents automated live Desktop validation in this chat. It does not prove
that the plugin itself is incompatible. Do not work around this through private
IPC, another UI automation technology, a hosted service or broader permissions.

## Package readback

The bundled `plugin/read` development endpoint recognized marketplace
`ultra-code-for-codex-local` and the `ultra-code` MCP server. It reported this
package as uninstalled and disabled, with zero reported hooks. Hook discovery
and trust therefore remain unverified; that readback does not establish the
cause. The manifest follows the current documented `extensions.com.openai.hooks`
path. Do not treat package parsing as installed hook execution.

A manual invocation of the built hook against one explicitly identified real
recorded turn returned verified `gpt-6.1-sol`, `ultra`, and `default` metadata
through the built MCP server. That proves the adapter on that record, not the
native `UserPromptSubmit` timing or hook trust flow.

## Required live observations

After `just setup` and `just check`, use the bundled CLI for installation:

```sh
/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex plugin marketplace add /Users/thomastiotto/GitRepos/ultra-code-for-codex
/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex plugin add ultra-code-for-codex@ultra-code-for-codex-local
```

Installation is a separate step from hook trust. Review the plugin-owned
`UserPromptSubmit` hook through Codex's normal trust UI. It registers metadata
only and does not dispatch workers. Preserve existing hooks and configuration.
The marketplace cache is a copy; source edits require normal plugin refresh.

1. Confirm the `ultra-code` local stdio server starts in Codex Desktop.
2. Open the plugin's thread entry point. Observe the panel beside the chat.
3. Use **Show this chat's workflows**, then let the current lead bind the nonce.
   Open it from another chat too; neither chat may inherit the other's identity.
4. Submit turns in Ultra, non-Ultra and Plan Mode. Check the exact matching
   `turn_id`, model, effort and collaboration mode returned by `ultra_context`.
   Unsupported or missing metadata must remain unknown. Plan Mode grants no write
   authority. No last-session or configuration inference is allowed.
5. Verify a bounded read-only worker completes and returns its actual result.
6. Verify the account/profile matches the selected lead and the requested model
   exists. Keep email addresses, tokens and other account secrets out of evidence.
7. Verify approval denial, read-only writes denied, and no hosted app/MCP,
   recursive-agent or workflow-control capabilities are inherited. A sandbox
   label alone does not establish tool restrictions.
8. Verify waiting does not generate lead inference for each progress update.

Record the observed host version, commands, expected/actual results and any
failure for each item. Do not mark the gate passed if any required observation is
missing. Runtime, recovery, concurrency, routing evaluation and external feature
publication follow only after this gate passes.

## State boundaries

The probe exposes context registration and panel binding only. Panel bindings
are in-process and do not claim workflow durability. There are no workflows,
scheduler, QuickJS execution or publication adapters yet. No model-cost savings
or complete feature QA has been established.
