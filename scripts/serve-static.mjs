#!/usr/bin/env node
/**
 * Tiny zero-dependency static file server for the built workbench.
 *
 * The app uses hash-based routing, so no SPA fallback / rewrite rules are
 * needed — any static file server works, this one is bundled for convenience.
 *
 * Usage:
 *   node scripts/serve-static.mjs [port] [dir]
 *   PORT=8080 node scripts/serve-static.mjs        # same as above
 *
 * Defaults: port 8080, dir frontend/dist. E.g. serve on the origin floci
 * already allows (http://localhost:3000):
 *   node scripts/serve-static.mjs 3000
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT ?? process.argv[2] ?? 8080);
const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const root = resolve(repoRoot, process.argv[3] ?? 'frontend/dist');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.map': 'application/json',
  '.woff2': 'font/woff2',
};

createServer((req, res) => {
  // Reject path traversal — only serve files inside the build directory.
  const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
  let filePath = normalize(join(root, pathname));
  if (!filePath.startsWith(root)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  if (existsSync(filePath) && statSync(filePath).isDirectory()) {
    filePath = join(filePath, 'index.html');
  }

  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }

  res.writeHead(200, {
    'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream',
    'Cache-Control': extname(filePath) === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
  });
  createReadStream(filePath).pipe(res);
}).listen(PORT, () => {
  console.log(`Static server: http://localhost:${PORT} -> ${root}`);
});
