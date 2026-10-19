import { realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { z } from 'zod';

export const filesystemAuthoritySchema = z.object({
  readAll: z.literal(true),
  writableRoots: z.array(z.string().min(1).refine(isAbsolute)),
});
const pathSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('path'), path: z.string().refine(isAbsolute) }),
  z.object({
    type: z.literal('special'),
    value: z.object({ kind: z.enum(['root', 'tmpdir', 'slash_tmp']) }),
  }),
]);
const policySchema = z.object({
  kind: z.literal('restricted'),
  entries: z.array(z.object({ path: pathSchema, access: z.enum(['read', 'write', 'deny']) })),
});

function canonical(path: string): string {
  try {
    return realpathSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || dirname(path) === path) throw error;
    return join(canonical(dirname(path)), basename(path));
  }
}

function protectedByWorker(root: string, path: string): boolean {
  const part = relative(root, path);
  if (part === '..' || part.startsWith(`..${sep}`) || isAbsolute(part)) return true;
  // The verified workspace-write backend protects these directories itself.
  return ['.git', '.agents', '.codex', '.aws'].includes(part.split(sep)[0]!);
}

export function filesystemAuthority(
  value: unknown,
): z.infer<typeof filesystemAuthoritySchema> | undefined {
  const parsed = policySchema.safeParse(value);
  if (!parsed.success) return undefined;
  const entries = parsed.data.entries;
  if (entries.some((entry) => entry.access === 'deny')) return undefined;
  const rootRead = entries.some(
    (entry) => entry.path.type === 'special' && entry.path.value.kind === 'root',
  );
  if (!rootRead) return undefined;
  let paths;
  try {
    paths = entries.flatMap((entry) =>
      entry.path.type === 'path'
        ? [{ path: canonical(entry.path.path), access: entry.access }]
        : [],
    );
  } catch {
    return undefined;
  }
  const writableRoots = paths
    .filter((entry) => entry.access === 'write')
    .map((entry) => entry.path)
    .filter((root) =>
      paths.every((entry) => entry.access === 'write' || protectedByWorker(root, entry.path)),
    );
  return { readAll: true, writableRoots: [...new Set(writableRoots)].sort() };
}
