import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { CodexDiagnostics } from './diagnostics.js';
import { closeOnAbort } from './worker-protocol.js';
import packageMetadata from '../../package.json' with { type: 'json' };
import type { InitializeParams } from './generated/InitializeParams.js';
import type { InitializeResponse } from './generated/InitializeResponse.js';
import type { ServerNotification } from './generated/ServerNotification.js';
import type { ServerRequest } from './generated/ServerRequest.js';

export type SpawnCodexChild = (
  executable: string,
  args: string[],
  options: { stdio: ['pipe', 'pipe', 'pipe']; cwd?: string; env?: NodeJS.ProcessEnv },
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
type NotificationHandler = (notification: ServerNotification) => void | Promise<void>;
type FailureHandler = (error: Error) => void | Promise<void>;
type Subscription = {
  receive: NotificationHandler;
  fail?: FailureHandler;
};
type RpcMessage = JsonRpcReply | ServerRequest | ServerNotification;

export interface CodexLaunchOptions {
  signal?: AbortSignal;
  configOverrides?: readonly string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export class CodexTransport {
  private static readonly maximumLineBytes = 1_048_576;
  private readonly pending = new Map<string | number, Pending>();
  private readonly subscriptions = new Set<Subscription>();
  private readonly diagnostics = new CodexDiagnostics();
  private buffer = '';
  private nextId = 0;
  private closed = false;
  private terminalError: Error | null = null;
  private initializedMetadata: Readonly<InitializeResponse> | null = null;

  constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly timeoutMs = 15_000,
  ) {
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.consume(chunk));
    child.on('error', (error) => this.terminate(error));
    child.on('exit', (code, signal) =>
      this.failAll(new Error(`Codex app-server exited (${code ?? signal ?? 'unknown'})`)),
    );
    child.stdin.on('error', (error) => this.terminate(error));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => this.diagnostics.append(chunk));
  }

  static async launch(
    executable: string,
    timeoutMs = 15_000,
    spawnChild: SpawnCodexChild = (file, args, options) => spawn(file, args, options),
    options: CodexLaunchOptions = {},
  ): Promise<CodexTransport> {
    options.signal?.throwIfAborted();
    const overrides = (options.configOverrides ?? []).flatMap((value) => ['-c', value]);
    const child = spawnChild(executable, ['app-server', '--listen', 'stdio://', ...overrides], {
      stdio: ['pipe', 'pipe', 'pipe'],
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.env === undefined ? {} : { env: options.env }),
    });
    const transport = new CodexTransport(child, timeoutMs);
    const detach = closeOnAbort(transport, options.signal);
    try {
      await transport.initialize();
      return transport;
    } finally {
      detach();
    }
  }

  async initialize(): Promise<InitializeResponse> {
    const params: InitializeParams = {
      clientInfo: {
        name: 'ultra-code-for-codex',
        title: 'Ultra Code for Codex',
        version: packageMetadata.version,
      },
      capabilities: { experimentalApi: true, requestAttestation: false },
    };
    try {
      const response = await this.request<InitializeResponse>('initialize', params);
      this.notify('initialized');
      this.initializedMetadata = Object.freeze({ ...response });
      return response;
    } catch (error) {
      this.close();
      throw this.diagnostics.annotate(
        error instanceof Error ? error : new Error('Codex initialization failed'),
      );
    }
  }

  get initializeMetadata(): Readonly<InitializeResponse> | null {
    return this.initializedMetadata;
  }

  onNotification(receive: NotificationHandler, fail?: FailureHandler): () => void {
    if (this.closed) throw this.terminalError ?? new Error('Codex app-server is closed');
    const subscription: Subscription = { receive, ...(fail ? { fail } : {}) };
    this.subscriptions.add(subscription);
    return () => this.subscriptions.delete(subscription);
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
    if (!this.closed) this.terminate(new Error('Codex app-server was closed'));
  }

  private consume(chunk: string): void {
    if (this.closed) return;
    this.buffer += chunk;
    if (
      Buffer.byteLength(this.buffer) > CodexTransport.maximumLineBytes &&
      !this.buffer.includes('\n')
    ) {
      this.terminate(new Error('Codex app-server sent an oversized JSON-RPC message'));
      return;
    }
    let end = this.buffer.indexOf('\n');
    while (end !== -1) {
      const line = this.buffer.slice(0, end).trim();
      this.buffer = this.buffer.slice(end + 1);
      if (Buffer.byteLength(line) > CodexTransport.maximumLineBytes) {
        this.terminate(new Error('Codex app-server sent an oversized JSON-RPC message'));
        return;
      }
      if (line && !this.consumeLine(line)) return;
      end = this.buffer.indexOf('\n');
    }
    if (Buffer.byteLength(this.buffer) > CodexTransport.maximumLineBytes) {
      this.terminate(new Error('Codex app-server sent an oversized JSON-RPC message'));
    }
  }

  private consumeLine(line: string): boolean {
    let message: RpcMessage;
    try {
      const value: unknown = JSON.parse(line);
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error('Invalid JSON-RPC object');
      }
      message = value as RpcMessage;
    } catch {
      this.terminate(new Error('Codex app-server sent malformed JSON-RPC data'));
      return false;
    }
    this.receive(message);
    return !this.closed;
  }

  private receive(message: RpcMessage): void {
    if ('method' in message && 'id' in message) {
      this.write({
        jsonrpc: '2.0',
        id: message.id,
        error: { code: -32000, message: 'Restricted worker requests are denied' },
      });
      return;
    }
    if (!('id' in message)) {
      if ('method' in message) this.deliverNotification(message);
      return;
    }
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

  private deliverNotification(message: ServerNotification): void {
    for (const subscription of this.subscriptions) {
      if (this.closed) return;
      try {
        const result = subscription.receive(message);
        if (result) result.catch(() => this.notificationFailed());
      } catch {
        this.notificationFailed();
      }
    }
  }

  private notificationFailed(): void {
    if (!this.closed) {
      this.terminate(new Error('Codex app-server notification handler failed'));
    }
  }

  private write(message: unknown): void {
    if (!this.closed) this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private terminate(error: Error): void {
    if (this.closed) return;
    this.failAll(error);
    this.child.kill();
  }

  private failAll(error: Error): void {
    if (this.closed) return;
    error = this.diagnostics.annotate(error);
    this.closed = true;
    this.terminalError = error;
    this.buffer = '';
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    const subscriptions = [...this.subscriptions];
    this.subscriptions.clear();
    for (const subscription of subscriptions) {
      try {
        const result = subscription.fail?.(error);
        if (result) result.catch(() => undefined);
      } catch {
        // Failure observers cannot replace the original transport failure.
      }
    }
  }
}
