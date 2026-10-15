import type { RunSnapshot } from '../contracts/workflow.js';
import type { RunAction } from './workflow-feed.js';
import { terminal } from './workflow-summary.js';

export function controlsAvailable(run: RunSnapshot): boolean {
  return (
    !terminal(run.state) ||
    run.tasks.some((task) => task.state === 'running') ||
    run.handoffs.some((handoff) => handoff.state === 'claimed')
  );
}

export function RunControls({
  run,
  busy,
  control,
}: {
  run: RunSnapshot;
  busy: boolean;
  control: (action: RunAction) => void;
}) {
  if (!controlsAvailable(run)) return null;
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
