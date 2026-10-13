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
