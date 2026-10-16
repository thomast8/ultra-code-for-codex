import { useEffect, useRef, useState } from 'react';
import type { RunSnapshot } from '../contracts/workflow.js';
import { AgentDetail, AgentList, AgentPreview } from './agents.js';
import { Icon } from './icons.js';
import { controlsAvailable, RunControls } from './run-controls.js';
import { RunDetails } from './run-details.js';
import { resultSummary, unwrapLeadResult } from './result-value.js';
import { Acceptance, BudgetNotice, ResultValue, StatusBadge } from './workflow-details.js';
import { creditLabel, estimateRunCredits } from './credit-estimate.js';
import type { RunAction } from './workflow-feed.js';
import {
  agentCounts,
  attentionMessage,
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
  const returned = useRef(false);
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
  const back = () => {
    returned.current = true;
    setSelected(null);
  };
  return (
    <section ref={section} className="workflow-run" aria-label={run.title} id={`run-${run.id}`}>
      {selected === null ? (
        <div className={returned.current ? 'run-overview returned' : 'run-overview'}>
          <RunSummary
            run={run}
            now={now}
            attention={attention}
            finished={finished}
            expanded={expanded}
            select={select}
            toggle={() => setExpanded(!expanded)}
          />
        </div>
      ) : (
        <AgentNav run={run} now={now} back={back} />
      )}
      {error && (
        <p role="alert" className="workflow-error">
          {error}
        </p>
      )}
      <div id={`agents-${run.id}`} hidden={!expanded}>
        {expanded && (
          <>
            <AgentViews run={run} now={now} selected={selected} select={select} />
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

function AgentNav({ run, now, back }: { run: RunSnapshot; now: number; back: () => void }) {
  return (
    <nav className="agent-nav" aria-label="Agent navigation">
      <button
        type="button"
        className="quiet-button agent-back"
        aria-label={`Back to all ${run.tasks.length} agents`}
        onClick={back}
      >
        <Icon name="right" />
        All agents
      </button>
      <span className="agent-nav-context">
        <strong>{run.title}</strong>
        <RunCounters run={run} now={now} />
      </span>
    </nav>
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
    <div className="run-attention" role="note">
      <Icon name="alert" />
      <div>
        <strong>Review needed</strong>
        <p>{attentionMessage(run)}</p>
      </div>
    </div>
  );
}

function eyebrow(attention: boolean, finished: boolean): string {
  if (attention) return 'Needs attention';
  return finished ? 'Latest result' : 'In progress';
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
  const showAgents = run.tasks.length > 0 || controlsAvailable(run);
  return (
    <>
      <header className="workflow-run-heading">
        <div className="run-title">
          <p className={`run-eyebrow ${attention ? 'attention-ink' : ''}`}>
            {eyebrow(attention, finished)}
          </p>
          <h2>{run.title}</h2>
        </div>
        <StatusBadge state={run.state} />
      </header>
      {attention && <Attention run={run} />}
      <BudgetNotice run={run} />
      <div className="run-summary">
        {finished && <FinishedResult run={run} />}
        {showAgents && <AgentSummary run={run} select={select} />}
        <div className="run-meta">
          <RunCounters run={run} now={now} />
          {finished && <Acceptance value={run.acceptanceOutcome} />}
        </div>
        <CreditPreview run={run} />
        {showAgents && (
          <button
            type="button"
            className="disclosure-button"
            aria-expanded={expanded}
            aria-controls={`agents-${run.id}`}
            onClick={toggle}
          >
            <Icon name="chevron" />
            {expanded ? 'Hide agents' : 'Show agents'}
          </button>
        )}
      </div>
    </>
  );
}
function CreditPreview({ run }: { run: RunSnapshot }) {
  const estimate = estimateRunCredits(run);
  if (!estimate) return null;
  return (
    <p className="run-credit-preview workflow-muted">
      Standard-rate worker estimate: {creditLabel(estimate)}
      {!run.accountingComplete && ' (partial)'}
      {!estimate.cacheWritesKnown && ' (cache writes unreported)'}
    </p>
  );
}
function AgentSummary({ run, select }: { run: RunSnapshot; select: (id: string) => void }) {
  return (
    <div className="agent-summary-heading">
      <AgentPreview tasks={run.tasks} select={select} />
      <span className="agent-summary-copy">
        <strong>
          {run.tasks.length} {run.tasks.length === 1 ? 'agent' : 'agents'}
        </strong>
        <span className="workflow-muted">{agentCounts(run.tasks)}</span>
      </span>
    </div>
  );
}

function AgentViews({
  run,
  now,
  selected,
  select,
}: {
  run: RunSnapshot;
  now: number;
  selected: string | null;
  select: (id: string) => void;
}) {
  const task = run.tasks.find((candidate) => candidate.id === selected);
  return (
    <>
      <div hidden={Boolean(task)}>
        <AgentList tasks={run.tasks} now={now} select={select} />
      </div>
      {task && <AgentDetail task={task} tasks={run.tasks} now={now} select={select} />}
    </>
  );
}

function FinishedResult({ run }: { run: RunSnapshot }) {
  const value = unwrapLeadResult(run.result);
  const summary = resultSummary(value);
  if (!summary) return null;
  const structured = typeof value === 'object' && value !== null;
  const longScalar = typeof value === 'string' && value.length > 160;
  return (
    <div className="run-result">
      <p className="run-result-summary">{summary.text}</p>
      {(structured || longScalar) && (
        <ResultValue value={value} omit={summary.key} label="Result details" />
      )}
    </div>
  );
}
