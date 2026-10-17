import type {
  HandoffSnapshot,
  PhaseRef,
  RunSnapshot,
  TaskSnapshot,
} from '../contracts/workflow.js';
import {
  Acceptance,
  BudgetNotice,
  CreditDetails,
  Evidence,
  ResultValue,
  StatusBadge,
  Usage,
} from './workflow-details.js';
import { taskLabel, visibleHandoffs } from './workflow-summary.js';

export function RunDetails({ run, runs }: { run: RunSnapshot; runs: RunSnapshot[] }) {
  const parent = runs.find((candidate) => candidate.id === run.parentRunId);
  const handoffs = visibleHandoffs(run);
  return (
    <div className="run-details">
      <p>{run.objective}</p>
      {run.error && <p className="workflow-error">{run.error}</p>}
      {run.parentRunId && (
        <p className="workflow-muted">
          Continues {parent ? <a href={`#run-${parent.id}`}>{parent.title}</a> : run.parentRunId}
        </p>
      )}
      <h4>Worker usage</h4>
      <Usage value={run.usage} complete={run.accountingComplete} />
      <CreditDetails run={run} />
      <BudgetNotice run={run} />
      <details>
        <summary>Acceptance criteria</summary>
        <ul>
          {run.acceptance.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      </details>
      {phaseList(run, handoffs).map((phase) => (
        <Phase
          key={phase.id}
          phase={phase}
          tasks={run.tasks.filter((task) => task.phase.id === phase.id)}
          handoffs={handoffs.filter((handoff) => handoff.spec.phase.id === phase.id)}
        />
      ))}
    </div>
  );
}

function count(value: number, noun: string): string {
  return `${value} ${noun}${value === 1 ? '' : 's'}`;
}

function Phase({
  phase,
  tasks,
  handoffs,
}: {
  phase: PhaseRef;
  tasks: TaskSnapshot[];
  handoffs: HandoffSnapshot[];
}) {
  const label = (
    <>
      <strong>{phase.label}</strong>
      <span className="workflow-muted">
        {count(tasks.length, 'task')} · {count(handoffs.length, 'handoff')}
      </span>
    </>
  );
  if (!tasks.length && !handoffs.length)
    return <div className="workflow-phase phase-empty">{label}</div>;
  return (
    <details className="workflow-phase">
      <summary>{label}</summary>
      {tasks.length > 0 && (
        <ul className="phase-tasks">
          {tasks.map((task) => (
            <li key={task.id}>
              <span>{task.title}</span>
              <span className="workflow-muted">{taskLabel(task)}</span>
            </li>
          ))}
        </ul>
      )}
      {handoffs.map((handoff) => (
        <Handoff key={handoff.id} handoff={handoff} />
      ))}
    </details>
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

function Handoff({ handoff }: { handoff: HandoffSnapshot }) {
  return (
    <details className="workflow-handoff">
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
