import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      './shared/vitest.config.ts',
      './scripts/vitest.config.ts',
      './web/vitest.config.ts',
      './worker/vitest.config.ts',
    ],
  },
});
