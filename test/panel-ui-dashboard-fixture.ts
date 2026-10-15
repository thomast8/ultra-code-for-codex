import type { RunSnapshot, TaskSnapshot, TokenUsage } from '../src/contracts/workflow.js';

export const usage: TokenUsage = {
  inputTokens: 100,
  cachedInputTokens: 40,
  outputTokens: 20,
  reasoningOutputTokens: 5,
  totalTokens: 120,
};
export function taskFixture(overrides: Partial<TaskSnapshot> = {}): TaskSnapshot {
  return {
    id: 'task-1',
    title: 'Compare document names',
    phase: { id: 'inventory', label: 'Folder inventory' },
    state: 'running',
    waitingReason: null,
    requestedModel: 'gpt-6-luna',
    reportedModel: 'gpt-6-luna',
    effort: 'medium',
    assessment: {
      difficulty: 'A bounded file list',
      uncertainty: 'Naming conventions differ',
      consequence: 'Read-only comparison',
      verificationBurden: 'Check the original list',
      modelRationale: 'Luna can compare this bounded file list.',
      delegationBenefit: 'Independent comparison',
      coordinationOverhead: 'One result to review',
    },
    createdAt: 0,
    startedAt: 1000,
    finishedAt: null,
    lastActivityAt: 2000,
    lastActivity: 'Reading file names',
    usage,
    result: null,
    ...overrides,
  };
}

export function runFixture(overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  return {
    id: 'run-1',
    title: 'Audit documents',
    objective: 'Find missing source documents.',
    state: 'running',
    parentRunId: null,
    createdAt: 0,
    updatedAt: 2000,
    finishedAt: null,
    acceptance: ['Every missing document has a source reference.'],
    acceptanceOutcome: 'unverified',
    phases: [{ id: 'inventory', label: 'Folder inventory' }],
    tasks: [taskFixture()],
    handoffs: [],
    usage,
    accountingComplete: false,
    result: null,
    error: null,
    ...overrides,
  };
}

function completedTask(): TaskSnapshot {
  return taskFixture({
    id: 'task-completed',
    title: 'Verify the register',
    state: 'completed',
    finishedAt: 61_000,
    phase: { id: 'verify', label: 'Source verification' },
    usage: null,
    result: {
      execution: 'completed',
      acceptance: 'incomplete',
      value: { missing: ['Lease'] },
      evidence: [
        {
          id: 'source',
          description: 'Original register',
          uri: 'https://example.test/register',
          revision: 'r7',
        },
        { id: 'local', description: 'Local extract', uri: '/workspace/register.txt' },
        { id: 'unsafe', description: 'Unusable source link', uri: 'javascript:alert(1)' },
        { id: 'plain', description: 'Reviewed record' },
      ],
      unresolved: ['Confirm whether the lease was uploaded.'],
      usage,
      requestedModel: 'gpt-6-luna',
      reportedModel: 'gpt-6-luna',
      error: 'One acceptance item remains open.',
    },
  });
}

export function threeRuns(): RunSnapshot[] {
  const first = runFixture({
    tasks: [
      taskFixture(),
      completedTask(),
      taskFixture({
        id: 'task-waiting',
        title: 'Read the signed copy',
        state: 'waiting',
        waitingReason: 'Read slot occupied',
        startedAt: null,
        usage: null,
        reportedModel: null,
        lastActivity: null,
      }),
      taskFixture({
        id: 'task-queued',
        title: 'Compare appendices',
        state: 'queued',
        startedAt: null,
        usage: null,
      }),
    ],
    handoffs: [
      {
        id: 'handoff-1',
        state: 'pending',
        claimedTurnId: null,
        result: null,
        spec: {
          phase: { id: 'decision', label: 'Decide the next step' },
          objective: 'Decide whether the missing lease blocks delivery.',
          resources: [],
          evidence: [{ id: 'note', description: 'Missing document note' }],
        },
      },
    ],
  });
  const second = runFixture({
    id: 'run-2',
    title: 'Review follow-up',
    state: 'paused',
    parentRunId: 'run-1',
    usage: null,
    phases: [],
    tasks: [
      taskFixture({
        id: 'failed-task',
        title: 'Read follow-up attachment',
        state: 'failed',
        reportedModel: 'gpt-6-sol',
        effort: 'high',
        finishedAt: 5000,
      }),
    ],
    error: 'The attachment could not be opened.',
  });
  const third = runFixture({
    id: 'run-3',
    title: 'Check references',
    state: 'completed',
    parentRunId: 'earlier-run',
    acceptanceOutcome: 'blocked',
    finishedAt: 5000,
    accountingComplete: true,
    result: 'References checked; approval remains outstanding.',
    phases: [],
    tasks: [],
    handoffs: [],
  });
  return [first, second, third];
}

type ToolRequest = { name: string; arguments: Record<string, unknown> };
class MockApp {
  private handlers = new Map<string, (payload: unknown) => void>();
  constructor() {
    dashboardBridge.instance = this;
  }
  addEventListener(name: string, callback: (payload: unknown) => void) {
    this.handlers.set(name, callback);
  }
  emit(payload: unknown) {
    this.handlers.get('toolresult')?.(payload);
  }
  async connect() {
    return undefined;
  }
  getHostContext() {
    return dashboardBridge.hostContext;
  }
  async sendMessage() {
    dashboardBridge.messages += 1;
    return { isError: false };
  }
  async callServerTool(request: ToolRequest): Promise<unknown> {
    dashboardBridge.calls.push(request);
    if (request.name === 'ultra_panel_control') return dashboardBridge.controlResult;
    if (request.name === 'ultra_panel_status') return { structuredContent: { state: 'bound' } };
    return dashboardBridge.statusResults.shift() ?? dashboardBridge.statusResult;
  }
  async close() {
    dashboardBridge.closed += 1;
  }
}
export const dashboardBridge = {
  instance: null as MockApp | null,
  calls: [] as ToolRequest[],
  messages: 0,
  closed: 0,
  statusResult: { structuredContent: { runs: [], cursor: 0 } } as unknown,
  statusResults: [] as unknown[],
  controlResult: { isError: false } as unknown,
  hostContext: undefined as Record<string, unknown> | undefined,
  MockApp,
};

export function resetBridge() {
  dashboardBridge.instance = null;
  dashboardBridge.calls = [];
  dashboardBridge.messages = 0;
  dashboardBridge.closed = 0;
  dashboardBridge.statusResult = { structuredContent: { runs: [], cursor: 0 } };
  dashboardBridge.statusResults = [];
  dashboardBridge.controlResult = { isError: false };
  dashboardBridge.hostContext = undefined;
}

export function deferredResult() {
  let resolve: (value: unknown) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<unknown>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
