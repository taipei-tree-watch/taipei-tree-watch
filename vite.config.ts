import { defineConfig } from 'vite';

export default defineConfig({
  root: 'web',
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
