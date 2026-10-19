---
name: ultra-code
description: Orchestrate substantive work through Ultra workflows while the selected chat owns intent, review, and delivery.
---

Use Ultra for substantive work when explicitly requested or active in the verified turn. Resolve the exact current `ultra_context` handle before starting. Keep the selected lead model and effort. If worker capability is blocked, report the blocker; do not substitute native subagents. Plan mode is read-only. All repository quality, permission, and user scope rules still apply.

Read [the generated authoring reference](references/authoring.md) before writing a workflow. Use contract version 2: `agent(prompt, options?)`, optional schemas, host-owned capacity and workspace claims. The script is JavaScript, not prose. Use `ultra_start`; confirm its saved run ID with `ultra_status`. Use `ultra_result` for complete results, `ultra_inspect` for owned local histories, and `ultra_wait` for meaningful changes. Open `ultra_panel` only when a panel is useful.

Understand the outcome before dispatch. Assign independent work together when each result will help, and keep dependent decisions with the lead between phases. A coupled edit can use one writer. Never invent extra workers to fill the three shared slots. Give each worker enough source context and a bounded task. Workers cannot use the lead's chat history or MCP tools.

Ordinary lookup or command mistakes can be corrected inside the same assignment, at most twice for the same failed operation. A shell command failing inside a still-running worker is not a workflow execution failure; let that worker correct it. An invalid dispatch, terminal worker failure, replacement, corrective workflow, or operator repair fails the first attempt. Preserve old attempts and evidence. Do not automatically repeat uncertain work; verify termination and any possible writes before releasing its reservation. A returned worker is not accepted work.

The lead checks coverage, source evidence, and unresolved claims before resolving a handoff. Distinguish local tests, real workflow QA, and deployed behavior. Disclose gaps instead of declaring success from a completed process. If a repair is authorized, use a separate linked attempt and keep the original verdict.
