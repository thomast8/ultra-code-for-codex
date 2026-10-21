import type { ThreadItemsListResponse } from './generated/v2/ThreadItemsListResponse.js';
import {
  openRestrictedBackend,
  restrictedWorkerConfig,
  launchWorkerTransport,
} from './launch-policy.js';
import { workerRequest } from './worker-protocol.js';

export async function readWorkerHistory(
  instanceId: string,
  cwd: string,
  threadId: string,
  cursor?: string,
) {
  const transport = await openRestrictedBackend(
    instanceId,
    cwd,
    restrictedWorkerConfig(cwd, 'read-only'),
    launchWorkerTransport,
  );
  try {
    const page = await workerRequest<ThreadItemsListResponse>(transport, 'thread/items/list', {
      threadId,
      cursor: cursor ?? null,
      limit: 10,
      sortDirection: 'desc',
    });
    return {
      threadId,
      note: 'Items are this worker\'s own command and message history. A non-zero exit, empty output or denied command here is local to the worker and is not a workflow execution or dispatch failure; the worker keeps going and its result arrives through ultra_status. Workflow failure is only ultra_status state "failed".',
      order: 'newest-first',
      nextCursor: page.nextCursor,
      items: page.data.map((entry) => {
        const serialized = JSON.stringify(entry);
        return { preview: serialized.slice(0, 32_768), truncated: serialized.length > 32_768 };
      }),
    };
  } finally {
    transport.close();
  }
}
