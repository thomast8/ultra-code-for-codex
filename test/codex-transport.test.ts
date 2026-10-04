import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { expect, it } from 'vitest';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { CodexTransport, type SpawnCodexChild } from '../src/codex/transport.js';

it('performs the initialize handshake and sends initialized before later requests', async () => {
  const transport = makeTransport(`
      let initialized = false;
      process.stdin.on('data', chunk => {
        for (const line of chunk.toString().trim().split('\\n')) {
          const message = JSON.parse(line);
          if (message.method === 'initialize') process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,result:{userAgent:'codex/0.160.0'}})+'\\n');
          if (message.method === 'initialized') initialized = true;
          if (message.method === 'state') process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,result:initialized})+'\\n');
        }
      });`);
  await expect(transport.initialize()).resolves.toMatchObject({ userAgent: 'codex/0.160.0' });
  await expect(transport.request('state')).resolves.toBe(true);
  transport.close();
});

it('launches the bundled app-server with the expected stdio arguments', async () => {
  const source = `process.stdin.once('data', chunk => {
      const message = JSON.parse(chunk.toString());
      process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,result:{userAgent:'codex/0.160.0'}})+'\\n');
    });`;
  const launchChild: SpawnCodexChild = (_executable, args, options) => {
    expect(args).toEqual(['app-server', '--listen', 'stdio://']);
    return spawn(process.execPath, ['-e', source], options);
  };
  const transport = await CodexTransport.launch('/bundled/codex', 500, launchChild);
  transport.close();
});

it('rejects process launch errors without exposing executable paths', async () => {
  const brokenSpawn: SpawnCodexChild = () =>
    spawn('/missing/bundled-codex', [], { stdio: ['pipe', 'pipe', 'pipe'] });
  await expect(CodexTransport.launch('/bundled/codex', 500, brokenSpawn)).rejects.toThrow('ENOENT');
});

it('closes the child when initialization fails', async () => {
  const transport = makeTransport(`
      process.stdin.once('data', chunk => {
        const message = JSON.parse(chunk.toString());
        process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,error:{code:-1,message:'unsupported'}})+'\\n');
      });`);
  await expect(transport.initialize()).rejects.toThrow('unsupported');
  await expect(transport.request('after-failure')).rejects.toThrow('closed');
});

it('answers approval requests with a JSON-RPC error and resolves ordinary replies', async () => {
  const source = `
      let denied = false;
      process.stdin.on('data', chunk => {
        for (const line of chunk.toString().trim().split('\\n')) {
          const message = JSON.parse(line);
          if (message.id === 'approval-1' && message.error) denied = true;
          if (message.method === 'exercise') {
            process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:'approval-1',method:'item/commandExecution/requestApproval',params:{}})+'\\n');
            setTimeout(() => process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,result:denied})+'\\n'), 20);
          }
        }
      });`;
  const transport = new CodexTransport(
    spawn(process.execPath, ['-e', source], { stdio: ['pipe', 'pipe', 'pipe'] }),
    500,
  );
  await expect(transport.request<boolean>('exercise')).resolves.toBe(true);
  transport.close();
});

it('rejects timed out requests and terminates cleanly', async () => {
  const source = `process.stdin.resume();`;
  const transport = new CodexTransport(
    spawn(process.execPath, ['-e', source], { stdio: ['pipe', 'pipe', 'pipe'] }),
    20,
  );
  await expect(transport.request('never-replies')).rejects.toThrow('timed out');
  transport.close();
  await expect(transport.request('after-close')).rejects.toThrow('closed');
});

it('rejects malformed output without exposing the offending payload', async () => {
  const transport = makeTransport(`process.stdout.write('not-json\\n'); process.stdin.resume();`);
  await expect(transport.request('will-fail')).rejects.toThrow('malformed JSON-RPC');
});

it('rejects oversized messages and terminates the child', async () => {
  const transport = makeTransport(
    `process.stdout.write('x'.repeat(1048577)); process.stdin.resume();`,
  );
  await expect(transport.request('oversized')).rejects.toThrow('oversized JSON-RPC');
});

it('rejects oversized complete lines and trailing fragments', async () => {
  const fullLine = makeTransport(
    `process.stdout.write('x'.repeat(1048577)+'\\n'); process.stdin.resume();`,
  );
  await expect(fullLine.request('oversized-line')).rejects.toThrow('oversized JSON-RPC');
  const stream = makeStreamTransport();
  const pending = stream.transport.request('oversized-tail');
  stream.send('{}\n' + 'x'.repeat(1048577));
  await expect(pending).rejects.toThrow('oversized JSON-RPC');
});

it('ignores notifications and replies for unknown request IDs', async () => {
  const stream = makeStreamTransport();
  const pending = stream.transport.request('wait');
  stream.send(
    JSON.stringify({ jsonrpc: '2.0', method: 'server/notice' }) +
      '\n' +
      JSON.stringify({ jsonrpc: '2.0', id: 999, result: true }) +
      '\n' +
      JSON.stringify({ jsonrpc: '2.0', id: 1, result: 'ok' }) +
      '\n',
  );
  await expect(pending).resolves.toBe('ok');
  stream.transport.close();
});

it('preserves remote JSON-RPC error codes', async () => {
  const transport = makeTransport(`
      process.stdin.once('data', chunk => {
        const message = JSON.parse(chunk.toString());
        process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,error:{code:42,message:'denied'}})+'\\n');
      });`);
  await expect(transport.request('fail')).rejects.toMatchObject({ message: 'denied', code: 42 });
  transport.close();
});

it('rejects pending requests on child exit', async () => {
  const transport = makeTransport(`process.stdin.once('data', () => process.exit(7));`);
  await expect(transport.request('exit')).rejects.toThrow('exited (7)');
});

function makeTransport(source: string, timeoutMs = 500): CodexTransport {
  return new CodexTransport(
    spawn(process.execPath, ['-e', source], { stdio: ['pipe', 'pipe', 'pipe'] }),
    timeoutMs,
  );
}

function makeStreamTransport(): { transport: CodexTransport; send: (chunk: string) => void } {
  const stdout = new PassThrough();
  const child = Object.assign(new EventEmitter(), {
    stdout,
    stdin: new PassThrough(),
    stderr: new PassThrough(),
    kill: () => true,
  });
  const transport = new CodexTransport(child as unknown as ChildProcessWithoutNullStreams, 500);
  return { transport, send: (chunk) => stdout.write(chunk) };
}
