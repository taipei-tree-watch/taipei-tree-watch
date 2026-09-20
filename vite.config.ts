import { defineConfig } from 'vite';

import { readWranglerVar } from './scripts/wrangler-vars.ts';

export default defineConfig({
  root: 'web',
  // The Turnstile site key is public, and wrangler.toml is where the Worker
  // reads it from, so the frontend build takes it from the same place instead
  // of a separate environment variable that could drift.
  define: {
    'import.meta.env.VITE_TURNSTILE_SITE_KEY': JSON.stringify(
      readWranglerVar('TURNSTILE_SITE_KEY'),
    ),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  // MapLibre starts its worker with { type: 'module' }, so the emitted worker
  // bundle has to be an ES module rather than the default IIFE.
  worker: {
    format: 'es',
  },
});
