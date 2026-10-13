import type {
  ArtifactRef,
  JsonValue,
  TaskResult,
  TaskSnapshot,
  TokenUsage,
} from '../contracts/workflow.js';

const tones: Record<string, string> = {
  running: 'running',
  queued: 'queued',
  waiting: 'attention',
  paused: 'attention',
  needs_reconciliation: 'attention',
  pending: 'attention',
  claimed: 'attention',
  completed: 'completed',
  cancelled: 'completed',
  resolved: 'completed',
  failed: 'failed',
};

export function StatusBadge({ state }: { state: string }) {
  return (
    <span className={`workflow-badge tone-${tones[state] ?? 'attention'}`}>
      {state.replaceAll('_', ' ')}
    </span>
  );
}

export function Acceptance({ value }: { value: string }) {
  return <span className="workflow-acceptance">Acceptance: {value}</span>;
}

export function elapsed(start: number, end: number): string {
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function Usage({
  value,
  complete = true,
}: {
  value: TokenUsage | null;
  complete?: boolean;
}) {
  if (!value) return <span className="workflow-muted">Tokens unknown</span>;
  return (
    <details className="workflow-usage">
      <summary>
        {value.totalTokens.toLocaleString()} tokens{!complete && ' (partial)'}
      </summary>
      <dl className="workflow-facts">
        <dt>Input</dt>
        <dd>{value.inputTokens.toLocaleString()}</dd>
        <dt>Cached input</dt>
        <dd>{value.cachedInputTokens.toLocaleString()} (included in input)</dd>
        <dt>Output</dt>
        <dd>{value.outputTokens.toLocaleString()}</dd>
        <dt>Reasoning output</dt>
        <dd>{value.reasoningOutputTokens.toLocaleString()} (included in output)</dd>
      </dl>
    </details>
  );
}

function safeLink(uri: string | undefined): string | undefined {
  if (!uri) return undefined;
  try {
    const url = new URL(uri);
    return ['https:', 'http:'].includes(url.protocol) ? uri : undefined;
  } catch {
    return undefined;
  }
}

export function Evidence({ artifacts }: { artifacts: ArtifactRef[] }) {
  if (!artifacts.length) return null;
  return (
    <div>
      <h5>Evidence</h5>
      <ul>
        {artifacts.map((artifact) => {
          const href = safeLink(artifact.uri);
          return (
            <li key={artifact.id}>
              {href ? (
                <a href={href} target="_blank" rel="noreferrer">
                  {artifact.description}
                </a>
              ) : (
                artifact.description
              )}
              {artifact.uri && !href && <span className="workflow-source">{artifact.uri}</span>}
              {artifact.revision && <span className="workflow-muted"> · {artifact.revision}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function ResultValue({ value }: { value: JsonValue }) {
  if (value === null) return null;
  return (
    <details className="workflow-result">
      <summary>Result</summary>
      <pre>{typeof value === 'string' ? value : JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}

export function TaskDetails({ task, now }: { task: TaskSnapshot; now: number }) {
  const result = task.result;
  return (
    <div className="workflow-detail">
      <dl className="workflow-facts">
        <dt>Requested model</dt>
        <dd>{task.requestedModel}</dd>
        <dt>Reported model</dt>
        <dd>{task.reportedModel ?? 'Not reported'}</dd>
        <dt>Effort</dt>
        <dd>{task.effort}</dd>
        <dt>Elapsed</dt>
        <dd>{elapsed(task.startedAt ?? task.createdAt, task.finishedAt ?? now)}</dd>
        <dt>Last activity</dt>
        <dd>
          {elapsed(task.lastActivityAt, now)} ago
          {task.lastActivity ? `: ${task.lastActivity}` : ' · No activity detail reported'}
        </dd>
      </dl>
      {task.waitingReason && <p className="workflow-waiting">Waiting: {task.waitingReason}</p>}
      <Usage value={task.usage ?? result?.usage ?? null} />
      <details>
        <summary>Why this model and effort</summary>
        <AssessmentDetails task={task} />
      </details>
      {result && <TaskResultDetails result={result} />}
    </div>
  );
}

function TaskResultDetails({ result }: { result: TaskResult }) {
  return (
    <div className="workflow-task-result">
      <p className="workflow-muted">Execution: {result.execution}</p>
      <Acceptance value={result.acceptance} />
      {result.error && <p className="workflow-error">{result.error}</p>}
      <ResultValue value={result.value} />
      <Evidence artifacts={result.evidence} />
      {result.unresolved.length > 0 && (
        <div>
          <h5>Unresolved acceptance</h5>
          <ul>
            {result.unresolved.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function AssessmentDetails({ task }: { task: TaskSnapshot }) {
  const values = [
    ['Model choice', task.assessment.modelRationale],
    ['Difficulty', task.assessment.difficulty],
    ['Uncertainty', task.assessment.uncertainty],
    ['Consequence', task.assessment.consequence],
    ['Verification', task.assessment.verificationBurden],
    ['Delegation benefit', task.assessment.delegationBenefit],
    ['Coordination overhead', task.assessment.coordinationOverhead],
  ];
  return (
    <dl className="workflow-facts">
      {values.map(([label, value]) => (
        <div className="workflow-fact" key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
