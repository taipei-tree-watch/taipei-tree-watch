// Creates the `reports` table before any test runs. Storage is isolated per
// test file, so this runs once per file and leaves no rows behind.
import { applyD1Migrations, env } from 'cloudflare:test';

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
