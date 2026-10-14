import { realpathSync, statSync } from 'node:fs';
import type { AgentSpec, ResourceClaim } from '../contracts/workflow.js';

export function requireWriterLease(spec: AgentSpec, claims: ResourceClaim[]): void {
  if (
    spec.capability === 'workspace-write' &&
    !claims.some((claim) => claim.mode === 'write' && claim.path === spec.assignment.ownership.cwd)
  )
    throw new Error('Writer requires a write lease for its canonical worktree root');
}

export function snapshotClaims(claims: ResourceClaim[]): ResourceClaim[] {
  return claims
    .map((claim) => {
      if (!claim.path) return { ...claim };
      const path = realpathSync(claim.path);
      const { dev, ino } = statSync(path);
      if (claim.identity && (claim.identity.dev !== dev || claim.identity.ino !== ino)) {
        throw new Error(`Resource identity changed: ${claim.key}`);
      }
      return { ...claim, path, identity: { dev, ino } };
    })
    .sort((left, right) => left.key.localeCompare(right.key));
}

function keys(claim: ResourceClaim): string[] {
  const result = [`key:${claim.key}`];
  if (claim.path) result.push(`path:${claim.path}`);
  if (claim.identity) result.push(`inode:${claim.identity.dev}:${claim.identity.ino}`);
  return result;
}

export class Resources {
  private readonly held = new Map<string, ResourceClaim[]>();
  acquire(id: string, claims: ResourceClaim[]): boolean {
    this.validate(claims);
    if (!this.available(id, claims)) return false;
    this.held.set(id, claims);
    return true;
  }
  available(id: string, claims: ResourceClaim[]): boolean {
    for (const [holder, existing] of this.held) {
      if (holder === id) continue;
      if (claims.some((claim) => existing.some((other) => this.conflicts(claim, other))))
        return false;
    }
    return true;
  }
  quarantine(id: string, claims: ResourceClaim[]): void {
    this.held.set(id, claims);
  }
  release(id: string): void {
    this.held.delete(id);
  }
  private conflicts(left: ResourceClaim, right: ResourceClaim): boolean {
    if (left.mode === 'read' && right.mode === 'read') return false;
    return keys(left).some((key) => keys(right).includes(key));
  }
  private validate(claims: ResourceClaim[]): void {
    for (const claim of claims) {
      if (!claim.path) continue;
      const identity = statSync(claim.path);
      if (
        realpathSync(claim.path) !== claim.path ||
        identity.dev !== claim.identity?.dev ||
        identity.ino !== claim.identity.ino
      )
        throw new Error(`Resource disappeared or was replaced: ${claim.key}`);
    }
  }
}
