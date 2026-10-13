import { createHash, randomBytes } from 'node:crypto';
import {
  lstatSync,
  linkSync,
  unlinkSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

export type Endpoint = { socketPath: string; token: string; dataDir: string };

function privateDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new Error('Ultra Code runtime directory must be private');
  }
  if (process.getuid && stat.uid !== process.getuid()) {
    throw new Error('Ultra Code runtime directory belongs to another user');
  }
}

function privateToken(path: string): string {
  const temporary = `${path}.${process.pid}.${randomBytes(8).toString('hex')}`;
  writeFileSync(temporary, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
  try {
    linkSync(temporary, path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  } finally {
    unlinkSync(temporary);
  }
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new Error('Ultra Code runtime credential must be private');
  }
  if (process.getuid && stat.uid !== process.getuid())
    throw new Error('Ultra Code runtime credential belongs to another user');
  const token = readFileSync(path, 'utf8');
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Invalid Ultra Code runtime credential');
  return token;
}

export function localEndpoint(dataDir: string): Endpoint {
  if (resolve(dataDir) !== dataDir) throw new Error('Absolute plugin data directory required');
  const canonical = realpathSync(dataDir);
  const runtime = join(canonical, 'runtime');
  privateDirectory(runtime);
  const digest = createHash('sha256').update(canonical).digest('hex').slice(0, 20);
  const socketDir = `/private/tmp/ultra-code-${process.getuid?.() ?? 'local'}-${digest}`;
  privateDirectory(socketDir);
  return {
    socketPath: join(socketDir, 'daemon.sock'),
    token: privateToken(join(runtime, 'daemon.key')),
    dataDir: canonical,
  };
}
