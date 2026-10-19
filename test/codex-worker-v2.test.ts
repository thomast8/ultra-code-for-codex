import { expect, it } from 'vitest';
import { workerPrompt } from '../src/codex/worker-output.js';
import { workerHarness, workerSpec, workerThread } from './codex-worker-fixture.js';

it('gives v2 readers the shared read-only shell rule and local recovery boundary', () => {
  const reader = workerPrompt(workerSpec({ format: 'plain', prompt: 'Assess CSV' }));
  const writer = workerPrompt(
    workerSpec({
      format: 'plain',
      prompt: 'Edit source',
      capability: 'workspace-write',
    }),
  );
  expect(reader).toContain('Do not use shell heredocs');
  expect(reader).toContain('python3 -c');
  expect(reader).toContain('not a terminal workflow failure');
  expect(writer).not.toContain('Read-only execution cannot create temporary files');
  expect(writer).toContain('not a terminal workflow failure');
});

function durable(status: 'idle' | 'active' = 'idle') {
  return workerThread({
    thread: {
      id: 'worker-thread',
      ephemeral: false,
      status: { type: status },
      environments: [
        { environmentId: 'local', cwd: '/private/tmp', runtimeWorkspaceRoots: ['/private/tmp'] },
      ],
    },
  });
}

it('launches a durable plain-text worker without a mandatory output schema', async () => {
  const h = workerHarness();
  h.backend.overrides['thread/start'] = durable();
  h.backend.execute = () => h.backend.finish('Source checked');
  const result = await h.execute(
    workerSpec({ format: 'plain', prompt: 'Check source' }),
    h.options,
  );
  expect(result).toMatchObject({
    execution: 'completed',
    acceptance: 'unverified',
    value: 'Source checked',
  });
  expect(h.backend.calls.find((call) => call.method === 'thread/start')?.params).toMatchObject({
    ephemeral: false,
  });
  expect(h.backend.calls.find((call) => call.method === 'turn/start')?.params).not.toHaveProperty(
    'outputSchema',
  );
});

it('resumes only the exact idle worker with restrictions reverified', async () => {
  const h = workerHarness();
  h.backend.overrides['thread/resume'] = durable();
  h.backend.execute = () => h.backend.finish('Follow-up checked');
  const result = await h.execute(
    workerSpec({
      format: 'plain',
      prompt: 'Check prior finding',
      resumeThreadId: 'worker-thread',
    }),
    h.options,
  );
  expect(result).toMatchObject({ execution: 'completed', value: 'Follow-up checked' });
  expect(h.backend.calls.some((call) => call.method === 'thread/start')).toBe(false);
  expect(h.backend.calls.find((call) => call.method === 'thread/resume')?.params).toMatchObject({
    threadId: 'worker-thread',
    model: 'gpt-6.1-sol',
    approvalPolicy: 'never',
  });
  const busy = workerHarness();
  busy.backend.overrides['thread/resume'] = durable('active');
  expect(
    await busy.execute(
      workerSpec({
        format: 'plain',
        prompt: 'Do not overlap',
        resumeThreadId: 'worker-thread',
      }),
      busy.options,
    ),
  ).toMatchObject({ execution: 'failed', error: 'Worker has a conflicting active turn' });
  expect(busy.backend.calls.some((call) => call.method === 'turn/start')).toBe(false);
});
