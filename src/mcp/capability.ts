import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { LeadContext } from '../activation/types.js';
import type { DaemonCall } from '../local/client.js';

const available =
  'Workflow runtime is available. Worker permissions and model availability are verified before each dispatch.';
export const RUNTIME_UNVERIFIED =
  'Local workflow execution is unavailable until the runtime and current-turn context are verified.';

export async function withRuntimeCapability(
  value: CallToolResult,
  runtime?: DaemonCall,
): Promise<CallToolResult> {
  if (!runtime || value.isError) return value;
  try {
    await runtime('health', {});
    return {
      ...value,
      content: value.content.map((item) =>
        item.type === 'text'
          ? {
              ...item,
              text: item.text.replace(RUNTIME_UNVERIFIED, available),
            }
          : item,
      ),
      structuredContent: {
        ...value.structuredContent,
        capabilityAvailability: 'available',
        capabilityReason: available,
      },
    };
  } catch (error) {
    return unavailable(
      value,
      error instanceof Error ? error.message : 'Workflow runtime is unavailable.',
    );
  }
}

export async function withContextCapabilities(
  value: CallToolResult,
  context: LeadContext,
  runtime?: DaemonCall,
): Promise<CallToolResult> {
  if (context.resolutionStatus !== 'verified') {
    return unavailable(value, `Current-turn context is unverified: ${context.resolutionReason}`);
  }
  if (!runtime) return value;
  const available = await withRuntimeCapability(value, runtime);
  if (available.structuredContent?.capabilityAvailability !== 'available') return available;
  try {
    const capabilities = await runtime('capabilities', {
      owner: { instanceId: context.instanceId, sessionId: context.sessionId },
      cwd: context.cwd,
    });
    return {
      ...available,
      structuredContent: { ...available.structuredContent, executionCapabilities: capabilities },
    };
  } catch (error) {
    return unavailable(
      available,
      error instanceof Error ? error.message : 'Worker capability inspection failed',
    );
  }
}

function unavailable(value: CallToolResult, reason: string): CallToolResult {
  return {
    ...value,
    content: [{ type: 'text', text: `Workflow execution is unavailable: ${reason}` }],
    structuredContent: {
      ...value.structuredContent,
      capabilityAvailability: 'unavailable',
      capabilityReason: reason,
    },
  };
}
