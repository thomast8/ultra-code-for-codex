import { open, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import type { HookInput, LeadContext } from './types.js';
import { filesystemAuthority } from './permissions.js';

export const PARSER_ADAPTER_VERSION = 'codex-turn-context-v1';
/** Desktop CLI versions with recorded native QA. Other well-formed versions verify by field checks. */
export const SUPPORTED_CLI_VERSIONS = [
  '0.160.0',
  '0.160.1',
  '0.162.0-alpha.17.2',
  '0.163.0-alpha.10.2',
  '0.163.0-alpha.11',
] as const;

type JsonObject = Record<string, unknown>;
const MAX_METADATA_LINE = 64 * 1024;
const READ_CHUNK = 64 * 1024;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function versionLabel(value: unknown): string {
  const version = text(value);
  if (!version) return '(missing)';
  return version.length <= 64 && /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)
    ? version
    : '(invalid)';
}

function validId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function exactPath(path: string, base: string): boolean {
  const part = relative(base, path);
  return part !== '' && !part.startsWith('..') && !isAbsolute(part);
}

function sessionMetadata(payload: JsonObject): JsonObject {
  return {
    id: text(payload.id),
    session_id: text(payload.session_id),
    cli_version: text(payload.cli_version),
  };
}

function turnMetadata(payload: JsonObject): JsonObject {
  const mode = isObject(payload.collaboration_mode)
    ? text(payload.collaboration_mode.mode)
    : text(payload.collaboration_mode);
  return {
    turn_id: text(payload.turn_id),
    cwd: text(payload.cwd),
    model: text(payload.model),
    effort: text(payload.effort),
    collaboration_mode: mode,
    filesystem: filesystemAuthority(payload.file_system_sandbox_policy),
  };
}

function sameMetadata(left: JsonObject, right: JsonObject): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function mergeMetadata(
  current: JsonObject | undefined,
  next: JsonObject,
  conflict: string,
): JsonObject {
  if (current && !sameMetadata(current, next)) throw new Error(conflict);
  return next;
}

function mergeSession(
  current: JsonObject | undefined,
  payload: JsonObject,
  input: HookInput,
): JsonObject | undefined {
  const projected = sessionMetadata(payload);
  const id = text(projected.id);
  const sessionId = text(projected.session_id);
  if (id && sessionId && id !== sessionId) throw new Error('Conflicting session metadata');
  if ((id ?? sessionId) !== input.session_id) return current;
  return mergeMetadata(current, projected, 'Conflicting session metadata');
}

function mergeTurn(
  current: JsonObject | undefined,
  payload: JsonObject,
  input: HookInput,
): JsonObject | undefined {
  if (payload.turn_id !== input.turn_id) return current;
  return mergeMetadata(current, turnMetadata(payload), 'Conflicting turn metadata');
}

function recordType(line: string): string | undefined {
  return /^\s*\{"timestamp":"[^"]+","ordinal":\d+,"type":"([^"]+)"/.exec(line)?.[1];
}

interface MetadataState {
  meta: JsonObject | undefined;
  turn: JsonObject | undefined;
}

function mergeMetadataLine(
  type: string,
  payload: JsonObject,
  state: MetadataState,
  input: HookInput,
): void {
  if (type === 'session_meta') state.meta = mergeSession(state.meta, payload, input) ?? state.meta;
  if (type === 'turn_context') state.turn = mergeTurn(state.turn, payload, input) ?? state.turn;
}

function mergeLine(line: string, state: MetadataState, input: HookInput): void {
  if (!line.trim()) return;
  const type = recordType(line);
  if (type !== 'session_meta' && type !== 'turn_context') return;
  if (line.length > MAX_METADATA_LINE) throw new Error('Oversized activation metadata record');
  const record: unknown = JSON.parse(line);
  if (!isObject(record) || !isObject(record.payload))
    throw new Error('Invalid activation metadata record');
  mergeMetadataLine(type, record.payload, state, input);
}

function sessionPath(input: HookInput): string {
  if (!input.transcript_path || !isAbsolute(input.transcript_path)) {
    throw new Error('Missing absolute transcript_path');
  }
  const path = resolve(input.transcript_path);
  const sessionsIndex = path.split('/').lastIndexOf('sessions');
  if (sessionsIndex < 0 || !path.endsWith('.jsonl')) {
    throw new Error('Transcript path is not a Codex session log');
  }
  return path;
}

function matchingPayloads(
  lines: string[],
  input: HookInput,
): { meta: JsonObject; turn: JsonObject } {
  const state: MetadataState = { meta: undefined, turn: undefined };
  for (const line of lines) {
    const type = recordType(line);
    try {
      mergeLine(line, state, input);
    } catch (error) {
      if (error instanceof SyntaxError && (type === 'session_meta' || type === 'turn_context')) {
        throw new Error('Invalid activation metadata record', { cause: error });
      }
      if (!(error instanceof SyntaxError)) throw error;
    }
  }
  if (!state.meta || !state.turn)
    throw new Error('Exact session or turn metadata is not available yet');
  return { meta: state.meta, turn: state.turn };
}

function requiredText(value: unknown, field: string): string {
  const found = text(value);
  if (!found) throw new Error(`Incomplete exact-turn metadata: ${field}`);
  return found;
}

function requireVersion(meta: JsonObject): void {
  const version = versionLabel(meta.cli_version);
  if (version === '(missing)' || version === '(invalid)') {
    throw new Error(`Unsupported Codex log version ${version} for ${PARSER_ADAPTER_VERSION}`);
  }
}

function makeContext(meta: JsonObject, turn: JsonObject, input: HookInput): LeadContext {
  requireVersion(meta);
  const sessionId = requiredText(meta.session_id ?? meta.id, 'session_id');
  const turnId = requiredText(turn.turn_id, 'turn_id');
  const cwd = requiredText(turn.cwd, 'cwd');
  const model = requiredText(turn.model, 'model');
  const effort = requiredText(turn.effort, 'effort');
  const collaborationMode = requiredText(turn.collaboration_mode, 'collaboration_mode');
  if (!validId(sessionId) || !validId(turnId)) throw new Error('Invalid exact-turn identifiers');
  if (!['default', 'plan', 'unknown'].includes(collaborationMode)) {
    throw new Error('Unsupported collaboration mode');
  }
  if (
    sessionId !== input.session_id ||
    turnId !== input.turn_id ||
    resolve(cwd) !== resolve(input.cwd)
  ) {
    throw new Error('Hook input does not match exact-turn metadata');
  }
  const transcript = sessionPath(input);
  const sessionsRoot = transcript.slice(
    0,
    transcript.lastIndexOf('/sessions/') + '/sessions'.length,
  );
  return {
    instanceId: resolve(sessionsRoot, '..'),
    sessionId,
    turnId,
    cwd,
    ...(turn.filesystem
      ? { filesystem: turn.filesystem as NonNullable<LeadContext['filesystem']> }
      : {}),
    model,
    effort,
    collaborationMode,
    resolutionStatus: 'verified',
    resolutionReason: 'Exact session and turn metadata verified.',
  };
}

interface LineState {
  meta: JsonObject | undefined;
  turn: JsonObject | undefined;
  pending: string;
  discarding: boolean;
}

function processLine(line: string, state: LineState, input: HookInput): void {
  const normalized = line.endsWith('\r') ? line.slice(0, -1) : line;
  if (normalized.length > MAX_METADATA_LINE) {
    const type = recordType(normalized.slice(0, 4096));
    if (type === 'session_meta' || type === 'turn_context') {
      throw new Error('Oversized activation metadata record');
    }
    return;
  }
  mergeLine(normalized, state, input);
}

function consumeText(chunk: string, state: LineState, input: HookInput): void {
  let remaining = chunk;
  if (state.discarding) {
    const end = remaining.indexOf('\n');
    if (end < 0) return;
    remaining = remaining.slice(end + 1);
    state.discarding = false;
  }
  const lines = `${state.pending}${remaining}`.split('\n');
  state.pending = lines.pop() ?? '';
  for (const line of lines) processLine(line, state, input);
  if (state.pending.length > MAX_METADATA_LINE) {
    processLine(state.pending, state, input);
    state.pending = '';
    state.discarding = true;
  }
}

function hasExactMetadata(
  state: LineState,
): state is LineState & { meta: JsonObject; turn: JsonObject } {
  return Boolean(state.meta && state.turn);
}

async function readAvailable(
  handle: Awaited<ReturnType<typeof open>>,
  decoder: StringDecoder,
  offset: number,
  state: LineState,
  input: HookInput,
  deadline: number,
): Promise<number> {
  const size = (await handle.stat()).size;
  while (offset < size) {
    if (Date.now() > deadline) throw new Error('Activation transcript scan exceeded its deadline');
    const buffer = Buffer.alloc(Math.min(READ_CHUNK, size - offset));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
    if (bytesRead === 0) break;
    offset += bytesRead;
    consumeText(decoder.write(buffer.subarray(0, bytesRead)), state, input);
  }
  return offset;
}

function unknownContext(input: HookInput, instanceId: string, reason: string): LeadContext {
  return {
    instanceId,
    sessionId: input.session_id,
    turnId: input.turn_id,
    cwd: input.cwd,
    model: 'unknown',
    effort: 'unknown',
    collaborationMode: 'unknown',
    resolutionStatus: 'unknown',
    resolutionReason: reason,
  };
}

async function scanForContext(
  handle: Awaited<ReturnType<typeof open>>,
  input: HookInput,
  instanceId: string,
  maxWaitMs: number,
): Promise<LeadContext> {
  const waitMs = Math.min(Math.max(maxWaitMs, 0), 5_000);
  // Zero wait skips polling, while an existing-file scan still has a five-second bound.
  const deadline = Date.now() + (waitMs === 0 ? 5_000 : waitMs);
  const state: LineState = { meta: undefined, turn: undefined, pending: '', discarding: false };
  const decoder = new StringDecoder('utf8');
  let offset = 0;
  do {
    try {
      offset = await readAvailable(handle, decoder, offset, state, input, deadline);
      if (hasExactMetadata(state)) {
        try {
          return { ...makeContext(state.meta, state.turn, input), instanceId };
        } catch (error) {
          const reason = error instanceof Error ? error.message : 'Invalid activation metadata';
          return unknownContext(input, instanceId, reason);
        }
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Invalid activation metadata';
      return unknownContext(input, instanceId, reason);
    }
    if (waitMs === 0 || Date.now() >= deadline) break;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  } while (Date.now() <= deadline);
  return unknownContext(
    input,
    instanceId,
    'Exact session and turn metadata were not available within five seconds.',
  );
}

export async function readExactTurn(input: HookInput, maxWaitMs = 5_000): Promise<LeadContext> {
  const path = sessionPath(input);
  const sessionsRoot = path.slice(0, path.lastIndexOf('/sessions/') + '/sessions'.length);
  const [realLog, realSessions] = await Promise.all([realpath(path), realpath(sessionsRoot)]);
  if (!exactPath(realLog, realSessions))
    throw new Error('Transcript resolves outside the Codex sessions directory');
  const handle = await open(realLog, 'r');
  try {
    return await scanForContext(handle, input, resolve(realSessions, '..'), maxWaitMs);
  } finally {
    await handle.close();
  }
}

function parseCompleteLines(contents: string, input: HookInput): LeadContext | undefined {
  const completeContents = contents.endsWith('\n')
    ? contents
    : contents.slice(0, contents.lastIndexOf('\n') + 1);
  try {
    const { meta, turn } = matchingPayloads(completeContents.split('\n'), input);
    return makeContext(meta, turn, input);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === 'Exact session or turn metadata is not available yet'
    ) {
      return undefined;
    }
    throw error;
  }
}

export function parseExactTurn(contents: string, input: HookInput): LeadContext {
  const context = parseCompleteLines(contents, input);
  if (!context) throw new Error('Exact session or turn metadata is not available yet');
  return context;
}
