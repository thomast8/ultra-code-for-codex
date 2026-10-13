import { useEffect, useState } from 'react';
import type { App } from '@modelcontextprotocol/ext-apps';
import type {
  HandoffSnapshot,
  PhaseRef,
  RunSnapshot,
  TaskSnapshot,
} from '../contracts/workflow.js';
import {
  Acceptance,
  elapsed,
  Evidence,
  ResultValue,
  StatusBadge,
  TaskDetails,
  Usage,
} from './workflow-details.js';
import { emptyDashboard, WorkflowFeed, type RunAction } from './workflow-feed.js';

export function Dashboard({ app, nonce }: { app: Pick<App, 'callServerTool'>; nonce: string }) {
  const [state, setState] = useState(emptyDashboard);
  const [now, setNow] = useState(Date.now);
  const [feed] = useState(() => new WorkflowFeed(app, setState));
  useEffect(() => {
    feed.bind(nonce);
  }, [feed, nonce]);
  useEffect(() => () => feed.close(), [feed]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="workflow-dashboard">
      <h2>Workflows</h2>
      {state.loading && <p role="status">Reading this chat’s workflows…</p>}
      {state.error && (
        <div role="alert">
          <p>{state.error}</p>
          <button type="button" onClick={() => feed.refresh()}>
            Retry workflow status
          </button>
        </div>
      )}
      {!state.loading && !state.error && !state.runs.length && <p>No workflows yet.</p>}
      {state.runs.map((run) => (
        <RunCard
          key={run.id}
          run={run}
          runs={state.runs}
          now={now}
          busy={state.busyRuns.includes(run.id)}
          error={state.controlErrors[run.id]}
          control={(action) => void feed.control(run.id, action)}
        />
      ))}
      {state.runs.length > 0 && (
        <p className="workflow-muted workflow-note">
          Quiet periods do not indicate a stalled task.
        </p>
      )}
    </div>
  );
}

type RunCardProps = {
  run: RunSnapshot;
  runs: RunSnapshot[];
  now: number;
  busy: boolean;
  error: string | undefined;
  control: (action: RunAction) => void;
};

function RunCard({ run, runs, now, busy, error, control }: RunCardProps) {
  const parent = runs.find((candidate) => candidate.id === run.parentRunId);
  const terminal = ['completed', 'cancelled', 'failed'].includes(run.state);
  const handoffs = run.handoffs.filter((handoff) => !terminal || handoff.state !== 'pending');
  const phases = phaseList(run, handoffs);
  return (
    <section className="workflow-run" aria-label={run.title} id={`run-${run.id}`}>
      <header className="workflow-run-heading">
        <h3>{run.title}</h3>
        <StatusBadge state={run.state} />
      </header>
      <p>{run.objective}</p>
      {run.parentRunId && (
        <p className="workflow-muted">
          Continues {parent ? <a href={`#run-${parent.id}`}>{parent.title}</a> : run.parentRunId}
        </p>
      )}
      <div className="workflow-meta">
        <Acceptance value={run.acceptanceOutcome} />
        <span>
          Elapsed{' '}
          {terminal && run.finishedAt === null
            ? 'unknown'
            : elapsed(run.createdAt, run.finishedAt ?? now)}
        </span>
        <Usage value={run.usage} complete={run.accountingComplete} />
      </div>
      <RunControls run={run} busy={busy} control={control} />
      {error && (
        <p role="alert" className="workflow-error">
          {error}
        </p>
      )}
      {run.error && <p className="workflow-error">{run.error}</p>}
      <details>
        <summary>Acceptance criteria</summary>
        <ul>
          {run.acceptance.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      </details>
      {phases.map((phase) => (
        <Phase
          key={phase.id}
          phase={phase}
          tasks={run.tasks.filter((task) => task.phase.id === phase.id)}
          handoffs={handoffs.filter((handoff) => handoff.spec.phase.id === phase.id)}
          now={now}
        />
      ))}
      <ResultValue value={run.result} />
    </section>
  );
}

function phaseList(run: RunSnapshot, handoffs: HandoffSnapshot[]): PhaseRef[] {
  const phases = new Map<string, PhaseRef>();
  for (const phase of [
    ...run.phases,
    ...run.tasks.map((task) => task.phase),
    ...handoffs.map((handoff) => handoff.spec.phase),
  ]) {
    if (!phases.has(phase.id)) phases.set(phase.id, phase);
  }
  return [...phases.values()];
}

function RunControls({ run, busy, control }: Pick<RunCardProps, 'run' | 'busy' | 'control'>) {
  const terminal = ['completed', 'cancelled', 'failed'].includes(run.state);
  const active =
    run.tasks.some((task) => task.state === 'running') ||
    run.handoffs.some((handoff) => handoff.state === 'claimed');
  if (terminal && !active) return null;
  return (
    <div className="workflow-controls" aria-label={`Controls for ${run.title}`}>
      {['running', 'queued'].includes(run.state) && (
        <button
          type="button"
          disabled={busy}
          aria-label={`Pause ${run.title}`}
          onClick={() => control('pause')}
        >
          Pause
        </button>
      )}
      {run.state === 'paused' && (
        <button
          type="button"
          disabled={busy}
          aria-label={`Resume ${run.title}`}
          onClick={() => control('resume')}
        >
          Resume
        </button>
      )}
      <button
        type="button"
        disabled={busy}
        aria-label={`Cancel ${run.title}`}
        onClick={() => control('cancel')}
      >
        Cancel
      </button>
      {busy && <span className="workflow-muted">Applying…</span>}
    </div>
  );
}

function Phase({
  phase,
  tasks,
  handoffs,
  now,
}: {
  phase: PhaseRef;
  tasks: TaskSnapshot[];
  handoffs: HandoffSnapshot[];
  now: number;
}) {
  return (
    <details className="workflow-phase" open>
      <summary>
        <strong>{phase.label}</strong>{' '}
        <span className="workflow-muted">
          {tasks.length} tasks · {handoffs.length} handoffs
        </span>
      </summary>
      {tasks.map((task) => (
        <details className="workflow-task" key={task.id}>
          <summary>
            <span>{task.title}</span>
            <StatusBadge state={task.state} />
            <span className="workflow-task-model">
              {task.requestedModel} · {task.effort}
            </span>
          </summary>
          <TaskDetails task={task} now={now} />
        </details>
      ))}
      {handoffs.map((handoff) => (
        <Handoff key={handoff.id} handoff={handoff} />
      ))}
    </details>
  );
}

function Handoff({ handoff }: { handoff: HandoffSnapshot }) {
  return (
    <details className="workflow-handoff" open={handoff.state !== 'resolved'}>
      <summary>
        Lead handoff <StatusBadge state={handoff.state} />
      </summary>
      <p>{handoff.spec.objective}</p>
      {handoff.state === 'pending' && <p className="workflow-waiting">Waiting for the lead.</p>}
      {handoff.state === 'claimed' && <p>Lead review in progress.</p>}
      <Evidence artifacts={handoff.spec.evidence} />
      {handoff.result && (
        <div>
          <Acceptance value={handoff.result.acceptance} />
          <ResultValue value={handoff.result.value} />
          <Evidence artifacts={handoff.result.evidence} />
        </div>
      )}
    </details>
  );
}
