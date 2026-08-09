import { defineConfig, type Plugin, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';

// Browser-only app: no backend. The build produces plain static files in
// frontend/dist that can be hosted anywhere (GitHub Pages, Cloudflare Pages,
// Netlify, S3, ...). The browser talks to the AWS endpoint directly.
//
// Local emulators that don't send CORS headers (e.g. fakecloud) can't be
// called straight from the browser, so the dev server proxies /aws/* to the
// emulator and adds the CORS headers the browser requires. While running
// `npm run dev`, point the app's "AWS endpoint URL" setting at
// http://localhost:3000/aws. Override the emulator target with the
// FAKECLOUD_ENDPOINT environment variable if it isn't on http://localhost:4566.
const AWS_EMULATOR_TARGET = (process.env.FAKECLOUD_ENDPOINT ?? 'http://localhost:4566').replace(/\/+$/, '');

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  // Expose AWS response headers (x-amz-meta-*, x-amz-version-id, ...) so the
  // SDK can read them — otherwise S3 object metadata and version ids silently
  // come back empty through the proxy.
  'Access-Control-Expose-Headers': '*',
  'Access-Control-Max-Age': '86400',
};

/** Answer the CORS preflight (OPTIONS) for proxied AWS requests ourselves —
 *  the emulator never sees it, so it can't respond with the right headers. */
function awsCorsPreflight(): Plugin {
  return {
    name: 'aws-cors-preflight',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.method === 'OPTIONS' && (req.url ?? '').startsWith('/aws')) {
          res.writeHead(204, CORS_HEADERS);
          res.end();
          return;
        }
        next();
      });
    },
  };
}

/** Forward /aws/* to the AWS emulator, strip the /aws prefix, and stamp every
 *  response with the CORS headers the browser needs. */
const awsProxy: ProxyOptions = {
  target: AWS_EMULATOR_TARGET,
  changeOrigin: true,
  rewrite: (path) => {
    const rest = path.replace(/^\/aws/, '');
    return rest === '' ? '/' : rest;
  },
  configure(proxy) {
    proxy.on('proxyRes', (proxyRes) => {
      if (proxyRes.headers) Object.assign(proxyRes.headers, CORS_HEADERS);
    });
    proxy.on('error', (err, _req, res) => {
      // When the emulator is unreachable, http-proxy's built-in 500 carries no
      // CORS headers — stamp them on so the browser reports the real error
      // instead of a confusing CORS failure.
      if (!res.headersSent) {
        res.writeHead(502, { ...CORS_HEADERS, 'Content-Type': 'text/plain' });
        res.end(`Dev proxy: cannot reach ${AWS_EMULATOR_TARGET} (${err?.message ?? err}). Is the emulator running?`);
      }
    });
  },
};

export default defineConfig({
  plugins: [react(), awsCorsPreflight()],
  // Relative asset paths so the app works when hosted under a sub-path.
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    // The dev server origin is allowed by the local emulator's CORS config.
    port: 3000,
    proxy: {
      '/aws': awsProxy,
    },
  },
});
