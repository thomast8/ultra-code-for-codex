# Ultra Code for Codex

Preserve the selected chat lead. This plugin is personal tooling and has no Codex Pilot, private Desktop IPC, or hosted-server dependency.

## Quality gates

Run `just setup` before the first commit. Run focused tests during implementation, `just quality` after coherent structural slices, and `just check` before delivery. The pre-push hook supplies the final full-suite gate; do not duplicate it immediately before push or bypass it.

Owned executable source uses strict TypeScript, ESLint complexity <=10, function length <=80 lines, and file length <=400 lines. Coverage thresholds: statements/lines/functions90%, branches85%. Generated protocol bindings are artifacts. No baseline debt, suppressions, or weakened thresholds.

## Boundaries

Slice1 must prove local stdio startup, Desktop panel rendering/binding, exact-turn mode, one restricted worker, account/profile/model, effective restrictions and reasonable waiting. Stop if a required host boundary fails. Record the exact failure. Never silently substitute privateIPC, a remote service or broader permissions.

Workers have explicit ownership and do not revert others' work. Keep new source modules small. Reviews/research remain read-only. Never delete worktrees or discard edits on cancellation.
