import type {
  AgentSpec,
  ExecuteWorker,
  TaskResult,
  WorkerOptions,
  JsonValue,
} from '../contracts/workflow.js';
import type { ThreadStartParams } from './generated/v2/ThreadStartParams.js';
import type { ThreadStartResponse } from './generated/v2/ThreadStartResponse.js';
import type { ThreadResumeResponse } from './generated/v2/ThreadResumeResponse.js';
import {
  launchWorkerTransport,
  prepareWorkerTransport,
  type LaunchWorkerTransport,
} from './launch-policy.js';
import { verifyAssignmentRoot, verifyLocalEnvironment } from './local-environment.js';
import { verifyRestrictedWorker } from './permissions.js';
import { outputContract, workerPrompt } from './worker-output.js';
import {
  requireWorker,
  WorkerBlocked,
  workerRequest,
  awaitPreflight,
  closeOnAbort,
  type WorkerTransport,
} from './worker-protocol.js';
import { executeWorkerTurn } from './worker-turn.js';

export type WorkerDependencies = {
  launch?: LaunchWorkerTransport;
  verifyRoot?: typeof verifyAssignmentRoot;
  interruptGraceMs?: number;
};

export function createWorkerExecutor(dependencies: WorkerDependencies = {}): ExecuteWorker {
  return async (spec, options) => {
    const observed = { reportedModel: null as string | null, dispatched: false };
    try {
      return await runWorker(spec, options, dependencies, observed);
    } catch (error) {
      const message =
        !observed.dispatched && options.signal.aborted
          ? 'Worker cancelled during preflight'
          : error instanceof WorkerBlocked
            ? error.message
            : 'Restricted worker initialization or verification failed';
      return {
        execution: observed.dispatched
          ? 'uncertain'
          : options.signal.aborted
            ? 'interrupted'
            : 'failed',
        acceptance: 'blocked',
        value: null,
        evidence: [],
        unresolved: [message],
        usage: null,
        requestedModel: spec.model,
        reportedModel: observed.reportedModel,
        error: message,
      };
    }
  };
}

async function runWorker(
  spec: AgentSpec,
  options: WorkerOptions,
  dependencies: WorkerDependencies,
  observed: { reportedModel: string | null; dispatched: boolean },
): Promise<TaskResult> {
  const contract = outputContract(spec);
  const prompt = workerPrompt(spec);
  requireWorker(!options.signal.aborted, 'Worker cancelled before dispatch');
  requireWorker(
    spec.timeoutMs === undefined ||
      (Number.isSafeInteger(spec.timeoutMs) && spec.timeoutMs > 0 && spec.timeoutMs <= 3_600_000),
    'Worker timeout must be between 1 and 3600000 milliseconds',
  );
  await awaitPreflight(
    (dependencies.verifyRoot ?? verifyAssignmentRoot)(spec, options.signal),
    options.signal,
  );
  const { transport, policy } = await prepareWorkerTransport(
    spec,
    options.instanceId,
    dependencies.launch ?? launchWorkerTransport,
    options.signal,
  );
  const detach = closeOnAbort(transport, options.signal);
  try {
    requireWorker(!options.signal.aborted, 'Worker cancelled before thread creation');
    const { threadId, environment } = await prepareWorkerThread(
      transport,
      policy.config,
      spec,
      options,
      observed,
    );
    requireWorker(!options.signal.aborted, 'Worker cancelled before turn dispatch');
    detach();
    observed.dispatched = true;
    return await executeWorkerTurn(
      transport,
      spec,
      options,
      { threadId, environment, sandbox: policy.sandbox, contract, prompt },
      dependencies.interruptGraceMs ?? 5_000,
    );
  } finally {
    detach();
    transport.close();
  }
}

async function prepareWorkerThread(
  transport: WorkerTransport,
  config: Record<string, JsonValue>,
  spec: AgentSpec,
  options: WorkerOptions,
  observed: { reportedModel: string | null },
) {
  const params: ThreadStartParams = {
    model: spec.model,
    allowProviderModelFallback: false,
    cwd: spec.assignment.ownership.cwd,
    runtimeWorkspaceRoots: [spec.assignment.ownership.cwd],
    approvalPolicy: 'never',
    sandbox: spec.capability,
    ephemeral: spec.format === undefined,
    dynamicTools: [],
    selectedCapabilityRoots: [],
    config,
  };
  const thread = await awaitPreflight(
    spec.resumeThreadId
      ? workerRequest<ThreadResumeResponse>(transport, 'thread/resume', {
          threadId: spec.resumeThreadId,
          model: spec.model,
          cwd: spec.assignment.ownership.cwd,
          runtimeWorkspaceRoots: [spec.assignment.ownership.cwd],
          approvalPolicy: 'never',
          sandbox: params.sandbox,
          config,
        })
      : workerRequest<ThreadStartResponse>(transport, 'thread/start', params),
    options.signal,
  );
  if (spec.resumeThreadId) {
    requireWorker(thread.thread.id === spec.resumeThreadId, 'Resumed worker identity differs');
    requireWorker(thread.thread.status.type === 'idle', 'Worker has a conflicting active turn');
  }
  observed.reportedModel = typeof thread.model === 'string' ? thread.model : null;
  const evidence = await awaitPreflight(
    verifyRestrictedWorker(
      transport,
      thread,
      { cwd: spec.assignment.ownership.cwd, model: spec.model, effort: spec.effort },
      spec.capability,
    ),
    options.signal,
  );
  const environment = await awaitPreflight(
    verifyLocalEnvironment(
      transport,
      thread,
      spec.assignment.ownership.cwd,
      spec.format === undefined,
    ),
    options.signal,
  );
  await awaitPreflight(
    Promise.resolve(
      options.onEvent({
        type: 'thread',
        threadId: thread.thread.id,
        instructionSources: evidence.instructionSources,
        reportedModel: thread.model,
        reportedEffort: evidence.effort,
      }),
    ),
    options.signal,
  );
  return { threadId: thread.thread.id, environment };
}

export const executeWorker: ExecuteWorker = createWorkerExecutor();

export { readWorkerCapabilities } from './worker-capabilities.js';
export type { WorkerCapabilities } from './worker-capabilities.js';
