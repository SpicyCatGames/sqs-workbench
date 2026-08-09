#!/usr/bin/env node
/**
 * Tiny CORS bridge for AWS emulators that don't send CORS headers themselves
 * (fakecloud, stock floci, ElasticMQ). Browsers require `Access-Control-Allow-*`
 * response headers before they will let a hosted page talk to a local emulator.
 *
 * Usage:
 *   TARGET=http://localhost:4566 PORT=4567 node cors-proxy.mjs
 *
 * Then point the workbench's "AWS endpoint URL" setting at
 * http://localhost:4567 — the bridge forwards every request to the emulator
 * and adds the CORS headers the browser needs.
 */
import { createServer } from 'node:http';

const TARGET = (process.env.TARGET ?? 'http://localhost:4566').replace(/\/+$/, '');
const PORT = Number(process.env.PORT ?? 4567);
const TIMEOUT_MS = 35_000;

// The AWS SDK v3 sends amz-sdk-* and x-amz-* request headers that vary between
// services and SDK versions. Allow any header — this is a localhost-only
// bridge, so the wildcard is safe and future-proof.
const ALLOW_HEADERS = '*';

createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', ALLOW_HEADERS);
  // Expose AWS response headers (x-amz-meta-*, x-amz-version-id, ...) so the
  // SDK can read them through the bridge.
  res.setHeader('Access-Control-Expose-Headers', '*');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const headers = { ...req.headers };
    // Let undici derive Host / Content-Length from the upstream URL and body,
    // and never ask for a compressed response (we forward the body verbatim).
    delete headers.host;
    delete headers['content-length'];
    delete headers['connection'];
    delete headers['accept-encoding'];

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    fetch(new URL(req.url ?? '/', TARGET), {
      method: req.method,
      headers,
      body: body.length > 0 ? body : undefined,
      signal: controller.signal,
    })
      .then(async (upstreamRes) => {
        // Convert the WHATWG Headers to a plain object and normalize fields that
        // describe the (possibly compressed) upstream body — we write a plain
        // buffered body, so content-length must describe what we actually send.
        const text = await upstreamRes.text();
        const upstreamHeaders = Object.fromEntries(upstreamRes.headers.entries());
        delete upstreamHeaders['content-encoding'];
        delete upstreamHeaders['transfer-encoding'];
        upstreamHeaders['content-length'] = String(Buffer.byteLength(text));
        if (res.headersSent) {
          res.destroy(); // the client already went away — nothing more to write
          return;
        }
        res.writeHead(upstreamRes.status, upstreamHeaders);
        res.end(text);
      })
      .catch((err) => {
        if (res.headersSent) return; // response already started — too late to recover
        const status = err?.name === 'AbortError' ? 504 : 502;
        res.writeHead(status, { 'Content-Type': 'text/plain' });
        res.end(`CORS bridge: cannot reach ${TARGET} (${err?.message ?? err}). Is the emulator running?`);
      })
      .finally(() => clearTimeout(timer));
  });
}).listen(PORT, () => {
  console.log(`CORS bridge listening on http://localhost:${PORT} -> ${TARGET}`);
});
