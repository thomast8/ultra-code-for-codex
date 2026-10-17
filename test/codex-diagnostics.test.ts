import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { expect, it } from 'vitest';
import { CodexDiagnostics } from '../src/codex/diagnostics.js';
import { CodexTransport } from '../src/codex/transport.js';

it('reports recognized failure categories and source position without values or paths', () => {
  const diagnostics = new CodexDiagnostics();
  diagnostics.append('TOML parse error at line 12, column 4 in /private/credential\n');
  diagnostics.append('unknown variant secret-value; invalid type; missing field\n');
  diagnostics.append('authentication failed token=sentinel-token\nprofile initialization failed\n');
  diagnostics.append('Permission denied; No such file or directory; address already in use');
  const error = diagnostics.annotate(new Error('Initialization failed'));
  expect(error.message).toContain('configuration parsing failed');
  expect(error.message).toContain('unsupported configuration value');
  expect(error.message).toContain('invalid configuration type');
  expect(error.message).toContain('required configuration field missing');
  expect(error.message).toContain('authentication failed');
  expect(error.message).toContain('profile initialization failed');
  expect(error.message).toContain('filesystem permission denied');
  expect(error.message).toContain('required file or directory missing');
  expect(error.message).toContain('endpoint already in use');
  expect(error.message).toContain('TOML line 12, column 4');
  expect(error.message).not.toMatch(/credential|secret-value|sentinel-token/);
  expect(diagnostics.annotate(error).message.match(/Codex stderr summary:/g)).toHaveLength(1);
});

it('bounds the retained tail and withholds unrecognized text', () => {
  const diagnostics = new CodexDiagnostics();
  expect(diagnostics.annotate(new Error('Empty')).message).toBe('Empty');
  diagnostics.append('authentication failed');
  diagnostics.append('x'.repeat(9000));
  expect(diagnostics.annotate(new Error('Exit')).message).toBe(
    'Exit\nCodex stderr summary: unrecognized diagnostic; raw details withheld',
  );
});

it.each(['exit', 'reply', 'timeout'])(
  'retains safe stderr diagnostics on initialization %s',
  async (kind) => {
    const action =
      kind === 'exit'
        ? 'process.exit(7)'
        : kind === 'reply'
          ? `process.stdout.write(JSON.stringify({id:1,error:{code:42,message:'Initialize rejected'}})+'\\n')`
          : '';
    const child = spawn(
      process.execPath,
      [
        '-e',
        `process.stdin.once('data',()=>{
    process.stderr.write('authentication failed; token=sentinel-token\\n',()=>{${action}});
  });
  process.stdout.write('ready\\n');`,
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let transport: CodexTransport | undefined;
    try {
      await expect(once(child.stdout, 'data')).resolves.toEqual([Buffer.from('ready\n')]);
      transport = new CodexTransport(child, 300);
      const failure = transport.initialize();
      const reason =
        kind === 'exit' ? 'exited (7)' : kind === 'reply' ? 'Initialize rejected' : 'timed out';
      await expect(failure).rejects.toThrow(reason);
      await expect(failure).rejects.toThrow('authentication failed');
      await expect(failure).rejects.not.toThrow('sentinel-token');
    } finally {
      transport?.close();
      child.kill();
    }
  },
);
