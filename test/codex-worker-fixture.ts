import { vi } from 'vitest';
import type {
  AgentSpec,
  JsonValue,
  WorkerEvent,
  WorkerOptions,
} from '../src/contracts/workflow.js';
import type { ServerNotification } from '../src/codex/generated/ServerNotification.js';
import type { Turn } from '../src/codex/generated/v2/Turn.js';
import type { ThreadItem } from '../src/codex/generated/v2/ThreadItem.js';
import type { WorkerTransport } from '../src/codex/worker-protocol.js';
import { PROHIBITED_WORKER_FEATURES } from '../src/codex/permissions.js';
import { createWorkerExecutor } from '../src/codex/worker.js';

export function workerSpec(overrides: Partial<AgentSpec> = {}): AgentSpec {
  return {
    phase: { id: 'inspect', label: 'Inspect' },
    title: 'Read fixture',
    assignment: {
      outcome: 'Read input.txt',
      inputs: { file: 'input.txt' },
      ownership: { cwd: '/private/tmp', paths: ['/private/tmp/input.txt'] },
      constraints: ['Read only'],
      acceptance: ['Answer identified'],
      stopConditions: ['Stop on ambiguity'],
    },
    assessment: {
      difficulty: 'low',
      uncertainty: 'low',
      consequence: 'low',
      verificationBurden: 'file read',
      modelRationale: 'bounded read',
      delegationBenefit: 'independent',
      coordinationOverhead: 'small',
    },
    model: 'gpt-6.1-sol',
    effort: 'low',
    capability: 'read-only',
    resources: [],
    outputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { answer: { type: 'string' } },
      required: ['answer'],
    },
    ...overrides,
  };
}

export function outputText(overrides: Record<string, JsonValue> = {}): string {
  return JSON.stringify({
    acceptance: 'satisfied',
    value: { answer: 'COBALT-47' },
    evidence: [{ id: 'input', description: 'Read fixture', uri: null, revision: null }],
    unresolved: [],
    ...overrides,
  });
}

export function turn(status: Turn['status'] = 'inProgress', items: ThreadItem[] = []): Turn {
  return {
    id: 'owned-turn',
    rootTurnId: null,
    status,
    items,
    itemsView: 'full',
    error: null,
    startedAt: null,
    completedAt: null,
    durationMs: null,
  };
}

export function finalItem(text = outputText()): ThreadItem {
  return {
    type: 'agentMessage',
    id: 'final',
    text,
    phase: 'final_answer',
    memoryCitation: null,
    delivery: null,
    questions: null,
  };
}

type Handler = Parameters<WorkerTransport['onNotification']>[0];
type Reply = unknown | ((params: unknown) => unknown);
export class WorkerBackend implements WorkerTransport {
  initializeMetadata = {
    codexHome: '/private/tmp',
    userAgent: 'test',
    platformFamily: 'unix',
    platformOs: 'macos',
  };
  calls: { method: string; params: unknown }[] = [];
  overrides: Record<string, Reply> = {};
  close = vi.fn();
  receive: Handler | undefined;
  fail: Parameters<WorkerTransport['onNotification']>[1];
  execute: () => Promise<void> = () => this.finish();
  onNotification(receive: Handler, fail: Parameters<WorkerTransport['onNotification']>[1]) {
    this.receive = receive;
    this.fail = fail;
    return () => {
      this.receive = undefined;
    };
  }
  async emit(method: string, params: Record<string, unknown>) {
    await this.receive?.({
      method,
      params: { threadId: 'worker-thread', ...params },
    } as ServerNotification);
  }
  async finish(text = outputText(), status: Turn['status'] = 'completed') {
    await this.emit('item/completed', { turnId: 'owned-turn', item: finalItem(text) });
    await this.emit('turn/completed', { turn: turn(status) });
  }
  async request<T>(method: string, params?: unknown): Promise<T> {
    this.calls.push({ method, params });
    if (method in this.overrides) {
      const reply = this.overrides[method];
      return (typeof reply === 'function' ? await reply(params) : reply) as T;
    }
    if (method === 'turn/start') {
      setImmediate(() => {
        void this.execute();
      });
      return { turn: turn() } as T;
    }
    return this.response(method) as T;
  }
  response(method: string): unknown {
    const replies: Record<string, unknown> = {
      'config/read': {
        config: {
          approval_policy: 'never',
          sandbox_mode: 'read-only',
          web_search: 'disabled',
          mcp_servers: { inherited: { enabled: false } },
          apps: { app1: { enabled: false } },
        },
      },
      'account/read': { account: { type: 'chatgpt' } },
      'configRequirements/read': { requirements: null },
      'account/rateLimits/read': { ordinaryUsageAllowed: true },
      'model/list': {
        data: [{ model: 'gpt-6.1-sol', supportedReasoningEfforts: [{ reasoningEffort: 'low' }] }],
        nextCursor: null,
      },
      'experimentalFeature/list': {
        data: [
          ...PROHIBITED_WORKER_FEATURES.map((name) => ({ name, enabled: false })),
          { name: 'shell_tool', enabled: true },
          { name: 'unified_exec', enabled: true },
        ],
        nextCursor: null,
      },
      'mcpServerStatus/list': {
        data: [{ runtimeStatus: 'disabled', tools: {}, toolsError: null }],
        nextCursor: null,
      },
      'app/installed': { apps: [{ enabled: false, callable: false }] },
      'hooks/list': { data: [{ cwd: '/private/tmp', hooks: [], errors: [] }] },
      'environment/info': { shell: { name: 'zsh', path: '/bin/zsh' }, cwd: 'file:///private/tmp' },
      'environment/status': { status: 'ready' },
      'thread/start': workerThread(),
    };
    return replies[method];
  }
}

export function workerThread(overrides: Record<string, unknown> = {}) {
  return {
    thread: {
      id: 'worker-thread',
      ephemeral: true,
      environments: [
        { environmentId: 'local', cwd: '/private/tmp', runtimeWorkspaceRoots: ['/private/tmp'] },
      ],
    },
    model: 'gpt-6.1-sol',
    reasoningEffort: 'low',
    cwd: '/private/tmp',
    approvalPolicy: 'never',
    sandbox: { type: 'readOnly', networkAccess: false },
    activePermissionProfile: null,
    instructionSources: ['/private/tmp/AGENTS.md'],
    runtimeWorkspaceRoots: [],
    ...overrides,
  };
}

export function workerHarness() {
  const discovery = new WorkerBackend();
  const backend = new WorkerBackend();
  const launch = vi.fn().mockResolvedValueOnce(discovery).mockResolvedValue(backend);
  const events: WorkerEvent[] = [];
  const controller = new AbortController();
  const options: WorkerOptions = {
    instanceId: '/private/tmp',
    signal: controller.signal,
    onEvent: (event) => {
      events.push(event);
    },
  };
  const execute = createWorkerExecutor({
    launch,
    verifyRoot: async () => undefined,
    interruptGraceMs: 10,
  });
  return { discovery, backend, launch, events, controller, options, execute };
}
