export interface LeadContext {
  instanceId: string;
  sessionId: string;
  turnId: string;
  cwd: string;
  filesystem?: { readAll: true; writableRoots: string[] } | undefined;
  model: string;
  effort: string;
  collaborationMode: string;
  resolutionStatus: 'verified' | 'unknown';
  resolutionReason: string;
}

export interface HookInput {
  session_id: string;
  turn_id: string;
  cwd: string;
  model?: string;
  transcript_path?: string;
}

export interface ResolveOptions {
  timeoutMs?: number;
}

export interface HookOutput {
  hookSpecificOutput: {
    hookEventName: 'UserPromptSubmit';
    additionalContext: string;
  };
}

export interface StoredContext {
  schema: 'ultra-context-v1';
  resolutionStatus: 'verified' | 'unknown';
  resolutionReason: string;
  context: LeadContext;
}
