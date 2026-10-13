import type { HookInput } from '../src/activation/types.js';

export const fixtureInput: HookInput = {
  session_id: '01a1090e-4f83-7a73-8500-f87c808e0e85',
  turn_id: '01a1090e-4f83-7a73-8500-f87c808e0e86',
  cwd: '/workspace/project',
  transcript_path: '/fixture-profile/sessions/2026/10/13/session.jsonl',
};

// Minimal metadata projection of the observed Desktop 0.162.0-alpha.17.2 log.
// Identifiers and paths are synthetic; no chat content or account fields are retained.
export function compatibilityRows(version = '0.162.0-alpha.17.2') {
  const session = {
    timestamp: '2026-10-13T15:20:08Z',
    ordinal: 0,
    type: 'session_meta',
    payload: {
      session_id: fixtureInput.session_id,
      id: fixtureInput.session_id,
      cli_version: version,
    },
  };
  const turn = {
    timestamp: '2026-10-13T15:23:30Z',
    ordinal: 1,
    type: 'turn_context',
    payload: {
      turn_id: fixtureInput.turn_id,
      cwd: fixtureInput.cwd,
      model: 'gpt-6-astra',
      effort: 'ultra',
      collaboration_mode: {
        mode: 'default',
        settings: { model: 'gpt-6-astra', reasoning_effort: 'ultra' },
      },
    },
  };
  return { session, turn };
}

export function serializeRows(...rows: unknown[]): string {
  return `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`;
}

export function compatibilityLog(version = '0.162.0-alpha.17.2'): string {
  const { session, turn } = compatibilityRows(version);
  return serializeRows(session, turn);
}
