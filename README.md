# Retry policy fixture

A dependency-free JavaScript fixture for a bounded coding workflow check.
`resolveRetryPolicy(options)` returns a retry count. The accepted count inputs
are nonnegative safe integers, null, undefined, or an omitted value.
Null and missing values use three retries. An explicit zero means no retries.
Validation of other input types is outside this fixture's scope.

Use Node 26.10.0. Run `just setup`, `just quality`, `just test` and `just check`.
No dependency installation is required. Existing tests intentionally do not cover
every accepted input; a bug-fix change should add the missing regression test.
