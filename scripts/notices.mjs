import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

export async function thirdPartyNotices(inputs) {
  const roots = new Set(
    inputs.map((path) => path.match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)/)?.[1]).filter(Boolean),
  );
  const notices = [];
  for (const root of [...roots].sort()) {
    const metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    const files = (await readdir(root)).filter((file) =>
      /^(licen[cs]e|copying|notice)(\.|$)/i.test(file),
    );
    if (files.length === 0) throw new Error(`Missing license text for ${metadata.name}`);
    const texts = await Promise.all(files.sort().map((file) => readFile(join(root, file), 'utf8')));
    notices.push(`${metadata.name}@${metadata.version} (${metadata.license})\n${texts.join('\n')}`);
  }
  return `${notices.join('\n\n====================\n\n')}\n`;
}
