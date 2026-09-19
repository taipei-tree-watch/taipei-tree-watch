// Tells the Workers type system which module is the Worker entry point, so
// `exports.default` from "cloudflare:workers" is typed as this Worker.
import type { D1Migration } from 'cloudflare:test';

import type * as WorkerModule from '../src/index.ts';

declare global {
  namespace Cloudflare {
    interface GlobalProps {
      mainModule: typeof WorkerModule;
    }

    // The bindings from wrangler.toml, plus the migrations the pool injects for
    // tests to apply with `applyD1Migrations`.
    interface Env extends WorkerModule.Env {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
