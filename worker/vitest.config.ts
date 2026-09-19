import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

// The test D1 database starts empty, so the same migrations wrangler applies to
// the real database are read here and handed to the runtime as a binding.
const migrations = await readD1Migrations(
  join(dirname(fileURLToPath(import.meta.url)), '../migrations'),
);

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: '../wrangler.toml' },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: migrations,
          // Stand-ins for the production secrets set with `wrangler secret put`.
          TURNSTILE_SECRET_KEY: 'test-turnstile-secret',
          REPORTER_SALT: 'test-reporter-salt',
        },
      },
    }),
  ],
  test: {
    name: 'worker',
    include: ['__tests__/**/*.test.ts'],
    setupFiles: ['./__tests__/apply-migrations.ts'],
  },
});
