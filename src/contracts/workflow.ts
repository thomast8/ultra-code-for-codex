import type { LeadContext } from '../activation/types.js';
import type { ReasoningEffort } from '../codex/generated/ReasoningEffort.js';

export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type PhaseRef = { id: string; label: string };
export type ArtifactRef = { id: string; description: string; uri?: string; revision?: string };
export type ResourceClaim = {
  key: string;
  mode: 'read' | 'write';
  path?: string;
  identity?: { dev: number; ino: number };
};
export type Assessment = {
  difficulty: string;
  uncertainty: string;
  consequence: string;
  verificationBurden: string;
  modelRationale: string;
  delegationBenefit: string;
  coordinationOverhead: string;
};
export type AgentSpec = {
  phase: PhaseRef;
  title: string;
  assignment: {
    outcome: string;
    inputs: JsonValue;
    ownership: { cwd: string; paths: string[] };
    constraints: string[];
    acceptance: string[];
    stopConditions: string[];
  };
  assessment: Assessment;
  model: string;
  effort: ReasoningEffort;
  capability: 'read-only' | 'workspace-write';
  resources: ResourceClaim[];
  outputSchema: { [key: string]: JsonValue };
  timeoutMs?: number;
};
export type AgentRequest = Omit<AgentSpec, 'model' | 'effort'> & {
  model?: string;
  effort?: ReasoningEffort;
};
export type TokenUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens?: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
};
export type TaskResult = {
  execution: 'completed' | 'failed' | 'interrupted' | 'uncertain';
  acceptance: 'satisfied' | 'incomplete' | 'blocked' | 'unverified';
  value: JsonValue;
  evidence: ArtifactRef[];
  unresolved: string[];
  usage: TokenUsage | null;
  requestedModel: string;
  reportedModel: string | null;
  error?: string;
};
export type LeadHandoffSpec = {
  kind?: 'action' | 'planning';
  phase: PhaseRef;
  objective: string;
  resources: ResourceClaim[];
  evidence: ArtifactRef[];
  revision?: string;
};
export type LeadResult = {
  acceptance: 'satisfied' | 'incomplete' | 'blocked';
  value: JsonValue;
  evidence: ArtifactRef[];
  revision?: string;
};
export type StartRequest = {
  requestId: string;
  contextKey: string;
  title: string;
  objective: string;
  acceptance: string[];
  script: string;
  args: JsonValue;
  maxAgentCalls: number;
  authorityRef: string;
  parentRunId?: string;
  evidenceRefs?: ArtifactRef[];
  budget?: { maxObservedTokens: number };
};
export type CapacityGrant = {
  source: 'lead-session';
  totalSlots: number;
  reservedSlots: number;
  evidence: string;
};
export type WorkerEvent =
  | { type: 'thread'; threadId: string; instructionSources: string[]; reportedModel: string }
  | { type: 'turn'; threadId: string; turnId: string }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'activity'; message: string };
export type WorkerOptions = {
  instanceId: string;
  signal: AbortSignal;
  onEvent: (event: WorkerEvent) => void | Promise<void>;
};
export type ExecuteWorker = (spec: AgentSpec, options: WorkerOptions) => Promise<TaskResult>;
export type RunAuthority = { context: LeadContext; capacity: CapacityGrant };

export type TaskState =
  'queued' | 'waiting' | 'running' | 'completed' | 'failed' | 'cancelled' | 'needs_reconciliation';
export type TaskSnapshot = {
  id: string;
  title: string;
  phase: PhaseRef;
  state: TaskState;
  waitingReason: string | null;
  requestedModel: string;
  reportedModel: string | null;
  effort: string;
  assessment: Assessment;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  lastActivityAt: number;
  lastActivity: string | null;
  usage: TokenUsage | null;
  result: TaskResult | null;
};
export type HandoffSnapshot = {
  id: string;
  state: 'pending' | 'claimed' | 'resolved' | 'needs_reconciliation';
  spec: LeadHandoffSpec;
  claimedTurnId: string | null;
  result: LeadResult | null;
};
export type RunSnapshot = {
  id: string;
  title: string;
  objective: string;
  budget?: { maxObservedTokens: number };
  state:
    'queued' | 'running' | 'paused' | 'cancelled' | 'completed' | 'failed' | 'needs_reconciliation';
  parentRunId: string | null;
  createdAt: number;
  updatedAt: number;
  finishedAt: number | null;
  acceptance: string[];
  acceptanceOutcome: 'satisfied' | 'incomplete' | 'blocked' | 'unverified';
  phases: PhaseRef[];
  tasks: TaskSnapshot[];
  handoffs: HandoffSnapshot[];
  leadReviews?: { handoffId: string; startedAt: number; finishedAt: number | null }[];
  usage: TokenUsage | null;
  accountingComplete: boolean; // Reported worker attempts only; main-chat overhead is excluded.
  result: JsonValue;
  error: string | null;
};
export type WorkflowEvent = {
  cursor: number;
  runId: string;
  type: string;
  timestamp: number;
  data: JsonValue;
};
export type EventBatch = { cursor: number; events: WorkflowEvent[] };
