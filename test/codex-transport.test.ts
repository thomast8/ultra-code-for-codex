import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { expect, it } from 'vitest';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { CodexTransport, type SpawnCodexChild } from '../src/codex/transport.js';
import packageMetadata from '../package.json' with { type: 'json' };

it('performs the initialize handshake and sends initialized before later requests', async () => {
  const transport = makeTransport(`
      let initialized = false;
      let capabilities;
      let version;
      process.stdin.on('data', chunk => {
        for (const line of chunk.toString().trim().split('\\n')) {
          const message = JSON.parse(line);
          if (message.method === 'initialize') {
            capabilities = message.params.capabilities;
            version = message.params.clientInfo.version;
            process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,result:{userAgent:'codex/0.162.0-alpha.17.2',codexHome:'/fixture-profile',platformFamily:'unix',platformOs:'macos'}})+'\\n');
          }
          if (message.method === 'initialized') initialized = true;
          if (message.method === 'state') process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,result:{initialized,capabilities,version}})+'\\n');
        }
      });`);
  expect(transport.initializeMetadata).toBeNull();
  const metadata = await transport.initialize();
  expect(transport.initializeMetadata).toEqual({
    userAgent: 'codex/0.162.0-alpha.17.2',
    codexHome: '/fixture-profile',
    platformFamily: 'unix',
    platformOs: 'macos',
  });
  metadata.codexHome = '/modified-response';
  expect(transport.initializeMetadata?.codexHome).toBe('/fixture-profile');
  expect(Object.isFrozen(transport.initializeMetadata)).toBe(true);
  await expect(transport.request('state')).resolves.toEqual({
    initialized: true,
    capabilities: { experimentalApi: true, requestAttestation: false },
    version: packageMetadata.version,
  });
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

it('passes config overrides as separate process arguments without changing global configuration', async () => {
  const launchChild: SpawnCodexChild = (executable, args, options) => {
    expect(executable).toBe('/bundled/codex');
    expect(args).toEqual([
      'app-server',
      '--listen',
      'stdio://',
      '-c',
      'features.apps=false',
      '-c',
      'model="name with spaces; $(literal)"',
    ]);
    return spawn(
      process.execPath,
      [
        '-e',
        `process.stdin.once('data', chunk => {
      const message = JSON.parse(chunk.toString());
      process.stdout.write(JSON.stringify({id:message.id,result:{userAgent:'fixture'}})+'\\n');
    });`,
      ],
      options,
    );
  };
  const transport = await CodexTransport.launch('/bundled/codex', 500, launchChild, {
    configOverrides: ['features.apps=false', 'model="name with spaces; $(literal)"'],
  });
  transport.close();
});

it('rejects process launch errors without exposing executable paths', async () => {
  const brokenSpawn: SpawnCodexChild = () =>
    spawn('/missing/bundled-codex', [], { stdio: ['pipe', 'pipe', 'pipe'] });
  await expect(CodexTransport.launch('/bundled/codex', 500, brokenSpawn)).rejects.toThrow('ENOENT');
});

it('applies an explicit profile environment to the actual child process', async () => {
  const launchChild: SpawnCodexChild = (_file, _args, options) =>
    spawn(
      process.execPath,
      [
        '-e',
        `
    process.stdin.once('data', chunk => {
      const message = JSON.parse(chunk.toString());
      process.stdout.write(JSON.stringify({id:message.id,result:{codexHome:process.env.CODEX_HOME}})+'\\n');
    });
  `,
      ],
      options,
    );
  const transport = await CodexTransport.launch('/bundled/codex', 500, launchChild, {
    env: { ...process.env, CODEX_HOME: '/verified-secondary' },
  });
  expect(transport.initializeMetadata?.codexHome).toBe('/verified-secondary');
  transport.close();
});

it('closes the child when initialization fails', async () => {
  const transport = makeTransport(`
      process.stdin.once('data', chunk => {
        const message = JSON.parse(chunk.toString());
        process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,error:{code:-1,message:'unsupported'}})+'\\n');
      });`);
  await expect(transport.initialize()).rejects.toThrow('unsupported');
  expect(transport.initializeMetadata).toBeNull();
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

it.each(['null', '[]', '"not-an-object"'])(
  'rejects non-object JSON-RPC input %s',
  async (payload) => {
    const stream = makeStreamTransport();
    const pending = stream.transport.request('waiting');
    stream.send(`${payload}\n`);
    await expect(pending).rejects.toThrow('malformed JSON-RPC');
    expect(stream.kills()).toBe(1);
  },
);

it('rejects oversized messages and terminates the child', async () => {
  const stream = makeStreamTransport();
  const pending = stream.transport.request('oversized');
  stream.send('x'.repeat(16_777_217));
  await expect(pending).rejects.toThrow('oversized JSON-RPC');
  expect(stream.kills()).toBe(1);
});

it('rejects oversized complete lines and trailing fragments', async () => {
  const fullLine = makeStreamTransport();
  const linePending = fullLine.transport.request('oversized-line');
  fullLine.send('x'.repeat(16_777_217) + '\n');
  await expect(linePending).rejects.toThrow('oversized JSON-RPC');
  expect(fullLine.kills()).toBe(1);
  const stream = makeStreamTransport();
  const pending = stream.transport.request('oversized-tail');
  stream.send('{}\n' + 'x'.repeat(16_777_217));
  await expect(pending).rejects.toThrow('oversized JSON-RPC');
  expect(stream.kills()).toBe(1);
});

it('ignores unsubscribed notifications and replies for unknown request IDs', async () => {
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

it('delivers lifecycle notifications in order and supports unsubscribe', () => {
  const stream = makeStreamTransport();
  const received: string[] = [];
  const unsubscribe = stream.transport.onNotification((message) => {
    received.push(message.method);
  });
  stream.send('{"method":"turn/started","params":{"threadId":"worker"}}\n');
  stream.send('{"method":"item/completed","params":{"threadId":"worker"}}\n');
  expect(received).toEqual(['turn/started', 'item/completed']);
  unsubscribe();
  unsubscribe();
  stream.send('{"method":"turn/completed","params":{"threadId":"worker"}}\n');
  expect(received).toHaveLength(2);
  stream.transport.close();
});

it('clears subscriptions and rejects pending requests once when closed', async () => {
  const stream = makeStreamTransport();
  const events: string[] = [];
  const errors: string[] = [];
  stream.transport.onNotification(
    (message) => {
      events.push(message.method);
    },
    (error) => {
      errors.push(error.message);
    },
  );
  const pending = stream.transport.request('waiting');
  stream.transport.close();
  stream.transport.close();
  stream.send('{"method":"turn/completed","params":{}}\n');
  stream.exit(0);
  await expect(pending).rejects.toThrow('was closed');
  expect({ events, errors, kills: stream.kills() }).toEqual({
    events: [],
    errors: ['Codex app-server was closed'],
    kills: 1,
  });
  expect(() => stream.transport.onNotification(() => undefined)).toThrow('was closed');
});

it('reports process termination to subscribed worker waiters and excludes unsubscribed waiters', () => {
  const stream = makeStreamTransport();
  const errors: string[] = [];
  const unsubscribe = stream.transport.onNotification(
    () => undefined,
    () => {
      throw new Error('Unsubscribed failure observer must not run');
    },
  );
  unsubscribe();
  stream.transport.onNotification(
    () => undefined,
    (error) => {
      errors.push(error.message);
    },
  );
  stream.exit(7);
  expect(errors).toEqual(['Codex app-server exited (7)']);
});

it('terminates on stdin failure and preserves the first failure', async () => {
  const stream = makeStreamTransport();
  const pending = stream.transport.request('waiting');
  stream.failStdin(new Error('stdin unavailable'));
  stream.failStdin(new Error('later error'));
  await expect(pending).rejects.toThrow('stdin unavailable');
  await expect(stream.transport.request('after-failure')).rejects.toThrow('stdin unavailable');
  expect(stream.kills()).toBe(1);
});

it.each(['synchronous', 'asynchronous'])(
  'distinguishes %s notification handler errors from protocol errors',
  async (kind) => {
    const stream = makeStreamTransport();
    stream.transport.onNotification(
      () => {
        if (kind === 'asynchronous') return Promise.reject(new Error('sentinel-private-error'));
        throw new Error('sentinel-private-error');
      },
      () => {
        if (kind === 'asynchronous') return Promise.reject(new Error('Failure observer error'));
        throw new Error('Failure observer error must not escape');
      },
    );
    const pending = stream.transport.request('waiting');
    stream.send('{"method":"turn/completed","params":{}}\n');
    await expect(pending).rejects.toThrow('notification handler failed');
    expect(stream.kills()).toBe(1);
    await expect(stream.transport.request('after-failure')).rejects.toThrow(
      'Codex app-server notification handler failed',
    );
  },
);

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

function makeStreamTransport() {
  const stdout = new PassThrough();
  let kills = 0;
  const child = Object.assign(new EventEmitter(), {
    stdout,
    stdin: new PassThrough(),
    stderr: new PassThrough(),
    kill: () => {
      kills += 1;
      return true;
    },
  });
  const transport = new CodexTransport(child as unknown as ChildProcessWithoutNullStreams, 500);
  return {
    transport,
    send: (chunk: string) => stdout.write(chunk),
    exit: (code: number) => child.emit('exit', code, null),
    failStdin: (error: Error) => child.stdin.emit('error', error),
    kills: () => kills,
  };
}

it('starts the actual child in the explicitly assigned directory', async () => {
  const launchChild: SpawnCodexChild = (_file, _args, options) => {
    expect(options.cwd).toBe('/private/tmp');
    return spawn(
      process.execPath,
      [
        '-e',
        `process.stdin.once('data', chunk => {
      const message = JSON.parse(chunk.toString());
      process.stdout.write(JSON.stringify({id:message.id,result:{userAgent:'fixture',codexHome:process.cwd()}})+'\\n');
    });`,
      ],
      options,
    );
  };
  const transport = await CodexTransport.launch('/bundled/codex', 500, launchChild, {
    cwd: '/private/tmp',
  });
  expect(transport.initializeMetadata?.codexHome).toBe('/private/tmp');
  transport.close();
});

it('kills the actual initializing child promptly when launch is aborted', async () => {
  const controller = new AbortController();
  let exited: Promise<void> = Promise.resolve();
  const child: SpawnCodexChild = (_file, _args, options) => {
    const actualChild = spawn(process.execPath, ['-e', 'process.stdin.resume();'], options);
    exited = new Promise((resolve) => actualChild.once('exit', () => resolve()));
    return actualChild;
  };
  const before = Date.now();
  const opening = CodexTransport.launch('/fixture/codex', 15000, child, {
    signal: controller.signal,
  });
  controller.abort();
  await expect(opening).rejects.toThrow('closed');
  await exited;
  expect(Date.now() - before).toBeLessThan(1000);
});
