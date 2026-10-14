import { useEffect, useRef, useState } from 'react';
import type { RunSnapshot } from '../contracts/workflow.js';
import { AgentDetail, AgentList, AgentPreview } from './agents.js';
import { Icon } from './icons.js';
import { RunControls } from './run-controls.js';
import { RunDetails } from './run-details.js';
import { Acceptance, ResultValue, StatusBadge } from './workflow-details.js';
import type { RunAction } from './workflow-feed.js';
import {
  agentCounts,
  needsAttention,
  runElapsed,
  terminal,
  tokenLabel,
} from './workflow-summary.js';

type RunCardProps = {
  run: RunSnapshot;
  runs: RunSnapshot[];
  now: number;
  busy: boolean;
  error: string | undefined;
  control: (action: RunAction) => void;
};

export function RunCard({ run, runs, now, busy, error, control }: RunCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const section = useRef<HTMLElement>(null);
  const lastSelected = useRef<string | null>(null);
  useEffect(() => {
    if (selected) return;
    if (returnFocus.current?.isConnected) returnFocus.current.focus();
    else {
      const rows = section.current?.querySelectorAll<HTMLButtonElement>('[data-agent-id]') ?? [];
      [...rows].find((row) => row.dataset.agentId === lastSelected.current)?.focus();
    }
  }, [selected]);
  const attention = needsAttention(run);
  const finished = terminal(run.state);
  const select = (id: string) => {
    returnFocus.current = document.activeElement as HTMLElement;
    lastSelected.current = id;
    setExpanded(true);
    setSelected(id);
  };
  return (
    <section ref={section} className="workflow-run" aria-label={run.title} id={`run-${run.id}`}>
      <div hidden={selected !== null}>
        <RunSummary
          run={run}
          now={now}
          attention={attention}
          finished={finished}
          expanded={expanded}
          select={select}
          toggle={() => {
            setExpanded(!expanded);
            setSelected(null);
          }}
        />
      </div>
      {selected && (
        <div className="agent-run-context">
          <strong>{run.title}</strong>
          <RunCounters run={run} now={now} />
        </div>
      )}
      {attention && <Attention run={run} />}
      {error && (
        <p role="alert" className="workflow-error">
          {error}
        </p>
      )}
      <div id={`agents-${run.id}`} hidden={!expanded}>
        {expanded && (
          <>
            <AgentViews
              run={run}
              now={now}
              selected={selected}
              select={select}
              back={() => setSelected(null)}
            />
            <RunControls run={run} busy={busy} control={control} />
          </>
        )}
      </div>
      <details className="run-disclosure">
        <summary>
          <Icon name="chevron" />
          Run details
        </summary>
        <RunDetails run={run} runs={runs} />
      </details>
    </section>
  );
}

export function RunCounters({ run, now }: { run: RunSnapshot; now: number }) {
  return (
    <p className="run-counters workflow-muted">
      {runElapsed(run, now)} · {tokenLabel(run.usage, run.accountingComplete)}
    </p>
  );
}

function Attention({ run }: { run: RunSnapshot }) {
  return (
    <div className="run-attention">
      <div className="attention-heading">
        <Icon name="alert" />
        <strong>Review needed</strong>
      </div>
      <p>{attentionMessage(run)}</p>
      <Acceptance value={run.acceptanceOutcome} />
      <p>
        Completion and verification are separate. Open agents or Run details to inspect the
        evidence.
      </p>
    </div>
  );
}

function RunSummary({
  run,
  now,
  attention,
  finished,
  expanded,
  select,
  toggle,
}: {
  run: RunSnapshot;
  now: number;
  attention: boolean;
  finished: boolean;
  expanded: boolean;
  select: (id: string) => void;
  toggle: () => void;
}) {
  return (
    <>
      <header className="workflow-run-heading">
        <p className={`run-eyebrow ${attention ? 'attention-ink' : ''}`}>
          {attention ? 'Needs attention' : finished ? 'Latest result' : 'In progress'}
        </p>
        <h2>{run.title}</h2>
        <StatusBadge state={run.state} />
      </header>
      <div className="run-summary">
        <div className="agent-summary-heading">
          <AgentPreview tasks={run.tasks} select={select} />
          <strong>
            {run.tasks.length} {run.tasks.length === 1 ? 'agent' : 'agents'}
          </strong>
        </div>
        <p className="workflow-muted">{agentCounts(run.tasks)}</p>
        <RunCounters run={run} now={now} />
        {finished && <Acceptance value={run.acceptanceOutcome} />}
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={`agents-${run.id}`}
          onClick={() => {
            toggle();
          }}
        >
          {expanded ? 'Hide agents' : 'Show agents'}
        </button>
        {finished && <FinishedResult run={run} />}
      </div>
    </>
  );
}
function AgentViews({
  run,
  now,
  selected,
  select,
  back,
}: {
  run: RunSnapshot;
  now: number;
  selected: string | null;
  select: (id: string) => void;
  back: () => void;
}) {
  const task = run.tasks.find((candidate) => candidate.id === selected);
  return (
    <>
      <div hidden={Boolean(task)}>
        <AgentList tasks={run.tasks} now={now} select={select} />
      </div>
      {task && <AgentDetail task={task} tasks={run.tasks} now={now} select={select} back={back} />}
    </>
  );
}

function FinishedResult({ run }: { run: RunSnapshot }) {
  if (run.result === null) return null;
  const value = typeof run.result === 'string' ? run.result : JSON.stringify(run.result);
  return (
    <>
      <p className="compact-result">{value.length > 160 ? `${value.slice(0, 160)}…` : value}</p>
      <ResultValue value={run.result} />
    </>
  );
}

function attentionMessage(run: RunSnapshot): string {
  if (run.error) return run.error;
  const handoff = run.handoffs.find((item) => item.state !== 'resolved');
  if (handoff && !terminal(run.state)) return handoff.spec.objective;
  const failed = run.tasks.find((task) => ['failed', 'needs_reconciliation'].includes(task.state));
  return failed?.result?.error ?? 'An agent, lead decision or acceptance check needs attention.';
}
