# Retry policy QA fixture

This is an isolated, dependency-free JavaScript bug-fix fixture. Edit only the
files assigned by the lead. Preserve unrelated work and do not delete files.

Run `just setup` before the first commit. It checks the pinned Node runtime;
there are no dependencies to install or generated caches to warm.
Run `just quality` after an implementation slice and `just check` before handoff.
The gates are Node syntax checks and the built-in test runner with 100% source
line, function and branch coverage. This small JavaScript fixture has no separate
TypeScript or external lint tool; do not add dependencies or weaken these gates.

Keep the change limited to retry-count defaulting and its tests. Use Node's
built-in assertions. Do not edit this guidance, the Justfile or setup scripts.
Do not commit, push, create a remote, or open a PR during a worker assignment.
The lead owns independent acceptance checks and any later publication.
