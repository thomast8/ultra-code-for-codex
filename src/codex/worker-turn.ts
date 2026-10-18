import type { AgentSpec, TaskResult, WorkerOptions } from '../contracts/workflow.js';
import type { ThreadEnvironment } from './generated/v2/ThreadEnvironment.js';
import type { SandboxPolicy } from './generated/v2/SandboxPolicy.js';
import type { TurnStartParams } from './generated/v2/TurnStartParams.js';
import type { TurnStartResponse } from './generated/v2/TurnStartResponse.js';
import { WorkerTurnEvents } from './worker-events.js';
import { workerTransportFailure } from './diagnostics.js';
import { type OutputContract, parseWorkerOutput } from './worker-output.js';
import { WorkerBlocked, workerRequest, type WorkerTransport } from './worker-protocol.js';

function deadline<T>(promise: Promise<T>, milliseconds: number): Promise<T | null> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    promise,
    new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), milliseconds);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function interruptWorker(
  transport: WorkerTransport,
  events: WorkerTurnEvents,
  dispatched: Promise<void>,
  grace: number,
): Promise<void> {
  await deadline(dispatched, grace);
  if (events.completed || events.turnId === null) return;
  try {
    await deadline(
      workerRequest(transport, 'turn/interrupt', {
        threadId: events.threadId,
        turnId: events.turnId,
      }),
      grace,
    );
    await deadline(events.completion, grace);
  } catch {
    /* An acknowledgement failure leaves termination explicitly uncertain. */
  }
}

function finishedResult(
  spec: AgentSpec,
  events: WorkerTurnEvents,
  contract: OutputContract,
): TaskResult {
  if (events.stopReason !== null || events.completed === null)
    return events.failureResult(spec.model);
  const common = {
    usage: events.usage,
    requestedModel: spec.model,
    reportedModel: events.reportedModel,
  };
  if (events.completed.status !== 'completed')
    return {
      ...common,
      execution: events.completed.status === 'interrupted' ? 'interrupted' : 'failed',
      acceptance: 'unverified',
      value: null,
      evidence: [],
      unresolved: ['Worker turn did not complete successfully'],
      error: 'Worker turn did not complete successfully',
    };
  try {
    return { ...common, execution: 'completed', ...parseWorkerOutput(events.output, contract) };
  } catch (error) {
    const message =
      error instanceof WorkerBlocked ? error.message : 'Worker output validation failed';
    return {
      ...common,
      execution: 'failed',
      acceptance: 'unverified',
      value: null,
      evidence: [],
      unresolved: [message],
      error: message,
    };
  }
}

export async function executeWorkerTurn(
  transport: WorkerTransport,
  spec: AgentSpec,
  options: WorkerOptions,
  input: {
    threadId: string;
    environment: ThreadEnvironment;
    sandbox: SandboxPolicy;
    contract: OutputContract;
    prompt: string;
  },
  grace: number,
): Promise<TaskResult> {
  const events = new WorkerTurnEvents(input.threadId, spec.model, options);
  const unsubscribe = transport.onNotification(
    (message) => events.receive(message),
    (error) => events.stop(workerTransportFailure(error)),
  );
  const abort = () => events.stop('Worker cancellation requested');
  const timer = setTimeout(() => events.stop('Worker timeout exceeded'), spec.timeoutMs ?? 300_000);
  options.signal.addEventListener('abort', abort, { once: true });
  const params: TurnStartParams = {
    threadId: input.threadId,
    model: spec.model,
    effort: spec.effort,
    cwd: spec.assignment.ownership.cwd,
    approvalPolicy: 'never',
    sandboxPolicy: input.sandbox,
    environments: [input.environment],
    runtimeWorkspaceRoots: [spec.assignment.ownership.cwd],
    outputSchema: input.contract.schema,
    input: [{ type: 'text', text: input.prompt, text_elements: [] }],
  };
  const dispatched = workerRequest<TurnStartResponse>(transport, 'turn/start', params)
    .then((response) => events.recordTurnResponse(response.turn))
    .catch(() => events.stop('Worker turn dispatch failed; termination is unconfirmed'));
  try {
    if (options.signal.aborted) abort();
    await events.wakeup;
    if (events.completed === null) await interruptWorker(transport, events, dispatched, grace);
    await events.drain();
    return finishedResult(spec, events, input.contract);
  } finally {
    clearTimeout(timer);
    options.signal.removeEventListener('abort', abort);
    unsubscribe();
    events.dispose();
  }
}
