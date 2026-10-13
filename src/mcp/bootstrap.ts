import { isAbsolute, resolve } from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { resolveCurrentContext } from '../activation/registry.js';
import { createDaemonClient } from '../local/client.js';
import { createPanelServer, type ContextResolver, type PanelHtmlLoader } from './panel-server.js';

export function pluginDataDirectory(environment: NodeJS.ProcessEnv): string {
  const primary = environment.CODEX_PLUGIN_DATA;
  const compatible = environment.PLUGIN_DATA;
  if (primary && compatible && primary !== compatible) {
    throw new Error('Plugin data directories conflict.');
  }
  const dataDir = primary ?? compatible;
  if (!dataDir || !isAbsolute(dataDir) || dataDir.includes('${') || resolve(dataDir) !== dataDir) {
    throw new Error('An absolute, resolved plugin data directory is required.');
  }
  return dataDir;
}

export async function startPanel(
  environment: NodeJS.ProcessEnv,
  transport: Transport = new StdioServerTransport(),
  resolver: ContextResolver = resolveCurrentContext,
  loadPanelHtml?: PanelHtmlLoader,
) {
  const dataDir = pluginDataDirectory(environment);
  const server = createPanelServer(resolver, dataDir, loadPanelHtml, createDaemonClient(dataDir));
  await server.connect(transport);
  return server;
}
