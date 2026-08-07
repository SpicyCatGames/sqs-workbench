import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Browser-only app: no backend. The build produces plain static files in
// frontend/dist that can be hosted anywhere (GitHub Pages, Cloudflare Pages,
// Netlify, S3, ...). The browser talks to the SQS endpoint directly.
export default defineConfig({
  plugins: [react()],
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
  },
});
