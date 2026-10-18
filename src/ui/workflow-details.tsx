import { elapsed, taskElapsed } from './workflow-time.js';
import { safeLink, StructuredValue } from './result-value.js';
import type {
  ArtifactRef,
  JsonValue,
  TaskResult,
  TaskSnapshot,
  TokenUsage,
  RunSnapshot,
} from '../contracts/workflow.js';
import { creditLabel, estimateRunCredits, RATE_CARD_URL, validUsage } from './credit-estimate.js';

const tones: Record<string, string> = {
  running: 'running',
  queued: 'queued',
  waiting: 'attention',
  paused: 'attention',
  needs_reconciliation: 'attention',
  pending: 'attention',
  claimed: 'attention',
  completed: 'completed',
  succeeded: 'completed',
  cancelled: 'queued',
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
  return (
    <span
      className={`workflow-badge workflow-acceptance tone-${value === 'satisfied' ? 'completed' : 'attention'}`}
    >
      Acceptance: {value}
    </span>
  );
}

export { elapsed } from './workflow-time.js';

export function Usage({
  value,
  complete = true,
}: {
  value: TokenUsage | null;
  complete?: boolean;
}) {
  if (!value) return <span className="workflow-muted">Tokens not reported</span>;
  const valid = validUsage(value);
  const uncached = valid ? value.inputTokens - value.cachedInputTokens : null;
  const writes = value.cacheWriteInputTokens;
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
        <dt>Uncached input</dt>
        <dd>
          {uncached === null
            ? 'Unknown (inconsistent usage)'
            : `${uncached.toLocaleString()} (includes possible free cache writes)`}
        </dd>
        <dt>Cache writes</dt>
        <dd>{writes === undefined ? 'Not reported' : `${writes.toLocaleString()} (free)`}</dd>
        <dt>New input after cache writes</dt>
        <dd>
          {uncached === null
            ? 'Unknown (inconsistent usage)'
            : writes === undefined
              ? 'Unknown'
              : (uncached - writes).toLocaleString()}
        </dd>
        <dt>Output</dt>
        <dd>{value.outputTokens.toLocaleString()}</dd>
        <dt>Reasoning output</dt>
        <dd>{value.reasoningOutputTokens.toLocaleString()} (included in output)</dd>
      </dl>
    </details>
  );
}

export function BudgetNotice({ run }: { run: RunSnapshot }) {
  const limit = run.budget?.maxObservedTokens;
  const observed = run.usage?.totalTokens;
  if (!limit || observed === undefined || observed < limit) return null;
  return (
    <p className="workflow-waiting" role="note">
      Soft token threshold reached: {observed.toLocaleString()} / {limit.toLocaleString()} observed
      worker tokens ({(observed - limit).toLocaleString()} over). Running workers finish; later
      worker dispatch is blocked.
    </p>
  );
}

export function CreditDetails({ run }: { run: RunSnapshot }) {
  const estimate = estimateRunCredits(run);
  return (
    <div className="workflow-credit-details">
      <p>
        Standard-rate worker estimate: {estimate ? creditLabel(estimate) : 'unknown'}
        {estimate && !run.accountingComplete ? ' (partial)' : ''}
        {estimate && !estimate.cacheWritesKnown ? ' (cache writes unreported)' : ''}.
      </p>
      {estimate && estimate.models.length > 0 && (
        <p>Reported models: {estimate.models.join(', ')}.</p>
      )}
      <p className="workflow-muted">
        <a href={RATE_CARD_URL} target="_blank" rel="noreferrer">
          OpenAI ChatGPT Work and Codex Standard rate card
        </a>{' '}
        checked 15 October 2026. Actual charged credits unknown; plan allowances and speed mode may
        differ. Main chat usage is excluded.
      </p>
    </div>
  );
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

export function ResultValue({
  value,
  omit = null,
  label = 'Result',
}: {
  value: JsonValue;
  omit?: string | null;
  label?: string;
}) {
  if (value === null) return null;
  return (
    <details className="workflow-result">
      <summary>{label}</summary>
      <StructuredValue value={value} omit={omit} />
    </details>
  );
}

export function taskRoutingLabel(task: TaskSnapshot): string {
  const model = task.reportedModel
    ? `Reported model: ${task.reportedModel}`
    : `Requested model: ${task.requestedModel} (unverified)`;
  return `${model} · Requested reasoning effort: ${task.effort}`;
}

export function TaskDetails({ task, now }: { task: TaskSnapshot; now: number }) {
  const result = task.result;
  return (
    <div className="workflow-detail">
      <dl className="workflow-facts">
        <dt>Requested model</dt>
        <dd>
          {task.requestedModel}
          {!task.reportedModel && ' (unverified)'}
        </dd>
        <dt>Reported model</dt>
        <dd>{task.reportedModel ?? 'Not reported'}</dd>
        <dt>Requested reasoning effort</dt>
        <dd>{task.effort}</dd>
        <dt>Elapsed</dt>
        <dd>{taskElapsed(task, now)}</dd>
        <dt>Last activity</dt>
        <dd>
          {elapsed(task.lastActivityAt, now)} ago
          {task.lastActivity ? `: ${task.lastActivity}` : ' · No activity detail reported'}
        </dd>
      </dl>
      {task.waitingReason && <p className="workflow-waiting">Waiting: {task.waitingReason}</p>}
      <Usage
        value={task.usage ?? result?.usage ?? null}
        complete={['completed', 'cancelled', 'failed'].includes(task.state)}
      />
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
