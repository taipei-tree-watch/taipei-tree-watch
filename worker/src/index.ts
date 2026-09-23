/**
 * Cloudflare Worker entry point.
 *
 * `fetch` serves the JSON API under /api/* and hands every other request to the
 * static assets binding. `scheduled` runs on the cron trigger in wrangler.toml
 * and rebuilds the KV snapshot.
 */
import { isReportId } from '../../shared/validation.ts';
import {
  handleReadReport,
  handleUpdateReport,
  handleWithdrawReport,
} from './routes/report-edit.ts';
import { handleCreateReport } from './routes/reports.ts';
import { runSnapshotCron } from './snapshot/cron.ts';
import { handleSnapshotRequest } from './snapshot/route.ts';

export interface Env {
  /** D1 database holding the `reports` table. */
  DB: D1Database;
  /** KV namespace holding `snapshot:latest`, `snapshot:<ts>` and `snapshot:index`. */
  SNAPSHOTS: KVNamespace;
  /** Static assets built from web/ into web/dist. */
  ASSETS: Fetcher;

  /** Public Turnstile site key rendered into the report form. */
  TURNSTILE_SITE_KEY: string;
  /**
   * Hostname the Turnstile widget is expected to be served from. Absent or
   * empty turns the comparison off.
   */
  TURNSTILE_HOSTNAME?: string;
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

    if (request.method === 'POST' && url.pathname === '/api/reports') {
      return handleCreateReport(request, env);
    }

    const reportPath = /^\/api\/reports\/([^/]+)$/.exec(url.pathname);
    if (reportPath !== null) {
      const id = reportPath[1] ?? '';
      if (!isReportId(id)) {
        return Response.json(
          { errors: [{ field: 'id', message: 'Unknown report' }] },
          { status: 404 },
        );
      }
      if (request.method === 'GET') {
        return handleReadReport(request, env, id);
      }
      if (request.method === 'PUT') {
        return handleUpdateReport(request, env, id);
      }
      if (request.method === 'DELETE') {
        return handleWithdrawReport(request, env, id);
      }
      return new Response(null, { status: 405, headers: { allow: 'GET, PUT, DELETE' } });
    }

    if (request.method === 'GET' && url.pathname === '/api/snapshot') {
      return handleSnapshotRequest(request, env.SNAPSHOTS);
    }

    return env.ASSETS.fetch(request);
  },

  async scheduled(controller, env): Promise<void> {
    await runSnapshotCron(env, new Date(controller.scheduledTime));
  },
} satisfies ExportedHandler<Env>;
