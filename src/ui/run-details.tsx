import type { HandoffSnapshot, PhaseRef, RunSnapshot } from '../contracts/workflow.js';
import { Acceptance, Evidence, ResultValue, StatusBadge, Usage } from './workflow-details.js';
import { visibleHandoffs } from './workflow-summary.js';

export function RunDetails({ run, runs }: { run: RunSnapshot; runs: RunSnapshot[] }) {
  const parent = runs.find((candidate) => candidate.id === run.parentRunId);
  const handoffs = visibleHandoffs(run);
  return (
    <div className="run-details">
      <p>{run.objective}</p>
      {run.parentRunId && (
        <p className="workflow-muted">
          Continues {parent ? <a href={`#run-${parent.id}`}>{parent.title}</a> : run.parentRunId}
        </p>
      )}
      <Acceptance value={run.acceptanceOutcome} />
      <h4>Worker usage</h4>
      <Usage value={run.usage} complete={run.accountingComplete} />
      <p>Main chat token usage: unknown. Worker coverage does not include lead overhead.</p>
      <details>
        <summary>Acceptance criteria</summary>
        <ul>
          {run.acceptance.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      </details>
      {phaseList(run, handoffs).map((phase) => (
        <details className="workflow-phase" key={phase.id}>
          <summary>
            <strong>{phase.label}</strong>{' '}
            <span className="workflow-muted">
              {run.tasks.filter((task) => task.phase.id === phase.id).length} tasks ·{' '}
              {handoffs.filter((handoff) => handoff.spec.phase.id === phase.id).length} handoffs
            </span>
          </summary>
          {handoffs
            .filter((handoff) => handoff.spec.phase.id === phase.id)
            .map((handoff) => (
              <Handoff key={handoff.id} handoff={handoff} />
            ))}
        </details>
      ))}
      <ResultValue value={run.result} />
    </div>
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
