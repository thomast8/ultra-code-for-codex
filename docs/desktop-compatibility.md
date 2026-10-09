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

The original portable manifest exposed the `ultra-code` MCP server but zero
hooks. A controlled comparison on bundled CLI 0.160.1 discovered the hook using
Codex's legacy `.codex-plugin/plugin.json` manifest and `.mcp.json` declaration.
Version 0.1.1 uses that layout and preserves the original portable files.
Discovery is separate from trust and native execution. On 2026-10-07,
normal installation of 0.1.1 returned installed/enabled state, one
`userPromptSubmit` hook and the `ultra-code` MCP server. `hooks/list` reported
that hook enabled but **untrusted**, with no hook errors. Native dispatch remains
pending the user's normal hook review.

A subsequent live `mcpServerStatus/list` check found 0.1.1 startup failed with
`No such file or directory`: the legacy MCP loader preserves root/data variable
placeholders literally. Version 0.1.2 uses the loader's supported relative cwd
and a Node launcher that derives the matching profile's plugin data directory
from the installed cache. This layout is tied to the verified 0.160.1 store
adapter; unsupported cache layouts fail instead of choosing another profile.

Installed 0.1.2 readback returns all three tools, the panel thread entrypoint and
no tools error. The current exact native-hook context resolves through that
installed launcher, and the inline panel resource returns successfully.
`hooks/list` now reports the hook **trusted**. The user confirmed the menu entry visible in Codex Desktop on 2026-10-07.
The native MCP tool also resolved this chat's exact current hook handle. Native
Ultra/Plan transition coverage and visual panel/binding QA remain incomplete.

Figma comparison: its plugin declares a connected app in `.app.json`; its
`open_figma_mcp_app_in_thread` tool advertises `ui.resourceUri` and global/thread
entrypoints. Codex's installed menu code accepts both connected-app and local
MCP entries. Our thread metadata matches that contract. We did not copy Figma's
hosted transport or authentication boundary.

The panel uses the installed MCP App SDK's registration helper, including its
legacy resource URI alias, and the documented `thread` entrypoint. This verifies
advertised tool metadata, not appearance in the Codex Tools menu.

A manual invocation of the built hook against one explicitly identified real
recorded turn returned verified `gpt-6.1-sol`, `ultra`, and `default` metadata
through the built MCP server. That proves the adapter on that record, not the
native `UserPromptSubmit` timing or hook trust flow.

## Required live observations

After `just setup` and `just check`, use the bundled CLI for installation:

```sh
/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex plugin marketplace add "$(pwd)"
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

The probe exposes context registration and panel binding only. Panel nonces and verified ownership
are stored in a private profile-specific SQLite database; this does not claim
workflow durability. A nonce claimed by an interrupted binder stays blocked,
and reopening the panel creates a new one. There are no workflows,
scheduler, QuickJS execution or publication adapters yet. No model-cost savings
or complete feature QA has been established.

## Cross-instance panel binding correction

The first native panel button message reached this chat, but binding returned
“Unknown or expired panel nonce.” A regression reproduced the failure across
two MCP server instances: each had a separate in-memory nonce map.

Version 0.1.3 shares nonce state through the profile's plugin data directory and
claims each nonce atomically. Ownership remains the verified instance/session;
a different chat or profile cannot reuse it. Existing bound same-chat retries
remain idempotent after process restart. Unknown contexts consume the nonce.

Installed-process QA used three real MCP subprocesses and the exact native-hook
context: the issuing process exited, another bound its nonce, and a third
verified the same-chat resolution. Database permissions were 0600. The original
in-memory nonce was not recreated or adopted; the native panel needs reopening
for end-to-end button-flow revalidation.

## Side-panel binding refresh correction

Native QA on 2026-10-09 confirmed that Codex queues app messages during an active
lead turn and dispatches them after that turn ends. These messages are not
steering commands. A separate binding tool result rendered a new inline view;
the original side panel remained waiting even though its nonce was bound.

Version 0.1.4 automatically binds agent-opened panels when `ultra_panel` receives
the verified lead `contextKey`. The result contains its nonce and binding outcome;
the UI renders it directly with no binding button or extra chat message. Missing
context remains a manual launch; invalid context fails rather than inferring a
session. The same ownership and atomic claim rules apply.

Version 0.1.4 also adds an app-only nonce-status read. The panel polls pending binding
state through the normal MCP App bridge without model calls and stops on a
terminal state or unmount. The read returns only the state, never chat, profile
or turn metadata. Repeated requests are disabled while one is pending.

This fix does not change the worker admission gate or add workflow execution.
The installed Desktop CLI is now 0.162.0-alpha.17.2; fresh root-chat logs of that
version remain unsupported by the existing 0.160.0/0.160.1 activation adapter.
The current longstanding chat continues to resolve its recorded exact-turn
metadata. Use the still-installed Node 26.10.0 for the pinned repository checks.

The first refreshed native panel still loaded the old UI during the active turn:
its script contained neither `ultra_panel_status` nor the new queued label.
Public standalone app-server discovery already reported installed 0.1.4. This is
a current-turn cache boundary, not evidence that the updated UI passed native QA.
A fresh native load must show automatic binding and original-panel status updates
before those behaviours can be marked Desktop-verified.

Later in the same chat, the native `ultra_panel` call with the verified handle
returned bound plus its nonce, and the user screenshot showed the new inline
view with no binding button. The manual side panel was a different pending nonce.
The supported MCP Apps surface observed tab 3 queued with its button disabled;
a separate native lead binding call changed that same tab to bound and removed
the button without reopening. These observations verify the two updated UI flows
in this chat; two-chat ownership and fresh-version activation remain separate.
