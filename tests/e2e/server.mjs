// Tiny static server for the SDK's browser tests: a bare page, the built script-tag bundle and a few paywall JSON files.
// Nothing here is a demo: it only gives the tests a real page to run the SDK on.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const dist = resolve(root, '../../dist');
const port = Number(process.env.PORT ?? 3006);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json' };

createServer(async (req, res) => {
  const path = new URL(req.url ?? '/', 'http://localhost').pathname;
  const file = path === '/ui-kit.iife.js' ? join(dist, 'ui-kit.iife.js') : join(root, 'site', path === '/' ? 'index.html' : normalize(path));
  try {
    if (!file.startsWith(root) && !file.startsWith(dist)) throw new Error('outside');
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' }).end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(port, () => console.log(`SDK test page on http://localhost:${port}`));
