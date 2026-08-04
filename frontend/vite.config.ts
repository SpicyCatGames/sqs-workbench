import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// Default: publish the built SPA into Api/wwwroot so the .NET API can serve it.
// Docker builds can override with VITE_OUT_DIR=dist.
const outDir = process.env.VITE_OUT_DIR
  ? resolve(process.env.VITE_OUT_DIR)
  : resolve(fileURLToPath(new URL('.', import.meta.url)), '../Api/wwwroot');

export default defineConfig({
  plugins: [react()],
  build: {
    outDir,
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:5072',
    },
  },
});
