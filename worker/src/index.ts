/**
 * Cloudflare Worker entry point.
 *
 * `fetch` serves the JSON API under /api/* and hands every other request to the
 * static assets binding. `scheduled` runs on the cron trigger in wrangler.toml
 * and will build the KV snapshot.
 */

export interface Env {
  /** D1 database holding the `reports` table. */
  DB: D1Database;
  /** KV namespace holding `snapshot:latest`, `snapshot:<ts>` and `snapshot:index`. */
  SNAPSHOTS: KVNamespace;
  /** Static assets built from web/ into web/dist. */
  ASSETS: Fetcher;

  /** Public Turnstile site key rendered into the report form. */
  TURNSTILE_SITE_KEY: string;
  /** Accepted coordinate range as "minLng,minLat,maxLng,maxLat". */
  BBOX: string;

  /** Secret: Turnstile server-side verification key. */
  TURNSTILE_SECRET_KEY: string;
  /** Secret: salt prepended to the client IP before hashing into `reporter_hash`. */
  REPORTER_SALT: string;
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/api/health') {
      return Response.json({ ok: true });
    }

    return env.ASSETS.fetch(request);
  },

  async scheduled(controller): Promise<void> {
    console.log(
      `scheduled: cron=${controller.cron} at=${new Date(controller.scheduledTime).toISOString()}`,
    );
  },
} satisfies ExportedHandler<Env>;
