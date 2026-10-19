import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { expect, it } from 'vitest';
import { z } from 'zod';
import { createPanelServer } from '../src/mcp/panel-server.js';
import { request, single, until } from './runtime-fixture.js';
import { runningFixture } from './local-runtime-fixture.js';

async function connected() {
  const f = await runningFixture();
  const server = createPanelServer(
    async (key) =>
      key === 'unknown'
        ? { ...f.grant.context, resolutionStatus: 'unknown', resolutionReason: 'Unverified' }
        : {
            ...f.grant.context,
            sessionId: key === 'other' ? 'other' : f.owner.sessionId,
            collaborationMode:
              ({ plan: 'plan', 'unknown-mode': 'unknown' } as Record<string, string>)[key] ??
              'default',
          },
    f.dataDir,
    async () => '<main>fixture</main>',
    f.call,
  );
  const client = new Client({ name: 'runtime-tests', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return {
    ...f,
    client,
    finish: async () => {
      await client.close();
      await server.close();
      await f.close();
    },
  };
}

it('opens bound with runtime capability and executes through the MCP/daemon boundary', async () => {
  const f = await connected();
  try {
    const opened = await f.client.callTool({
      name: 'ultra_panel',
      arguments: { contextKey: 'verified' },
    });
    expect(opened.structuredContent).toMatchObject({
      bound: true,
      capabilityAvailability: 'available',
    });
    const nonce = z
      .object({ bindingNonce: z.string() })
      .parse(opened.structuredContent).bindingNonce;
    const started = await f.client.callTool({
      name: 'ultra_start',
      arguments: { ...request(single), capacity: f.grant.capacity },
    });
    expect(started.isError).not.toBe(true);
    const runId = z.object({ id: z.string() }).parse(started.structuredContent).id;
    await until(() => f.daemon.engine.status(f.owner)[0]?.state === 'completed');
    expect(
      (await f.client.callTool({ name: 'ultra_status', arguments: { nonce } })).structuredContent,
    ).toMatchObject({ runs: [{ id: runId, tasks: [{ result: { value: 'résultat' } }] }] });
    expect(
      (
        await f.client.callTool({
          name: 'ultra_result',
          arguments: { contextKey: 'verified', runId },
        })
      ).structuredContent,
    ).toMatchObject({ id: runId });
    expect(
      (
        await f.client.callTool({
          name: 'ultra_wait',
          arguments: { contextKey: 'verified', afterCursor: 0, timeoutMs: 0 },
        })
      ).isError,
    ).not.toBe(true);
    expect(
      (
        await f.client.callTool({
          name: 'ultra_panel_control',
          arguments: { nonce, runId, action: 'cancel' },
        })
      ).isError,
    ).not.toBe(true);
  } finally {
    await f.finish();
  }
});

it('rejects guessed owners, unbound nonces, unknown contexts and ambiguous access', async () => {
  const f = await connected();
  try {
    for (const args of [
      {},
      { nonce: 'guessed' },
      { contextKey: 'unknown' },
      { nonce: 'guessed', contextKey: 'verified' },
    ]) {
      expect((await f.client.callTool({ name: 'ultra_status', arguments: args })).isError).toBe(
        true,
      );
    }
    const result = await f.client.callTool({
      name: 'ultra_start',
      arguments: { ...request(), contextKey: 'unknown', capacity: f.grant.capacity },
    });
    expect(result.isError).toBe(true);
    expect(f.daemon.engine.status(f.owner)).toEqual([]);
  } finally {
    await f.finish();
  }
});

it('claims and resolves lead handoffs atomically through the verified context', async () => {
  const f = await connected();
  try {
    const script =
      'return await lead({phase:phase("Decision"),objective:"Verify result",resources:[],evidence:[]});';
    await f.client.callTool({
      name: 'ultra_start',
      arguments: { ...request(script), capacity: f.grant.capacity },
    });
    await until(() => f.daemon.engine.status(f.owner)[0]?.handoffs.length === 1);
    const handoff = f.daemon.engine.status(f.owner)[0]!.handoffs[0]!;
    const invoke = (action: string, extra = {}) =>
      f.client.callTool({
        name: 'ultra_handoff',
        arguments: { contextKey: 'verified', id: handoff.id, action, ...extra },
      });
    expect((await invoke('claim')).isError).not.toBe(true);
    const resolution = {
      acceptance: 'satisfied',
      value: 'verified',
      evidence: [{ id: 'actual-readback', description: 'Actual fixture check' }],
    };
    expect((await invoke('resolve', { resolution })).isError).not.toBe(true);
    expect((await invoke('resolve', { resolution })).isError).not.toBe(true);
    expect(
      (await invoke('resolve', { resolution: { ...resolution, value: 'conflict' } })).isError,
    ).toBe(true);
    await until(() => f.daemon.engine.status(f.owner)[0]?.state === 'completed');
    expect(f.daemon.engine.status(f.owner)[0]?.acceptanceOutcome).toBe('satisfied');
  } finally {
    await f.finish();
  }
});

it('prevents a Plan-mode lead from resuming execution', async () => {
  const f = await connected();
  try {
    const result = await f.client.callTool({
      name: 'ultra_control',
      arguments: { contextKey: 'plan', runId: 'missing', action: 'resume' },
    });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      { type: 'text', text: expect.stringContaining('Default-mode') },
    ]);
  } finally {
    await f.finish();
  }
});

async function assertControlSchemas(client: Client): Promise<void> {
  const listed = (await client.listTools()).tools;
  const model = listed.find((tool) => tool.name === 'ultra_control')!;
  const panel = listed.find((tool) => tool.name === 'ultra_panel_control')!;
  const start = listed.find((tool) => tool.name === 'ultra_start')!;
  expect(start.inputSchema.properties?.script).toMatchObject({
    type: 'string',
    description: expect.stringContaining('log(value: JSON value)'),
  });
  expect(model._meta).toMatchObject({ ui: { visibility: ['model'] } });
  expect(panel._meta).toMatchObject({ ui: { visibility: ['app'] } });
  expect(model.inputSchema.required).toContain('contextKey');
  expect(model.inputSchema.properties).not.toHaveProperty('nonce');
  expect(panel.inputSchema.required).toContain('nonce');
}
async function rejected(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<boolean> {
  return (await client.callTool({ name, arguments: args })).isError === true;
}
it('separates model and panel controls and rejects nonce-only model resume', async () => {
  const f = await connected();
  try {
    await assertControlSchemas(f.client);
    const opened = await f.client.callTool({
      name: 'ultra_panel',
      arguments: { contextKey: 'plan' },
    });
    const nonce = z
      .object({ bindingNonce: z.string() })
      .parse(opened.structuredContent).bindingNonce;
    const started = await f.client.callTool({
      name: 'ultra_start',
      arguments: {
        ...request(
          `return await lead({phase:phase('Verify'),objective:'Inspect',resources:[],evidence:[]});`,
        ),
        capacity: f.grant.capacity,
      },
    });
    const runId = z.object({ id: z.string() }).parse(started.structuredContent).id;
    await until(() => f.daemon.engine.status(f.owner)[0]!.handoffs.length === 1);
    await f.client.callTool({
      name: 'ultra_control',
      arguments: { contextKey: 'verified', runId, action: 'pause' },
    });
    expect(f.daemon.engine.status(f.owner)[0]!.state).toBe('paused');
    expect(await rejected(f.client, 'ultra_control', { nonce, runId, action: 'resume' })).toBe(
      true,
    );
    for (const contextKey of ['plan', 'unknown-mode']) {
      expect(
        await rejected(f.client, 'ultra_control', { contextKey, nonce, runId, action: 'resume' }),
      ).toBe(true);
      expect(f.daemon.engine.status(f.owner)[0]!.state).toBe('paused');
    }
    expect(
      await rejected(f.client, 'ultra_panel_control', { nonce, runId, action: 'resume' }),
    ).toBe(false);
    expect(f.daemon.engine.status(f.owner)[0]!.state).toBe('running');
    expect(
      await rejected(f.client, 'ultra_control', { contextKey: 'plan', runId, action: 'pause' }),
    ).toBe(false);
    expect(
      await rejected(f.client, 'ultra_control', {
        contextKey: 'verified',
        runId,
        action: 'resume',
      }),
    ).toBe(false);
    expect(
      await rejected(f.client, 'ultra_control', { contextKey: 'plan', runId, action: 'cancel' }),
    ).toBe(false);
    expect(f.daemon.engine.status(f.owner)[0]!.state).toBe('cancelled');
  } finally {
    await f.finish();
  }
});

it('rejects unbound or wrong-chat panel control and context-only panel fallback', async () => {
  const f = await connected();
  try {
    const opened = await f.client.callTool({
      name: 'ultra_panel',
      arguments: { contextKey: 'other' },
    });
    const nonce = z
      .object({ bindingNonce: z.string() })
      .parse(opened.structuredContent).bindingNonce;
    const started = await f.client.callTool({
      name: 'ultra_start',
      arguments: { ...request(), capacity: f.grant.capacity },
    });
    const runId = z.object({ id: z.string() }).parse(started.structuredContent).id;
    for (const access of [{ nonce: 'unbound' }, { nonce }, { contextKey: 'verified' }]) {
      expect(
        (
          await f.client.callTool({
            name: 'ultra_panel_control',
            arguments: { ...access, runId, action: 'cancel' },
          })
        ).isError,
      ).toBe(true);
    }
  } finally {
    await f.finish();
  }
});
