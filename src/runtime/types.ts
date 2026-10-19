import type {
  AgentSpec,
  HandoffSnapshot,
  JsonValue,
  ResourceClaim,
  RunAuthority,
  RunSnapshot,
  StartRequest,
  TaskSnapshot,
} from '../contracts/workflow.js';

export type Owner = { instanceId: string; sessionId: string };
export type CallKind = 'phase' | 'log' | 'agent' | 'lead';
export type CallRecord = {
  id: string;
  kind: CallKind;
  payload: JsonValue;
  state: 'queued' | 'dispatched' | 'resolved' | 'uncertain';
  settlement: number | null;
  result: JsonValue;
  claims: ResourceClaim[];
  task: TaskSnapshot | null;
  handoff: HandoffSnapshot | null;
  threadId: string | null;
  turnId: string | null;
  instructionSources: string[];
};
export type RunRecord = {
  version: 1 | 2;
  continuation?: {
    threadId: string;
    cwd: string;
    capability: AgentSpec['capability'];
    kind: 'follow-up' | 'repair';
  };
  sourceEvidence?: string[];
  cancelRequested: boolean;
  owner: Owner;
  request: StartRequest;
  requestBytes: string;
  authority: RunAuthority;
  snapshot: RunSnapshot;
  calls: CallRecord[];
  nextSettlement: number;
};
export type ScheduledWork = {
  id: string;
  runId: string;
  claims: ResourceClaim[];
  ready: () => boolean;
  waiting: () => void;
  run: () => Promise<boolean>;
  invalid: (error: Error) => void;
};
export type AgentCall = CallRecord & { task: TaskSnapshot; payload: AgentSpec & JsonValue };
