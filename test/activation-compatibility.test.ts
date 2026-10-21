import { describe, expect, it } from 'vitest';
import { parseExactTurn } from '../src/activation/session-source.js';
import {
  compatibilityLog,
  compatibilityRows,
  fixtureInput,
  serializeRows,
} from './activation-compatibility-fixture.js';

describe('versioned Desktop activation compatibility', () => {
  it.each(['0.160.0', '0.160.1', '0.162.0-alpha.17.2', '0.163.0-alpha.10.2'])(
    'verifies the exact session, turn, and profile for %s',
    (version) => {
      expect(parseExactTurn(compatibilityLog(version), fixtureInput)).toEqual({
        instanceId: '/fixture-profile',
        sessionId: fixtureInput.session_id,
        turnId: fixtureInput.turn_id,
        cwd: fixtureInput.cwd,
        model: 'gpt-6-astra',
        effort: 'ultra',
        collaborationMode: 'default',
        resolutionStatus: 'verified',
        resolutionReason: 'Exact session and turn metadata verified.',
      });
    },
  );

  it.each(['0.162.0', '0.162.0-alpha.17.1', '0.162.0-alpha.17.3'])(
    'verifies unlisted version %s when the required fields are present',
    (version) => {
      expect(parseExactTurn(compatibilityLog(version), fixtureInput)).toMatchObject({
        resolutionStatus: 'verified',
      });
    },
  );

  it('keeps an absent version unsupported', () => {
    expect(() => parseExactTurn(compatibilityLog(''), fixtureInput)).toThrow(
      'Unsupported Codex log version (missing)',
    );
  });

  it.each([
    ['ultra', 'default'],
    ['medium', 'default'],
    ['ultra', 'plan'],
    ['medium', 'plan'],
  ])('retains effort %s and collaboration mode %s', (effort, mode) => {
    const { session, turn } = compatibilityRows();
    turn.payload.effort = effort;
    turn.payload.collaboration_mode.mode = mode;
    turn.payload.collaboration_mode.settings.reasoning_effort = effort;
    expect(parseExactTurn(serializeRows(session, turn), fixtureInput)).toMatchObject({
      model: 'gpt-6-astra',
      effort,
      collaborationMode: mode,
      resolutionStatus: 'verified',
    });
  });
});

describe('current-version metadata boundaries', () => {
  it('requires matching session and turn metadata instead of a nearby record', () => {
    const { session, turn } = compatibilityRows();
    expect(() => parseExactTurn(serializeRows(session), fixtureInput)).toThrow(
      'Exact session or turn metadata',
    );
    expect(() => parseExactTurn(serializeRows(turn), fixtureInput)).toThrow(
      'Exact session or turn metadata',
    );
    const otherTurn = {
      ...turn,
      payload: { ...turn.payload, turn_id: '01a2090e-4f83-7a73-8500-f87c808e0e86' },
    };
    expect(() => parseExactTurn(serializeRows(session, otherTurn), fixtureInput)).toThrow(
      'Exact session or turn metadata',
    );
    expect(parseExactTurn(serializeRows(session, otherTurn, turn), fixtureInput).turnId).toBe(
      fixtureInput.turn_id,
    );
  });

  it('ignores incomplete trailing records until the newline arrives', () => {
    const { session, turn } = compatibilityRows();
    const partial = `${serializeRows(session)}${JSON.stringify(turn)}`;
    expect(() => parseExactTurn(partial, fixtureInput)).toThrow('Exact session or turn metadata');
    expect(parseExactTurn(`${partial}\n`, fixtureInput).resolutionStatus).toBe('verified');
  });

  it.each(['model', 'effort', 'cwd', 'collaboration_mode'])(
    'rejects missing current-version field %s',
    (field) => {
      const { session, turn } = compatibilityRows();
      const payload = Object.fromEntries(
        Object.entries(turn.payload).filter(([key]) => key !== field),
      );
      expect(() =>
        parseExactTurn(serializeRows(session, { ...turn, payload }), fixtureInput),
      ).toThrow(`Incomplete exact-turn metadata: ${field}`);
    },
  );

  it('rejects mismatching cwd and unsupported collaboration modes', () => {
    expect(() =>
      parseExactTurn(compatibilityLog(), { ...fixtureInput, cwd: '/another-workspace' }),
    ).toThrow('Hook input does not match exact-turn metadata');
    const { session, turn } = compatibilityRows();
    turn.payload.collaboration_mode.mode = 'future';
    expect(() => parseExactTurn(serializeRows(session, turn), fixtureInput)).toThrow(
      'Unsupported collaboration mode',
    );
  });
});

describe('current-version metadata conflicts', () => {
  it('rejects conflicting exact-turn model, effort, and Plan Mode records', () => {
    const { session, turn } = compatibilityRows();
    const conflictingPayloads = [
      { ...turn.payload, model: 'gpt-6-luna' },
      { ...turn.payload, effort: 'medium' },
      { ...turn.payload, collaboration_mode: { mode: 'plan' } },
    ];
    for (const payload of conflictingPayloads) {
      expect(() =>
        parseExactTurn(serializeRows(session, turn, { ...turn, payload }), fixtureInput),
      ).toThrow('Conflicting turn metadata');
    }
  });

  it('rejects conflicting session identifiers and version records', () => {
    const { session, turn } = compatibilityRows();
    const conflictingSession = {
      ...session,
      payload: { ...session.payload, id: '01a2090e-4f83-7a73-8500-f87c808e0e85' },
    };
    expect(() => parseExactTurn(serializeRows(conflictingSession, turn), fixtureInput)).toThrow(
      'Conflicting session metadata',
    );
    const previousSession = compatibilityRows('0.160.1').session;
    expect(() =>
      parseExactTurn(serializeRows(session, previousSession, turn), fixtureInput),
    ).toThrow('Conflicting session metadata');
  });
});
