import type { CodexTransport } from './transport.js';

export type WorkerTransport = Pick<
  CodexTransport,
  'request' | 'onNotification' | 'close' | 'initializeMetadata'
>;

export class WorkerBlocked extends Error {}

export function requireWorker(condition: unknown, message: string): asserts condition {
  if (!condition) throw new WorkerBlocked(message);
}

export async function workerRequest<T>(
  transport: Pick<WorkerTransport, 'request'>,
  method: string,
  params?: unknown,
): Promise<T> {
  try {
    return await transport.request<T>(method, params);
  } catch {
    throw new WorkerBlocked(`Worker backend request failed: ${method}`);
  }
}

export async function workerPages<T>(
  transport: WorkerTransport,
  method: string,
  params: object,
): Promise<T[]> {
  const rows: T[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  for (let page = 0; page < 100; page += 1) {
    const response: { data: T[]; nextCursor: string | null } = await workerRequest<{
      data: T[];
      nextCursor: string | null;
    }>(transport, method, { ...params, cursor, limit: 100 });
    requireWorker(Array.isArray(response.data), 'Worker catalog is unavailable');
    rows.push(...response.data);
    requireWorker(rows.length <= 10_000, 'Worker catalog exceeds verification bound');
    if (response.nextCursor === null) return rows;
    requireWorker(
      typeof response.nextCursor === 'string' &&
        response.nextCursor.length > 0 &&
        !seen.has(response.nextCursor),
      'Worker catalog pagination is incomplete',
    );
    seen.add(response.nextCursor);
    cursor = response.nextCursor;
  }
  throw new WorkerBlocked('Worker catalog exceeds page bound');
}

export function closeOnAbort(
  transport: Pick<WorkerTransport, 'close'>,
  signal?: AbortSignal,
): () => void {
  const abort = () => transport.close();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  return () => signal?.removeEventListener('abort', abort);
}

export function awaitPreflight<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  let abort = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(new WorkerBlocked('Worker cancelled during preflight'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
  return Promise.race([promise, cancelled]).finally(() =>
    signal.removeEventListener('abort', abort),
  );
}
