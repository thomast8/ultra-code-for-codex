import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { runUserPromptHook } from '../src/activation/hook.js';
import { resolveContext } from '../src/activation/registry.js';
import { parseExactTurn } from '../src/activation/session-source.js';
import { fixtureInput, serializeRows } from './activation-compatibility-fixture.js';

type Row = { timestamp: string; ordinal: number; type: string; payload: Record<string, unknown> };
const directories: string[] = [];

// Projected from a fresh Desktop 0.163 chat; identifiers and paths are synthetic.
async function rows(): Promise<Row[]> {
  return JSON.parse(
    await readFile(new URL('./fixtures/codex-0.163-metadata.json', import.meta.url), 'utf8'),
  ) as Row[];
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

it('verifies a fresh current-Desktop session instead of relying on an older session header', async () => {
  expect(parseExactTurn(serializeRows(...(await rows())), fixtureInput)).toMatchObject({
    sessionId: fixtureInput.session_id,
    turnId: fixtureInput.turn_id,
    model: 'gpt-6.1-sol',
    effort: 'ultra',
    collaborationMode: 'default',
    resolutionStatus: 'verified',
  });
});

it.each([
  ['ultra', 'default', 'Ultra policy active:'],
  ['high', 'default', 'Ultra policy inactive:'],
  ['ultra', 'plan', 'Ultra planning policy active:'],
  ['high', 'plan', 'Ultra policy inactive:'],
])(
  'registers a fresh %s/%s turn without changing the selected lead',
  async (effort, mode, policy) => {
    const root = await mkdtemp(join(tmpdir(), 'ultra-codex-0163-'));
    directories.push(root);
    const records = await rows();
    records[1]!.payload = {
      ...records[1]!.payload,
      cwd: root,
      effort,
      collaboration_mode: { mode },
    };
    const transcript = join(root, 'sessions', 'fresh.jsonl');
    await mkdir(join(root, 'sessions'));
    await writeFile(transcript, serializeRows(...records));
    const dataDir = join(root, 'plugin-data');
    const output = await runUserPromptHook(
      {
        ...fixtureInput,
        cwd: root,
        transcript_path: transcript,
        hook_event_name: 'UserPromptSubmit',
        prompt: 'Audit three independent boundaries of this repository.',
      },
      { PLUGIN_DATA: dataDir },
    );
    const notice = output.hookSpecificOutput.additionalContext;
    expect(notice).toContain(policy);
    expect(notice).toContain('ultra_start, never native subagents');
    if (effort === 'ultra' && mode === 'plan') {
      expect(notice).toContain('read-only via ultra_start');
      expect(notice).toContain('lead plans');
      expect(notice).toContain('Plan Mode is read-only');
    }
    const key = notice.match(/^uctx_[0-9a-f-]{36}/)?.[0];
    expect(key).toBeDefined();
    await expect(resolveContext(key!, dataDir)).resolves.toMatchObject({
      model: 'gpt-6.1-sol',
      effort,
      collaborationMode: mode,
      resolutionStatus: 'verified',
    });
  },
);

it.each(['0.163.0-alpha.10.3', '0.164.0', ''])(
  'keeps unvalidated version %s blocked with its reason',
  async (version) => {
    const records = await rows();
    records[0]!.payload.cli_version = version;
    expect(() => parseExactTurn(serializeRows(...records), fixtureInput)).toThrow(
      `Unsupported Codex log version ${version || '(missing)'} for codex-turn-context-v1`,
    );
  },
);

it.each(['sentinel-secret', `1.2.3-${'x'.repeat(65)}`])(
  'does not echo invalid version data in diagnostics: %s',
  async (version) => {
    const records = await rows();
    records[0]!.payload.cli_version = version;
    expect(() => parseExactTurn(serializeRows(...records), fixtureInput)).toThrow(
      'Unsupported Codex log version (invalid)',
    );
  },
);

it.each([
  { session_id: '01a2090e-4f83-7a73-8500-f87c808e0e85' },
  { turn_id: '01a2090e-4f83-7a73-8500-f87c808e0e86' },
  { cwd: '/another-project' },
])('rejects mismatched identity or cwd for the new format: %j', async (change) => {
  const contents = serializeRows(...(await rows()));
  expect(() => parseExactTurn(contents, { ...fixtureInput, ...change })).toThrow();
});
