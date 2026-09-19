import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: '../wrangler.toml' } })],
  test: {
    name: 'worker',
    include: ['__tests__/**/*.test.ts'],
  },
});
