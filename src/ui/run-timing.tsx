import type { RunSnapshot } from '../contracts/workflow.js';
import { elapsed, runTiming } from './workflow-time.js';

export function RunTiming({ run, now }: { run: RunSnapshot; now: number }) {
  const times = runTiming(run, now);
  return (
    <div className="run-timing">
      <dl className="workflow-facts">
        {(
          [
            ['Workers only', times.workersOnly],
            ['Lead review only', times.reviewOnly],
            ['Workers and lead review', times.overlap],
            ['Waiting or other', times.waiting],
            ['Cumulative worker time', times.workerSum],
          ] as const
        ).map(([label, value]) => (
          <div className="workflow-fact" key={label}>
            <dt>{label}</dt>
            <dd>{value === null ? 'Unknown' : elapsed(0, value)}</dd>
          </div>
        ))}
      </dl>
      <details className="workflow-muted">
        <summary>Timing definitions</summary>
        <p>
          The first four rows partition elapsed wall time. Lead review runs from handoff claim to
          resolution. Cumulative worker time adds agent durations and can exceed elapsed time when
          agents run in parallel. Unrecorded lead activity is included in waiting or other.
        </p>
      </details>
    </div>
  );
}
