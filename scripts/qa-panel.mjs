// Serves the built panel inside a fixture host for browser QA. Nothing here talks
// to Codex, the daemon or a model; every run shown is labelled fixture data.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { build } from 'esbuild';
import './build.mjs';

const port = Number(process.argv[2] ?? process.env.QA_PORT ?? 8765);
const panel = await readFile(new URL('../plugin/dist/panel.html', import.meta.url), 'utf8');
const host = await build({
  entryPoints: ['test/panel-qa-host.ts'],
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
});
const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Ultra panel QA (fixture)</title>
<style>body{margin:0;padding:16px;display:flex;justify-content:center;background:#8a8a8e}
body.dark{background:#111}iframe{height:2400px;border:0;background:transparent}</style></head>
<body><iframe title="Ultra panel"></iframe>
<script>document.body.classList.toggle('dark', new URLSearchParams(location.search).get('theme') === 'dark')</script>
<script src="host.js"></script></body></html>`;
const routes = {
  '/': ['text/html', page],
  '/panel.html': ['text/html', panel],
  '/host.js': ['text/javascript', host.outputFiles[0].text],
};

createServer((request, response) => {
  const route = routes[new URL(request.url ?? '/', 'http://localhost').pathname];
  response.writeHead(route ? 200 : 404, { 'content-type': route?.[0] ?? 'text/plain' });
  response.end(route?.[1] ?? 'Not found');
}).listen(port, '127.0.0.1', () => {
  const base = `http://127.0.0.1:${port}/`;
  console.log(`Ultra panel QA host (fixture data): ${base}`);
  console.log(`  dark theme:          ${base}?theme=dark`);
  console.log(`  wide panel:          ${base}?width=720`);
  console.log(`  loud host variables: ${base}?vars`);
});
