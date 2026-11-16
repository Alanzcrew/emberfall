// EMBERFALL v2 — static server for game/ (dev + screenshot harness only).
// Serves the game directory on http://localhost:8080 by default, with a MIME
// map, a path-traversal guard, and 404s for anything outside game/.
// Run: `node serve.ts [--port 8080]`. Node 22 stdlib only.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(join(here, 'game'));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function portFromArgs() {
  const idx = process.argv.indexOf('--port');
  if (idx >= 0 && process.argv[idx + 1]) {
    const n = Number(process.argv[idx + 1]);
    if (Number.isFinite(n) && n > 0 && n < 65536) return n;
  }
  return 8080;
}

const port = portFromArgs();

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    let path = decodeURIComponent(url.pathname);
    if (path === '/') path = '/index.html';
    const file = resolve(join(root, normalize(path).replace(/^(\.\.[/\\])+/, '')));
    // Path-traversal guard: the resolved file must stay under game/.
    if (!file.startsWith(root + '/') && file !== root) {
      res.writeHead(403, { 'content-type': 'text/plain' });
      res.end('forbidden');
      return;
    }
    if (!existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
      return;
    }
    const ext = file.slice(file.lastIndexOf('.')).toLowerCase();
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'content-length': body.length,
      // Dev server: never cache, so screenshot runs always see fresh code.
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch (err) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('server error');
  }
});

server.listen(port, () => {
  console.log(`EMBERFALL v2 serving game/ on http://localhost:${port}/`);
});
