import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { InitializeParams } from './generated/InitializeParams.js';
import type { InitializeResponse } from './generated/InitializeResponse.js';
import type { ServerRequest } from './generated/ServerRequest.js';

export type SpawnCodexChild = (
  executable: string,
  args: string[],
  options: { stdio: ['pipe', 'pipe', 'pipe'] },
) => ChildProcessWithoutNullStreams;

type JsonRpcReply = {
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string };
};
type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};
type RpcError = Error & { code?: number };

export class CodexTransport {
  private static readonly maximumLineBytes = 1_048_576;
  private readonly pending = new Map<string | number, Pending>();
  private buffer = '';
  private nextId = 0;
  private closed = false;
  private terminalError: Error | null = null;

  constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly timeoutMs = 15_000,
  ) {
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.consume(chunk));
    child.on('error', (error) => this.failAll(error));
    child.on('exit', (code, signal) =>
      this.failAll(new Error(`Codex app-server exited (${code ?? signal ?? 'unknown'})`)),
    );
    child.stdin.on('error', (error) => this.failAll(error));
    child.stderr.resume();
  }

  static async launch(
    executable: string,
    timeoutMs = 15_000,
    spawnChild: SpawnCodexChild = (file, args, options) => spawn(file, args, options),
  ): Promise<CodexTransport> {
    const child = spawnChild(executable, ['app-server', '--listen', 'stdio://'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const transport = new CodexTransport(child, timeoutMs);
    await transport.initialize();
    return transport;
  }

  async initialize(): Promise<InitializeResponse> {
    const params: InitializeParams = {
      clientInfo: { name: 'ultra-code-for-codex', title: 'Ultra Code for Codex', version: '0.1.0' },
      capabilities: null,
    };
    try {
      const response = await this.request<InitializeResponse>('initialize', params);
      this.notify('initialized');
      return response;
    } catch (error) {
      this.close();
      throw error;
    }
  }

  request<T>(method: string, params?: unknown): Promise<T> {
    if (this.closed)
      return Promise.reject(this.terminalError ?? new Error('Codex app-server is closed'));
    const id = ++this.nextId;
    const request =
      params === undefined
        ? { jsonrpc: '2.0', id, method }
        : { jsonrpc: '2.0', id, method, params };
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex app-server request timed out: ${method}`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer });
      this.write(request);
    });
  }

  notify(method: string, params?: unknown): void {
    const notification =
      params === undefined ? { jsonrpc: '2.0', method } : { jsonrpc: '2.0', method, params };
    this.write(notification);
  }

  close(): void {
    this.closed = true;
    this.child.kill();
    this.failAll(new Error('Codex app-server was closed'));
  }

  private consume(chunk: string): void {
    this.buffer += chunk;
    if (
      Buffer.byteLength(this.buffer) > CodexTransport.maximumLineBytes &&
      !this.buffer.includes('\n')
    ) {
      this.failAll(new Error('Codex app-server sent an oversized JSON-RPC message'));
      this.child.kill();
      return;
    }
    let end = this.buffer.indexOf('\n');
    while (end !== -1) {
      const line = this.buffer.slice(0, end).trim();
      this.buffer = this.buffer.slice(end + 1);
      if (Buffer.byteLength(line) > CodexTransport.maximumLineBytes) {
        this.failAll(new Error('Codex app-server sent an oversized JSON-RPC message'));
        this.child.kill();
        return;
      }
      if (line) {
        try {
          this.receive(JSON.parse(line) as JsonRpcReply | ServerRequest);
        } catch {
          this.failAll(new Error('Codex app-server sent malformed JSON-RPC data'));
          this.child.kill();
          return;
        }
      }
      end = this.buffer.indexOf('\n');
    }
    if (Buffer.byteLength(this.buffer) > CodexTransport.maximumLineBytes) {
      this.failAll(new Error('Codex app-server sent an oversized JSON-RPC message'));
      this.child.kill();
    }
  }

  private receive(message: JsonRpcReply | ServerRequest): void {
    if ('method' in message && 'id' in message) {
      this.write({
        jsonrpc: '2.0',
        id: message.id,
        error: { code: -32000, message: 'Restricted worker requests are denied' },
      });
      return;
    }
    if (!('id' in message)) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    if (message.error) {
      const error: RpcError = new Error(message.error.message);
      error.code = message.error.code;
      pending.reject(error);
    } else {
      pending.resolve(message.result);
    }
  }

  private write(message: unknown): void {
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private failAll(error: Error): void {
    this.closed = true;
    this.terminalError = error;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
