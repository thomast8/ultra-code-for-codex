import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { expect, it, vi } from 'vitest';
import { CodexTransport } from '../src/codex/transport.js';

it('accepts multi-megabyte command results in fragmented and complete frames', async () => {
  const stdout = new PassThrough();
  const kill = vi.fn();
  const child = Object.assign(new EventEmitter(), {
    stdout,
    stdin: new PassThrough(),
    stderr: new PassThrough(),
    kill,
  });
  const transport = new CodexTransport(child as unknown as ChildProcessWithoutNullStreams);
  try {
    const output = 'x'.repeat(2 * 1024 * 1024);
    for (const id of [1, 2]) {
      const result = transport.request('command/exec');
      const frame = JSON.stringify({ id, result: { stdout: output } }) + '\n';
      if (id === 1) {
        stdout.write(frame.slice(0, 1_100_000));
        stdout.write(frame.slice(1_100_000));
      } else stdout.write(frame);
      await expect(result).resolves.toEqual({ stdout: output });
      expect(kill).not.toHaveBeenCalled();
    }
  } finally {
    transport.close();
  }
});
