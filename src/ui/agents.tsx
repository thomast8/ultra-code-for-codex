import { useEffect, useRef } from 'react';
import type { TaskSnapshot } from '../contracts/workflow.js';
import { Icon } from './icons.js';
import { elapsed, StatusBadge, TaskDetails } from './workflow-details.js';
import {
  finishedAgentLabel,
  taskElapsed,
  taskLabel,
  taskUsage,
  terminal,
  tokenLabel,
} from './workflow-summary.js';

type AgentsProps = { tasks: TaskSnapshot[]; now: number; select: (id: string) => void };

export function AgentPreview({ tasks, select }: Pick<AgentsProps, 'tasks' | 'select'>) {
  return (
    <div className="agent-preview" aria-label="Agent status preview">
      {tasks.slice(0, 6).map((task) => (
        <button
          type="button"
          className={`agent-square agent-${task.state}`}
          key={task.id}
          aria-label={`${task.title}: ${taskLabel(task)}`}
          title={`${task.title}: ${taskLabel(task)}`}
          onClick={() => select(task.id)}
        >
          <AgentSymbol task={task} />
        </button>
      ))}
      {tasks.length > 6 && <span className="workflow-muted">+{tasks.length - 6}</span>}
    </div>
  );
}

function AgentSymbol({ task }: { task: TaskSnapshot }) {
  if (task.state === 'running')
    return (
      <span className="agent-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    );
  if (task.state === 'completed') return <Icon name="check" />;
  const symbols: Record<string, string> = {
    failed: '!',
    needs_reconciliation: '!',
    waiting: 'Ⅱ',
    queued: '·',
    cancelled: '−',
  };
  return <span aria-hidden="true">{symbols[task.state]}</span>;
}

export function AgentList({ tasks, now, select }: AgentsProps) {
  const finished = tasks.filter((task) => ['completed', 'cancelled'].includes(task.state));
  const active = tasks.filter((task) => !finished.includes(task));
  return (
    <div className="agent-list">
      {active.map((task) => (
        <AgentRow key={task.id} task={task} now={now} select={select} />
      ))}
      {finished.length > 0 && (
        <details className="completed-agents">
          <summary>
            <Icon name="chevron" />
            {finishedAgentLabel(finished)}
          </summary>
          {finished.map((task) => (
            <AgentRow key={task.id} task={task} now={now} select={select} />
          ))}
        </details>
      )}
      {!tasks.length && <p className="workflow-muted">No agents dispatched yet.</p>}
    </div>
  );
}

function AgentRow({
  task,
  now,
  select,
}: {
  task: TaskSnapshot;
  now: number;
  select: AgentsProps['select'];
}) {
  return (
    <button
      type="button"
      className="agent-row"
      data-agent-id={task.id}
      onClick={() => select(task.id)}
    >
      {task.state === 'running' ? <Icon name="running" /> : <StatusBadge state={task.state} />}
      <span className="agent-row-copy">
        <span>
          {task.title} · {taskLabel(task)}
        </span>
        <small>
          {taskElapsed(task, now)} · {tokenLabel(taskUsage(task), terminal(task.state))}
        </small>
        <small>Phase: {task.phase.label}</small>
        {task.waitingReason && <small>{task.waitingReason}</small>}
      </span>
      <Icon name="right" />
    </button>
  );
}

export function AgentDetail({
  task,
  tasks,
  now,
  select,
  back,
}: AgentsProps & {
  task: TaskSnapshot;
  back: () => void;
}) {
  const usage = taskUsage(task);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [task.id]);
  return (
    <div className="agent-detail-view">
      <button type="button" className="quiet-button agent-back" onClick={back}>
        ‹ Back to all {tasks.length} agents
      </button>
      <h3 tabIndex={-1} ref={heading}>
        {task.title}
      </h3>
      <div className="agent-detail-card">
        <StatusBadge state={task.state} />
        <p className="workflow-muted">Phase: {task.phase.label}</p>
        <p className="agent-model">
          {task.reportedModel ?? `Requested: ${task.requestedModel}`} · {task.effort}
        </p>
        <p className="workflow-muted">
          {taskElapsed(task, now)} · {tokenLabel(usage, terminal(task.state))}
        </p>
        {usage && (
          <p className="workflow-muted">
            {usage.inputTokens.toLocaleString()} input · {usage.outputTokens.toLocaleString()}{' '}
            output
          </p>
        )}
        <p>{task.lastActivity ?? 'No activity detail reported'}</p>
        <p className="workflow-muted">Last activity {elapsed(task.lastActivityAt, now)} ago</p>
        {task.waitingReason && <p className="workflow-waiting">Waiting: {task.waitingReason}</p>}
        <details>
          <summary>View activity and evidence</summary>
          <TaskDetails task={task} now={now} />
        </details>
      </div>
      <details>
        <summary>
          <Icon name="chevron" />
          Other agents · {tasks.length - 1}
        </summary>
        <AgentList
          tasks={tasks.filter((candidate) => candidate.id !== task.id)}
          now={now}
          select={select}
        />
      </details>
    </div>
  );
}
