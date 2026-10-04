import { describe, expect, it } from 'vitest';
import { parseExactTurn } from '../src/activation/session-source.js';
import type { HookInput } from '../src/activation/types.js';

const sessionId = '01a1090e-4f83-7a73-8500-f87c808e0e85';
const turnId = '01a1090e-4f83-7a73-8500-f87c808e0e86';
const cwd = '/workspace/project';
const input: HookInput = {
  session_id: sessionId,
  turn_id: turnId,
  cwd,
  transcript_path: '/fake-codex/sessions/2026/10/05/session.jsonl',
};

function rows(): string[] {
  return [
    JSON.stringify({
      timestamp: '2026-10-05T00:00:00Z',
      ordinal: 0,
      type: 'session_meta',
      payload: { id: sessionId, session_id: sessionId, cli_version: '0.160.0' },
    }),
    JSON.stringify({
      timestamp: '2026-10-05T00:00:01Z',
      ordinal: 1,
      type: 'turn_context',
      payload: {
        turn_id: turnId,
        cwd,
        model: 'gpt-6-luna',
        effort: 'medium',
        collaboration_mode: { mode: 'default' },
      },
    }),
  ];
}

describe('activation parser fallback and record selection', () => {
  it('accepts the documented session id fallback and string collaboration mode', () => {
    const [meta, turn] = rows();
    const fallback = `${meta?.replace(`"id":"${sessionId}",`, '')}\n${turn?.replace(
      '"collaboration_mode":{"mode":"default"}',
      '"collaboration_mode":"default"',
    )}\n`;
    expect(parseExactTurn(fallback, input)).toMatchObject({
      sessionId,
      collaborationMode: 'default',
      resolutionStatus: 'verified',
    });
  });

  it('selects the requested turn when earlier records belong to another turn', () => {
    const [meta, matchingTurn] = rows();
    const otherTurn = JSON.stringify({
      timestamp: '2026-10-04T00:00:00Z',
      ordinal: 1,
      type: 'turn_context',
      payload: {
        turn_id: '01a2090e-4f83-7a73-8500-f87c808e0e85',
        cwd,
        model: 'other-model',
        effort: 'low',
        collaboration_mode: { mode: 'default' },
      },
    });
    expect(parseExactTurn(`${meta}\n${otherTurn}\n${matchingTurn}\n`, input)).toMatchObject({
      turnId,
      model: 'gpt-6-luna',
    });
  });

  it('rejects oversized and non-object metadata payloads', () => {
    const [meta, turn] = rows();
    const oversizedMeta = meta?.replace(
      '"cli_version":"0.160.0"',
      `"cli_version":"0.160.0","padding":"${'x'.repeat(70_000)}"`,
    );
    expect(() => parseExactTurn(`${oversizedMeta}\n${turn}\n`, input)).toThrow(
      'Oversized activation metadata',
    );
    const invalidMeta = meta?.replace(/"payload":\{[^}]+\}/, '"payload":[]');
    expect(() => parseExactTurn(`${invalidMeta}\n${turn}\n`, input)).toThrow(
      'Invalid activation metadata record',
    );
  });
});
