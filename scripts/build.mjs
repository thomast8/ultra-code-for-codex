import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { build } from 'esbuild';
import './check-runtime.mjs';
import { thirdPartyNotices } from './notices.mjs';

const output = new URL('../plugin/dist/', import.meta.url);
await mkdir(output, { recursive: true });
const ui = await build({
  metafile: true,
  entryPoints: ['src/ui/panel.tsx'],
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  minify: true,
  loader: { '.png': 'dataurl', '.svg': 'dataurl' },
});
const javascript = ui.outputFiles[0].text.replaceAll('</script', '<\\/script');
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ultra Code</title></head><body><div id="root"></div><script>${javascript}</script></body></html>`;
await writeFile(new URL('panel.html', output), html);
const mcp = await build({
  metafile: true,
  entryPoints: ['src/mcp/entry.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node26',
  outfile: new URL('mcp-entry.js', output).pathname,
  loader: { '.png': 'dataurl' },
});

const hookEntry = new URL('../src/activation/hook-entry.ts', import.meta.url);
await readFile(hookEntry);
const hook = await build({
  metafile: true,
  entryPoints: [hookEntry.pathname],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node26',
  outfile: new URL('hook-entry.js', output).pathname,
});

const daemon = await build({
  metafile: true,
  entryPoints: ['src/daemon-entry.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node26',
  banner: {
    js: "import { createRequire as ultraRequire } from 'node:module'; const require = ultraRequire(import.meta.url);",
  },
  outfile: new URL('daemon-entry.js', output).pathname,
});
await copyFile(
  new URL(
    '../node_modules/@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.wasm',
    import.meta.url,
  ),
  new URL('quickjs.wasm', output),
);
await writeFile(
  new URL('THIRD_PARTY_NOTICES.txt', output),
  await thirdPartyNotices(
    [ui, mcp, hook, daemon].flatMap((result) => Object.keys(result.metafile.inputs)),
  ),
);
