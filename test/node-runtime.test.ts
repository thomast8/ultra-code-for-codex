import { expect, it } from 'vitest';
import { verifyNodeRuntime } from '../src/local/node-runtime.js';

it('accepts verified Node releases and rejects untested runtimes', () => {
  for (const version of ['26.10.0', '26.12.0'])
    expect(() => verifyNodeRuntime(version)).not.toThrow();
  expect(() => verifyNodeRuntime()).not.toThrow();
  for (const version of ['22.0.0', '26.11.0', '26.12.1', '27.0.0', 'invalid'])
    expect(() => verifyNodeRuntime(version)).toThrow('Node 26.10.0 or 26.12.0 is required');
});
