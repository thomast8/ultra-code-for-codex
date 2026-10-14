import { useEffect, useState, type MouseEvent } from 'react';
import type { App } from '@modelcontextprotocol/ext-apps';
import { Brand, Icon } from './icons.js';
import { RunCard } from './run-card.js';
import { emptyDashboard, WorkflowFeed, type DashboardState } from './workflow-feed.js';
import { runGroups, terminal } from './workflow-summary.js';

export function Dashboard({ app, nonce }: { app: Pick<App, 'callServerTool'>; nonce: string }) {
  const [state, setState] = useState(emptyDashboard);
  const [now, setNow] = useState(Date.now);
  const [historyView, setHistory] = useState({ nonce, open: false });
  const history = historyView.nonce === nonce && historyView.open;
  const [feed] = useState(() => new WorkflowFeed(app, setState));
  useEffect(() => {
    feed.bind(nonce);
  }, [feed, nonce]);
  useEffect(() => () => feed.close(), [feed]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const groups = runGroups(state.runs);
  const visible = history ? groups.history : [...groups.current, ...groups.latest];
  const followRun = (event: MouseEvent<HTMLDivElement>) => {
    if (!(event.target instanceof Element)) return;
    const link = event.target.closest('a[href^="#run-"]');
    const id = link?.getAttribute('href')?.slice(5);
    if (!id || !state.runs.some((run) => run.id === id)) return;
    event.preventDefault();
    setHistory({ nonce, open: groups.history.some((run) => run.id === id) });
    requestAnimationFrame(() => document.getElementById(`run-${id}`)?.scrollIntoView());
  };
  return (
    <div className="workflow-dashboard" onClick={followRun}>
      <DashboardHeader
        history={history}
        count={groups.history.length}
        toggle={() => setHistory({ nonce, open: !history })}
      />
      <div className="dashboard-content">
        {history && <h2 className="history-title">Earlier results</h2>}
        <FeedStatus state={state} retry={() => feed.refresh()} />
        {history && !groups.history.length && (
          <p className="empty-state">
            No earlier results. Active and unresolved work stays in the current view.
          </p>
        )}
        {visible.map((run) => (
          <RunCard
            key={`${nonce}:${run.id}:${terminal(run.state)}`}
            run={run}
            runs={state.runs}
            now={now}
            busy={state.busyRuns.includes(run.id)}
            error={state.controlErrors[run.id]}
            control={(action) => void feed.control(run.id, action)}
          />
        ))}
      </div>
      <footer className="ultra-footer">
        <details>
          <summary>
            <Icon name="chevron" />
            About Ultra
          </summary>
          <p>
            Closing this panel does not cancel work, and quiet periods do not mean a task has
            stalled. Token totals include reported worker usage; partial or missing usage is marked.
          </p>
        </details>
        <span>This chat</span>
      </footer>
    </div>
  );
}

function DashboardHeader({
  history,
  count,
  toggle,
}: {
  history: boolean;
  count: number;
  toggle: () => void;
}) {
  return (
    <header className="ultra-header">
      <h1>
        <Brand />
      </h1>
      <button type="button" className="quiet-button" aria-expanded={history} onClick={toggle}>
        <Icon name="clock" />
        {history ? 'Back to current' : `History${count ? ` · ${count}` : ''}`}
      </button>
    </header>
  );
}
function FeedStatus({ state, retry }: { state: DashboardState; retry: () => void }) {
  return (
    <>
      {state.loading && <p role="status">Reading this chat’s workflows…</p>}
      {state.error && (
        <div role="alert">
          <p>{state.error}</p>
          <button type="button" onClick={retry}>
            Retry workflow status
          </button>
        </div>
      )}
      {!state.loading && !state.error && !state.runs.length && (
        <p className="empty-state">No workflows yet.</p>
      )}
    </>
  );
}
