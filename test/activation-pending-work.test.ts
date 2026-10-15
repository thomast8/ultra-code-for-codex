import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it, vi } from 'vitest';
import * as pendingWork from '../src/activation/pending-work.js';
import { formatPendingWorkNotice, pendingWorkNotice } from '../src/activation/pending-work.js';
import { runUserPromptHook } from '../src/activation/hook.js';
import hookConfiguration from '../plugin/hooks/hooks.json';
import type { HandoffSnapshot, RunSnapshot } from '../src/contracts/workflow.js';
import { Journal } from '../src/runtime/journal.js';
import { createRun } from '../src/runtime/records.js';
import { authority, request } from './runtime-fixture.js';

afterEach(() => vi.restoreAllMocks());

function directory(): string {
  return mkdtempSync(join(tmpdir(), 'ultra-notice-'));
}
function seed(
  dataDir: string,
  selected = authority,
  state: RunSnapshot['state'] = 'paused',
  handoffStates: HandoffSnapshot['state'][] = ['pending'],
): void {
  const journal = new Journal(join(dataDir, 'runtime'));
  const record = createRun(request(), selected);
  record.snapshot.state = state;
  record.calls.push({
    id: `${record.snapshot.id}:1`,
    kind: 'lead',
    payload: null,
    state: 'queued',
    settlement: null,
    result: null,
    claims: [],
    task: null,
    threadId: null,
    turnId: null,
    instructionSources: [],
    handoff: {
      id: `${record.snapshot.id}:1`,
      state: 'pending',
      claimedTurnId: null,
      result: null,
      spec: {
        phase: { id: 'phase-1', label: 'Check' },
        objective: 'Review',
        resources: [],
        evidence: [],
      },
    },
  });
  const initial = record.calls[0]!;
  record.calls = handoffStates.map((state, index) => ({
    ...initial,
    id: `${record.snapshot.id}:${index + 1}`,
    handoff: {
      ...initial.handoff!,
      id: `${record.snapshot.id}:${index + 1}`,
      state,
      claimedTurnId: state === 'pending' ? null : 'turn',
    },
  }));
  journal.save(record, 'fixture');
  journal.close();
}

it('reports only the verified owner and leaves the journal unchanged', () => {
  const dataDir = directory();
  seed(dataDir);
  seed(dataDir, { ...authority, context: { ...authority.context, sessionId: 'another' } });
  const notice = pendingWorkNotice(dataDir, authority.context);
  expect(notice).toContain('Runs paused:1');
  expect(notice).toContain('unresolved lead handoffs:1');
  expect(pendingWorkNotice(dataDir, { ...authority.context, resolutionStatus: 'unknown' })).toBe(
    '',
  );
  expect(pendingWorkNotice(dataDir, { ...authority.context, instanceId: 'another-profile' })).toBe(
    '',
  );
  const db = new DatabaseSync(join(dataDir, 'runtime', 'workflow.sqlite'), { readOnly: true });
  expect(db.prepare('SELECT COUNT(*) AS count FROM events').get()!.count).toBe(2);
  db.close();
});

it.each(['cancelled', 'failed', 'completed'] as const)(
  'does not count unclaimed handoffs in %s workflows or mutate their audit records',
  (state) => {
    const dataDir = directory();
    seed(dataDir, authority, state);
    const db = new DatabaseSync(join(dataDir, 'runtime', 'workflow.sqlite'), { readOnly: true });
    try {
      const before = db.prepare('SELECT record FROM runs').all();
      expect(pendingWorkNotice(dataDir, authority.context)).toContain(
        `Runs ${state}:1; unresolved lead handoffs:0;`,
      );
      expect(db.prepare('SELECT record FROM runs').all()).toEqual(before);
      expect(db.prepare('SELECT COUNT(*) AS count FROM events').get()!.count).toBe(1);
    } finally {
      db.close();
    }
  },
);

it.each(['cancelled', 'failed', 'completed'] as const)(
  'continues counting claimed and reconciliation handoffs in %s workflows',
  (state) => {
    const dataDir = directory();
    seed(dataDir, authority, state, ['pending', 'claimed', 'needs_reconciliation']);
    expect(pendingWorkNotice(dataDir, authority.context)).toContain(
      `Runs ${state}:1; unresolved lead handoffs:2;`,
    );
  },
);

it.each(['queued', 'running', 'paused', 'needs_reconciliation'] as const)(
  'still counts pending handoffs in %s workflows',
  (state) => {
    const dataDir = directory();
    seed(dataDir, authority, state);
    expect(pendingWorkNotice(dataDir, authority.context)).toContain('unresolved lead handoffs:1');
  },
);

it('gracefully omits missing, corrupt and locked journals without creating one', () => {
  const missing = directory();
  expect(pendingWorkNotice(missing, authority.context)).toBe('');
  expect(existsSync(join(missing, 'runtime'))).toBe(false);
  const corrupt = directory();
  mkdirSync(join(corrupt, 'runtime'));
  writeFileSync(join(corrupt, 'runtime', 'workflow.sqlite'), 'not a database');
  expect(pendingWorkNotice(corrupt, authority.context)).toBe('');
  const locked = directory();
  seed(locked);
  const db = new DatabaseSync(join(locked, 'runtime', 'workflow.sqlite'));
  db.exec('PRAGMA journal_mode=DELETE; BEGIN EXCLUSIVE');
  expect(pendingWorkNotice(locked, authority.context)).toBe('');
  db.exec('ROLLBACK');
  db.close();
});

function hookFixture() {
  const root = directory();
  const dataDir = join(root, 'plugin-data');
  const transcriptPath = join(root, 'sessions', 'current.jsonl');
  mkdirSync(join(root, 'sessions'));
  const context = {
    ...authority.context,
    instanceId: realpathSync(root),
    sessionId: '01a1090e-4f83-7a73-8500-f87c808e0e85',
    turnId: '01a1090e-4f83-7a73-8500-f87c808e0e86',
    effort: 'ultra',
  };
  const rows = [
    {
      timestamp: '2026-10-13T00:00:00Z',
      ordinal: 0,
      type: 'session_meta',
      payload: { id: context.sessionId, session_id: context.sessionId, cli_version: '0.160.1' },
    },
    {
      timestamp: '2026-10-13T00:00:01Z',
      ordinal: 1,
      type: 'turn_context',
      payload: {
        turn_id: context.turnId,
        cwd: context.cwd,
        model: context.model,
        effort: 'ultra',
        collaboration_mode: { mode: 'default', settings: { model: context.model } },
      },
    },
  ];
  writeFileSync(transcriptPath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
  seed(dataDir, { ...authority, context });
  return { dataDir, context, transcriptPath };
}

it('adds the compact notice and skill instruction to the exact verified Ultra turn', async () => {
  const { dataDir, context, transcriptPath } = hookFixture();
  const result = await runUserPromptHook(
    {
      hook_event_name: 'UserPromptSubmit',
      session_id: context.sessionId,
      turn_id: context.turnId,
      cwd: context.cwd,
      transcript_path: transcriptPath,
    },
    { PLUGIN_DATA: dataDir },
  );
  const text = result.hookSpecificOutput.additionalContext;
  expect(text).toContain('Ultra policy active:');
  expect(text).toContain('Read the ultra-code skill');
  expect(text).toContain('unresolved lead handoffs:1');
  expect(text).toContain('Plan Mode is read-only');
  expect(text.length).toBeLessThanOrEqual(500);
});

it('preserves every policy and notice field at the configured limit with maximal safe counts', async () => {
  const { dataDir, context, transcriptPath } = hookFixture();
  const states = [
    'queued',
    'running',
    'paused',
    'cancelled',
    'completed',
    'failed',
    'needs_reconciliation',
  ];
  const counts = new Map(states.map((state) => [state, Number.MAX_SAFE_INTEGER]));
  const pending = formatPendingWorkNotice(counts, Number.MAX_SAFE_INTEGER);
  vi.spyOn(pendingWork, 'pendingWorkNotice').mockReturnValue(pending);
  const result = await runUserPromptHook(
    {
      hook_event_name: 'UserPromptSubmit',
      session_id: context.sessionId,
      turn_id: context.turnId,
      cwd: context.cwd,
      transcript_path: transcriptPath,
    },
    { PLUGIN_DATA: dataDir },
  );
  const text = result.hookSpecificOutput.additionalContext;
  const configuredLimit =
    hookConfiguration.hooks.UserPromptSubmit[0]!.hooks[0]!.additionalContextLimit;
  expect(configuredLimit).toBe(500);
  expect(text.length).toBeLessThanOrEqual(configuredLimit);
  expect(text).toMatch(/^uctx_[a-f0-9-]{36}: ultra_context with this exact handle\./);
  expect(text).toContain('Keep lead model/effort.');
  expect(text).toContain('delegate bounded independent work worth total cost');
  expect(text).toContain('lead owns intent and delivery');
  expect(text).toContain('Plan Mode is read-only. Read the ultra-code skill.');
  expect(text.endsWith(pending)).toBe(true);
  for (const state of states) {
    expect(pending).toContain(
      `${state === 'needs_reconciliation' ? 'reconcile' : state}:${Number.MAX_SAFE_INTEGER}`,
    );
  }
  expect(pending).toContain(`unresolved lead handoffs:${Number.MAX_SAFE_INTEGER}`);
});
