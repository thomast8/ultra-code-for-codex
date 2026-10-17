import { pendingWorkNotice } from './pending-work.js';
import { registerContext, resolveContext } from './registry.js';
import type { HookInput, HookOutput } from './types.js';

function pluginDataDirectory(environment: NodeJS.ProcessEnv): string {
  const values = [environment.CODEX_PLUGIN_DATA, environment.PLUGIN_DATA].filter(
    (value): value is string => Boolean(value),
  );
  if (values.length === 0 || values.some((value) => value !== values[0]))
    throw new Error('Plugin data directory is unavailable or ambiguous');
  return values[0] as string;
}

export function parseHookInput(value: unknown): HookInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('Invalid hook input');
  const input = value as Record<string, unknown>;
  if (input.hook_event_name !== 'UserPromptSubmit') throw new Error('Unexpected hook event');
  if (
    typeof input.session_id !== 'string' ||
    typeof input.turn_id !== 'string' ||
    typeof input.cwd !== 'string'
  ) {
    throw new Error('Incomplete hook input');
  }
  return {
    session_id: input.session_id,
    turn_id: input.turn_id,
    cwd: input.cwd,
    ...(typeof input.model === 'string' ? { model: input.model } : {}),
    ...(typeof input.transcript_path === 'string'
      ? { transcript_path: input.transcript_path }
      : {}),
  };
}

export async function runUserPromptHook(
  value: unknown,
  environment: NodeJS.ProcessEnv,
): Promise<HookOutput> {
  const input = parseHookInput(value);
  const dataDir = pluginDataDirectory(environment);
  const { contextKey } = await registerContext(input, dataDir);
  const context = await resolveContext(contextKey, dataDir);
  const active = context.resolutionStatus === 'verified' && context.effort === 'ultra';
  const policy = !active
    ? 'Ultra policy inactive: effort unverified as ultra. Explicit Ultra: use ultra_start, never native subagents; verify capabilities and authority.'
    : context.collaborationMode === 'plan'
      ? 'Ultra planning policy active: read-only via ultra_start, never native subagents; lead plans. Plan Mode is read-only. Read the ultra-code skill.'
      : 'Ultra policy active: delegate via ultra_start, never native subagents; lead owns intent and delivery. Plan Mode is read-only. Read the ultra-code skill.';
  const pending = pendingWorkNotice(dataDir, context);
  return {
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: `${contextKey}: ultra_context with this exact handle. Keep lead model/effort. ${policy}${pending ? ` ${pending}` : ''}`,
    },
  };
}
