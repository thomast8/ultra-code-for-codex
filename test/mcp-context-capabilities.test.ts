import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { expect, it, vi } from 'vitest';
import type { WorkerCapabilities } from '../src/codex/worker-capabilities.js';
import type { DaemonCall } from '../src/local/client.js';
import { createPanelServer } from '../src/mcp/panel-server.js';
import { localFixture } from './local-runtime-fixture.js';

const capabilities: WorkerCapabilities = {
  status: 'verified-metadata',
  profileVerified: true,
  accountType: 'chatgpt',
  ordinaryUsageAllowed: true,
  models: [
    { model: 'gpt-6-luna', reasoningEfforts: ['low', 'medium'] },
    { model: 'gpt-6.1-sol', reasoningEfforts: ['high'] },
  ],
  capacity: { profileWorkerLimit: 3, hostWideAvailableSlots: null },
  blockers: [],
};

async function connected(runtime?: DaemonCall) {
  const f = localFixture();
  const resolver = vi.fn(async (key: string) =>
    key === 'unknown'
      ? {
          ...f.grant.context,
          resolutionStatus: 'unknown' as const,
          resolutionReason: 'Unverified turn',
        }
      : f.grant.context,
  );
  const server = createPanelServer(
    resolver,
    f.dataDir,
    async () => '<main>fixture</main>',
    runtime,
  );
  const client = new Client({ name: 'capability-tests', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return {
    ...f,
    resolver,
    read: (contextKey = 'verified') =>
      client.callTool({ name: 'ultra_context', arguments: { contextKey } }),
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

it('returns live model metadata through ultra_context without replacing the selected lead', async () => {
  const runtime = vi.fn<DaemonCall>(async (method) => (method === 'health' ? {} : capabilities));
  const f = await connected(runtime);
  try {
    const result = await f.read();
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      ...f.grant.context,
      capabilityAvailability: 'available',
      executionCapabilities: capabilities,
    });
    expect(runtime.mock.calls).toEqual([
      ['health', {}],
      ['capabilities', { owner: f.owner, cwd: f.grant.context.cwd }],
    ]);
    expect(f.resolver).toHaveBeenCalledWith('verified', f.dataDir);
    expect(result.content).toEqual([
      { type: 'text', text: expect.stringContaining('Workflow runtime is available') },
    ]);
  } finally {
    await f.close();
  }
});

it('does not inspect or launch a backend for unknown context', async () => {
  const runtime = vi.fn<DaemonCall>();
  const f = await connected(runtime);
  try {
    const result = await f.read('unknown');
    expect(result.structuredContent).toMatchObject({
      resolutionStatus: 'unknown',
      resolutionReason: 'Unverified turn',
      capabilityAvailability: 'unavailable',
      capabilityReason: 'Current-turn context is unverified: Unverified turn',
    });
    expect(result.structuredContent).not.toHaveProperty('executionCapabilities');
    expect(runtime).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('Compatibility probe');
  } finally {
    await f.close();
  }
});

it('retains verified context but skips capability inspection after runtime health failure', async () => {
  const runtime = vi.fn<DaemonCall>(async () => {
    throw new Error('Pinned runtime unavailable');
  });
  const f = await connected(runtime);
  try {
    const result = await f.read();
    expect(result.structuredContent).toMatchObject({
      resolutionStatus: 'verified',
      capabilityAvailability: 'unavailable',
      capabilityReason: 'Pinned runtime unavailable',
    });
    expect(result.content).toEqual([
      { type: 'text', text: 'Workflow execution is unavailable: Pinned runtime unavailable' },
    ]);
    expect(runtime.mock.calls).toEqual([['health', {}]]);
    expect(result.structuredContent).not.toHaveProperty('executionCapabilities');
  } finally {
    await f.close();
  }
});

it.each([
  [new Error('Capability inspection blocked'), 'Capability inspection blocked'],
  ['unknown failure', 'Worker capability inspection failed'],
])(
  'reports capability inspection failure without inventing model metadata',
  async (failure, reason) => {
    const runtime = vi.fn<DaemonCall>(async (method) => {
      if (method === 'capabilities') throw failure;
      return {};
    });
    const f = await connected(runtime);
    try {
      const result = await f.read();
      expect(result.structuredContent).toMatchObject({
        resolutionStatus: 'verified',
        capabilityAvailability: 'unavailable',
        capabilityReason: reason,
      });
      expect(result.structuredContent).not.toHaveProperty('executionCapabilities');
      expect(result.content).toEqual([
        { type: 'text', text: `Workflow execution is unavailable: ${reason}` },
      ]);
      expect(runtime).toHaveBeenCalledTimes(2);
    } finally {
      await f.close();
    }
  },
);

it('preserves explicit blocked capability metadata without treating it as dispatch approval', async () => {
  const blocked: WorkerCapabilities = {
    ...capabilities,
    status: 'blocked',
    ordinaryUsageAllowed: false,
    blockers: ['Ordinary included usage is not verified available'],
  };
  const runtime = vi.fn<DaemonCall>(async (method) => (method === 'health' ? {} : blocked));
  const f = await connected(runtime);
  try {
    expect((await f.read()).structuredContent).toMatchObject({
      capabilityAvailability: 'available',
      executionCapabilities: blocked,
    });
    expect(runtime.mock.calls.map(([method]) => method)).toEqual(['health', 'capabilities']);
  } finally {
    await f.close();
  }
});

it('keeps runtime capability unavailable when no daemon connection is configured', async () => {
  const f = await connected();
  try {
    const result = await f.read();
    expect(result.structuredContent).toMatchObject({
      resolutionStatus: 'verified',
      capabilityAvailability: 'unavailable',
    });
    expect(result.structuredContent).not.toHaveProperty('executionCapabilities');
  } finally {
    await f.close();
  }
});
