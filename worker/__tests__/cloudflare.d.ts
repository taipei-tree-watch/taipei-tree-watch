// Tells the Workers type system which module is the Worker entry point, so
// `exports.default` from "cloudflare:workers" is typed as this Worker.
import type * as WorkerModule from '../src/index.ts';

declare global {
  namespace Cloudflare {
    interface GlobalProps {
      mainModule: typeof WorkerModule;
    }
  }
}
