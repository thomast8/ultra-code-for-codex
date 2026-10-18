import type { RunSnapshot } from '../contracts/workflow.js';
import { elapsed, runTiming } from './workflow-time.js';

export function RunTiming({ run, now }: { run: RunSnapshot; now: number }) {
  const times = runTiming(run, now);
  return (
    <div className="run-timing">
      <dl className="workflow-facts">
        {(
          [
            ['Workers active', times.workers],
            ['Waiting', times.waiting],
            ['Lead review', times.review],
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
          Workers active measures wall time with at least one worker running. Lead review runs from
          handoff claim to resolution. Waiting covers time with neither active, including queues and
          unclaimed handoffs. Worker and lead time can overlap; parallel workers are counted once.
          These durations do not measure the lead’s unrecorded activity.
        </p>
      </details>
    </div>
  );
}
