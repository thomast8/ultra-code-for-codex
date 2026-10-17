import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { z } from 'zod';
import { registerContext, resolveCurrentContext } from '../src/activation/registry.js';
import { createPanelServer } from '../src/mcp/panel-server.js';
import {
  compatibilityRows,
  fixtureInput,
  serializeRows,
} from './activation-compatibility-fixture.js';

async function fixture() {
  const profile = await mkdtemp(join(tmpdir(), 'ultra-first-open-'));
  const dataDir = join(profile, 'plugins/data/ultra-code');
  const transcript = join(profile, 'sessions/current.jsonl');
  await mkdir(join(profile, 'sessions'));
  const rows = compatibilityRows('0.163.0-alpha.10.2');
  await writeFile(transcript, serializeRows(rows.session, rows.turn));
  const { contextKey } = await registerContext(
    { ...fixtureInput, transcript_path: transcript },
    dataDir,
  );
  const server = createPanelServer(
    resolveCurrentContext,
    dataDir,
    async () => '<main>panel</main>',
  );
  const client = new Client({ name: 'first-open', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return {
    profile,
    dataDir,
    contextKey,
    client,
    close: () => Promise.all([client.close(), server.close()]),
  };
}

it.each([
  { threadId: fixtureInput.session_id, thread_id: fixtureInput.session_id },
  { threadId: fixtureInput.session_id },
  { thread_id: fixtureInput.session_id },
])(
  'binds a first manual open to its exact registered chat without a prior panel: %j',
  async (_meta) => {
    const f = await fixture();
    try {
      const result = await f.client.callTool({ name: 'ultra_panel', arguments: {}, _meta });
      expect(result.structuredContent).toMatchObject({
        bound: true,
        sessionId: fixtureInput.session_id,
        turnId: fixtureInput.turn_id,
      });
      const nonce = z
        .object({ bindingNonce: z.string() })
        .parse(result.structuredContent).bindingNonce;
      expect(
        (await f.client.callTool({ name: 'ultra_panel_status', arguments: { nonce } }))
          .structuredContent,
      ).toEqual({ state: 'bound' });
    } finally {
      await f.close();
    }
  },
);

it.each(['unknown', 'foreign-profile'])('keeps %s registered context unbound', async (mode) => {
  const f = await fixture();
  try {
    const file = join(f.dataDir, 'activation', `${f.contextKey}.json`);
    const stored = JSON.parse(await readFile(file, 'utf8'));
    if (mode === 'unknown') stored.context.resolutionStatus = stored.resolutionStatus = 'unknown';
    else stored.context.instanceId = f.profile + '-foreign';
    await writeFile(file, JSON.stringify(stored));
    const result = await f.client.callTool({
      name: 'ultra_panel',
      arguments: {},
      _meta: { threadId: fixtureInput.session_id },
    });
    expect(result.structuredContent).not.toHaveProperty('bound');
  } finally {
    await f.close();
  }
});

it('does not bind a different routed chat to the available current registration', async () => {
  const f = await fixture();
  try {
    const result = await f.client.callTool({
      name: 'ultra_panel',
      arguments: {},
      _meta: { threadId: '01a2090e-4f83-7a73-8500-f87c808e0e85' },
    });
    expect(result.structuredContent).not.toHaveProperty('bound');
  } finally {
    await f.close();
  }
});

it.each([
  {},
  { progressToken: 1 },
  { threadId: 'invalid' },
  { threadId: fixtureInput.session_id, thread_id: '01a2090e-4f83-7a73-8500-f87c808e0e85' },
])('does not use a current registration for unverified routing: %j', async (_meta) => {
  const f = await fixture();
  try {
    const result = await f.client.callTool({ name: 'ultra_panel', arguments: {}, _meta });
    expect(result.structuredContent).not.toHaveProperty('bound');
    expect(result.structuredContent).not.toHaveProperty('sessionId');
  } finally {
    await f.close();
  }
});
