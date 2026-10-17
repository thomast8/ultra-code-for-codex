export const NODE_RUNTIME_REQUIRED = 'Node 26.10.0 or 26.12.0 is required';

export function verifyNodeRuntime(version = process.versions.node): void {
  if (!['26.10.0', '26.12.0'].includes(version)) throw new Error(NODE_RUNTIME_REQUIRED);
}
