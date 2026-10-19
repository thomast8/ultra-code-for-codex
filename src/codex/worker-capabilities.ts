import { realpath, stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import type { ConfigReadResponse } from './generated/v2/ConfigReadResponse.js';
import type { ConfigRequirementsReadResponse } from './generated/v2/ConfigRequirementsReadResponse.js';
import type { GetAccountResponse } from './generated/v2/GetAccountResponse.js';
import type { GetAccountRateLimitsResponse } from './generated/v2/GetAccountRateLimitsResponse.js';
import type { Model } from './generated/v2/Model.js';
import {
  launchWorkerTransport,
  openRestrictedBackend,
  restrictedWorkerConfig,
  verifyWorkerConfiguration,
  type LaunchWorkerTransport,
} from './launch-policy.js';
import { verifyProcessFeatures } from './permissions.js';
import {
  requireWorker,
  WorkerBlocked,
  workerPages,
  workerRequest,
  type WorkerTransport,
} from './worker-protocol.js';

export type WorkerCapabilities = {
  status: 'verified-metadata' | 'blocked';
  profileVerified: boolean;
  accountType: string | null;
  ordinaryUsageAllowed: boolean | null;
  models: { model: string; reasoningEfforts: string[] }[];
  capacity: { profileWorkerLimit: 3; hostWideAvailableSlots: null };
  blockers: string[];
};

function emptyCapabilities(): WorkerCapabilities {
  return {
    status: 'blocked',
    profileVerified: false,
    accountType: null,
    ordinaryUsageAllowed: null,
    models: [],
    capacity: { profileWorkerLimit: 3, hostWideAvailableSlots: null },
    blockers: [],
  };
}

export function createCapabilitiesReader(launch: LaunchWorkerTransport = launchWorkerTransport) {
  return async (instanceId: string, cwd: string): Promise<WorkerCapabilities> => {
    const result = emptyCapabilities();
    let transport: WorkerTransport | undefined;
    try {
      requireWorker(
        isAbsolute(cwd) && (await realpath(cwd)) === cwd && (await stat(cwd)).isDirectory(),
        'Capability inspection requires a canonical directory',
      );
      transport = await openRestrictedBackend(
        instanceId,
        cwd,
        restrictedWorkerConfig(cwd, 'read-only'),
        launch,
      );
      result.profileVerified = true;
      await readCapabilities(transport, cwd, result);
      result.status = 'verified-metadata';
    } catch (error) {
      result.blockers.push(
        error instanceof WorkerBlocked
          ? error.message
          : 'Worker capability metadata could not be verified',
      );
    } finally {
      transport?.close();
    }
    return result;
  };
}

async function readCapabilities(
  transport: WorkerTransport,
  cwd: string,
  result: WorkerCapabilities,
): Promise<void> {
  const [account, requirements, usage, config, models] = await Promise.all([
    workerRequest<GetAccountResponse>(transport, 'account/read', {}),
    workerRequest<ConfigRequirementsReadResponse>(transport, 'configRequirements/read', {}),
    workerRequest<GetAccountRateLimitsResponse>(transport, 'account/rateLimits/read', {
      excludeResetCreditDetails: true,
    }),
    workerRequest<ConfigReadResponse>(transport, 'config/read', { cwd, includeLayers: false }),
    workerPages<Model>(transport, 'model/list', { includeHidden: false }),
  ]);
  result.accountType = account.account?.type ?? null;
  result.ordinaryUsageAllowed =
    typeof usage.ordinaryUsageAllowed === 'boolean' ? usage.ordinaryUsageAllowed : null;
  result.models = models.map(safeModel);
  requireWorker(result.accountType === 'chatgpt', 'Worker requires the active ChatGPT account');
  requireWorker(
    requirements.requirements === null,
    'Managed requirements require separate verification',
  );
  requireWorker(
    result.ordinaryUsageAllowed === true,
    'Ordinary included usage is not verified available',
  );
  verifyWorkerConfiguration(config, 'read-only');
  await verifyProcessFeatures(transport);
}

function safeModel(model: Model): WorkerCapabilities['models'][number] {
  requireWorker(
    typeof model.model === 'string' && model.model.length > 0 && model.model.length <= 512,
    'Worker model catalog contains an invalid identifier',
  );
  requireWorker(
    Array.isArray(model.supportedReasoningEfforts),
    'Worker reasoning-effort catalog is unavailable',
  );
  const reasoningEfforts = model.supportedReasoningEfforts.map((entry) => entry.reasoningEffort);
  requireWorker(
    reasoningEfforts.every(
      (effort) => typeof effort === 'string' && effort.length > 0 && effort.length <= 128,
    ),
    'Worker reasoning-effort catalog contains an invalid identifier',
  );
  return { model: model.model, reasoningEfforts };
}

export const readWorkerCapabilities = createCapabilitiesReader();
