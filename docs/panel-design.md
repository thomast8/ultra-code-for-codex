# Quiet Ultra panel

The panel implements the approved [Figma lifecycle and agent drill-down design](https://www.figma.com/design/hCBUDMR1Vyam88CwN80p0X?node-id=9-31).

Before, every saved workflow appeared in the main view and every phase opened by default. After, active and unresolved work stays visible, the latest accepted result stays compact, and earlier settled results live in History. For example, a running workflow shows three agent squares, state counts, elapsed wall time and reported tokens before the user opens any detail.

- Blue dotted squares represent running agents, green checks completed agents, amber waiting/reconciliation, red failure, and neutral queued/cancelled states. Names and text states accompany colour. The first six agents have squares; a remaining count and the full list keep larger runs reachable.
- A square opens its agent directly. The agent view retains compact run totals and shows reported/requested model, effort, token breakdown, latest activity, evidence and routing rationale. Back preserves the list's completed-agent disclosure and returns keyboard focus.
- Elapsed time and token totals remain visible while collapsed. Finished runs use recorded finish timestamps; historical missing finish times remain unknown. Missing usage is not reported, partial accounting stays marked, and cached input/reasoning output remain subsets.
- Completion collapses the agent view. A reopened panel starts compact. UI expansion state is held only in React; saved workflow records and binding ownership remain authoritative.
- Failed, reconciliating and completed-but-unverified/blocked/incomplete work remains visible. Execution and acceptance are separate. Pending unclaimed handoffs on terminal runs remain excluded, while claimed/reconciliation work and Cancel stay reachable.
- Pause/resume/cancel use the existing per-run MCP controls. Closing the panel never cancels work. The redesign changes no backend contracts, worker permissions, model routing or storage.

The Figma macOS button component is an AppKit design asset without a React component in this repository. The implementation uses the existing native HTML button approach, styled to the design. Exported Figma icons are bundled locally as SVG data URLs, preserving their root dimensions; no temporary asset URLs are shipped.

## Verification

Focused UI regressions cover compact reopening, live collapsed usage, terminal clock freezing, unknown usage/time, history ordering, unresolved-work visibility, agent drill-down/back/focus, continuation links and existing polling/control/binding boundaries. The repository's mandatory pre-push `just check` supplies formatting, strict lint/types, full coverage and production build gates.

Real workflow QA on 2026-10-14 used the actual built local MCP server, verified current-turn context, normal MCP App bridge and durable runtime. No workers or model calls were dispatched. Browser observations confirmed live elapsed time, pause → paused, resume → running, completion collapse, identical frozen counters after reopening, saved History, and cancellation of only the selected QA run. A separately labelled three-agent fixture verified the visual agent squares, per-agent details, focus return and SVG geometry at the design's 370px width. Fixture token values are illustrative.

Native Desktop installation/refresh and native running-agent rendering are separate from this local MCP-backed browser check. The native lead tool currently rejects this chat's routed metadata; the redesign does not change that backend boundary or claim it fixed. The supported local MCP client resolved the same current-turn handle successfully.
