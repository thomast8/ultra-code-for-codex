import type { AgentSpec, ExecuteWorker, TaskResult, WorkerOptions } from '../contracts/workflow.js';
import type { ThreadStartParams } from './generated/v2/ThreadStartParams.js';
import type { ThreadStartResponse } from './generated/v2/ThreadStartResponse.js';
import {
  launchWorkerTransport,
  prepareWorkerTransport,
  type LaunchWorkerTransport,
} from './launch-policy.js';
import { verifyAssignmentRoot, verifyLocalEnvironment } from './local-environment.js';
import { verifyRestrictedWorker } from './permissions.js';
import { outputContract, workerPrompt } from './worker-output.js';
import { requireWorker, WorkerBlocked, workerRequest } from './worker-protocol.js';
import { executeWorkerTurn } from './worker-turn.js';

export type WorkerDependencies = {
  launch?: LaunchWorkerTransport;
  verifyRoot?: typeof verifyAssignmentRoot;
  interruptGraceMs?: number;
};

export function createWorkerExecutor(dependencies: WorkerDependencies = {}): ExecuteWorker {
  return async (spec, options) => {
    const observed = { reportedModel: null as string | null };
    try {
      return await runWorker(spec, options, dependencies, observed);
    } catch (error) {
      const message =
        error instanceof WorkerBlocked
          ? error.message
          : 'Restricted worker initialization or verification failed';
      return {
        execution: 'failed',
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
  observed: { reportedModel: string | null },
): Promise<TaskResult> {
  const contract = outputContract(spec);
  const prompt = workerPrompt(spec);
  requireWorker(!options.signal.aborted, 'Worker cancelled before dispatch');
  requireWorker(
    spec.timeoutMs === undefined ||
      (Number.isSafeInteger(spec.timeoutMs) && spec.timeoutMs > 0 && spec.timeoutMs <= 3_600_000),
    'Worker timeout must be between 1 and 3600000 milliseconds',
  );
  await (dependencies.verifyRoot ?? verifyAssignmentRoot)(spec);
  const { transport, policy } = await prepareWorkerTransport(
    spec,
    options.instanceId,
    dependencies.launch ?? launchWorkerTransport,
    options.signal,
  );
  try {
    requireWorker(!options.signal.aborted, 'Worker cancelled before thread creation');
    const params: ThreadStartParams = {
      model: spec.model,
      allowProviderModelFallback: false,
      cwd: spec.assignment.ownership.cwd,
      runtimeWorkspaceRoots: [spec.assignment.ownership.cwd],
      approvalPolicy: 'never',
      sandbox: spec.capability,
      ephemeral: true,
      dynamicTools: [],
      selectedCapabilityRoots: [],
      config: policy.config,
    };
    const thread = await workerRequest<ThreadStartResponse>(transport, 'thread/start', params);
    observed.reportedModel = typeof thread.model === 'string' ? thread.model : null;
    const evidence = await verifyRestrictedWorker(
      transport,
      thread,
      { cwd: spec.assignment.ownership.cwd, model: spec.model, effort: spec.effort },
      spec.capability,
    );
    const environment = await verifyLocalEnvironment(
      transport,
      thread,
      spec.assignment.ownership.cwd,
    );
    await options.onEvent({
      type: 'thread',
      threadId: thread.thread.id,
      instructionSources: evidence.instructionSources,
      reportedModel: thread.model,
    });
    requireWorker(!options.signal.aborted, 'Worker cancelled before turn dispatch');
    return await executeWorkerTurn(
      transport,
      spec,
      options,
      { threadId: thread.thread.id, environment, sandbox: policy.sandbox, contract, prompt },
      dependencies.interruptGraceMs ?? 5_000,
    );
  } finally {
    transport.close();
  }
}

export const executeWorker: ExecuteWorker = createWorkerExecutor();

export { readWorkerCapabilities } from './worker-capabilities.js';
export type { WorkerCapabilities } from './worker-capabilities.js';
