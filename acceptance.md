# Acceptance ledger

## Verified locally

- [x] New repository, feature branch and repository-supported setup.
- [x] Strict lint, TypeScript, formatting, coverage gates and build.
- [x] Actual standalone stdio MCP handshake, tool listing and inline panel resource.
- [x] Explicit one-time chat/profile binding and failure isolation in simulated-host tests.
- [x] Built hook plus MCP resolver on one exact real recorded Ultra turn.
- [x] Bundled CLI metadata inspection and unresolved admission blocking dispatch.
- [x] Installed/enabled 0.1.2: public MCP discovery returns three tools with no error.
- [x] User confirmed the Codex Desktop Tools-menu entry is visible.
- [x] Native chat MCP tool resolves the current exact hook context.
- [x] Built-hook process QA: safe failure diagnostics, Ultra gating and Plan reminder.

These checks are supporting evidence. They do not satisfy the live Desktop gate.

## Gate 1: incomplete

| Required observation                  | Current evidence / blocker                                                              |
| ------------------------------------- | --------------------------------------------------------------------------------------- |
| Desktop local stdio startup           | Native chat MCP call and public discovery passed; rendering unverified.                 |
| Desktop side-panel rendering          | Computer-use access to `com.openai.codex` is denied.                                    |
| Correct chat binding                  | Protocol and simulated-host tests passed; two live chats unverified.                    |
| Exact-turn Ultra / Plan detection     | Fixtures/recorded Ultra/current native context passed; live mode transitions pending.   |
| Bounded read-only worker/result       | No worker turn dispatched while admission is unverified.                                |
| Correct account/profile/model         | CLI catalog/account metadata read; match to selected Desktop lead unverified.           |
| Effective restrictions/capacity       | Supported readback route identified; dedicated profile/managed policy not yet verified. |
| Waiting without excess lead inference | No workflow wait/runtime implemented; live behavior unverified.                         |

The original portable package exposed zero hooks. A controlled bundled 0.160.1
comparison discovers the plugin-owned hook through the legacy manifest.
Installed hook is trusted and the current exact native handle resolves. The user confirmed Tools-menu visibility. Panel rendering and binding still require
live host verification; tool discovery alone does not establish them.

## Later slices: not started behind Gate 1

- [ ] General dynamic runtime, immutable starts, QuickJS, journal, replay and recovery.
- [ ] Multiple workflows, fair scheduling, resource leases and isolated controls.
- [ ] Verified bounded workers and durable lead handoffs.
- [ ] Selective cost-aware authoring policy and arbitrary workflow examples.
- [ ] Complete panel, results, usage and pending work.
- [ ] Live Desktop, general and isolated coding-to-ready-PR QA.
- [ ] Frozen routing/quality/cost comparison.
- [ ] Feature-ready self-review, push, ready PR and remote readback.

Preserve this probe and exact evidence. Do not substitute private IPC, a hosted
service, Codex Pilot or broader permissions to bypass the required host gate.
