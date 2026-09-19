// Tells the Workers type system which module is the Worker entry point, so
// `exports.default` from "cloudflare:workers" is typed as this Worker.
import type { D1Migration } from 'cloudflare:test';

import type * as WorkerModule from '../src/index.ts';

declare global {
  namespace Cloudflare {
    interface GlobalProps {
      mainModule: typeof WorkerModule;
    }

    interface Env extends WorkerModule.Env {
      /** Migrations read by worker/vitest.config.ts and applied before tests. */
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
