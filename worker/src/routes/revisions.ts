/**
 * POST /api/reports/<id>/revisions: anyone may correct a user report.
 *
 * Runs the checks of TECH-SPEC 6.1 in order. The correction is stored as a
 * new row and takes effect at the next cron; the report row itself is never
 * rewritten, so every correction can be reverted on its own.
 *
 * Responses: 201 {id} on success, 400 {errors} for a rejected field, 403 for
 * a failed Turnstile verification, 404 when the report is not a visible user
 * report, 409 when someone else corrected it since the sender loaded it, 413
 * for an oversized body.
 */
import type { Env } from '../index.ts';
import type { CorrectableValues } from '../../../shared/revisions.ts';
import { parseChanges, replayRevisions } from '../../../shared/revisions.ts';
import type { CauseCode, EvidenceCode } from '../../../shared/tags.ts';
import { USER_REPORT_SOURCE_CODE } from '../../../shared/tags.ts';
import { isReportId, parseBbox } from '../../../shared/validation.ts';
import { readTurnstileToken } from '../validate/report.ts';
import { parseRevisionBody, validateCorrection } from '../validate/revision.ts';
import { verifyTurnstile } from '../validate/turnstile.ts';
import { errorResponse, readJsonBody, reporterHash, singleError } from './reports.ts';
import { ulid } from './ulid.ts';

const SELECT_CORRECTABLE = `
SELECT lat, lng, species, causes, evidence, protected_tree_id, inventory_tree_id
FROM reports WHERE id = ? AND status = 0 AND source = ${String(USER_REPORT_SOURCE_CODE)}
`;

const SELECT_ACTIVE = `
SELECT id, changes FROM report_revisions WHERE report_id = ? AND status = 0 ORDER BY id
`;

const INSERT_REVISION = `
INSERT INTO report_revisions (
  id, report_id, base_revision_id, changes, reason, link, status, reporter_hash, created_at
) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
`;

interface CorrectableRow {
  lat: number;
  lng: number;
  species: string | null;
  causes: string;
  evidence: number;
  protected_tree_id: string | null;
  inventory_tree_id: string | null;
}

interface ActiveRow {
  id: string;
  changes: string;
}

function notFound(): Response {
  return singleError(404, 'id', 'Unknown report');
}

export interface CurrentReport {
  readonly current: CorrectableValues;
  /** Latest revision in effect; null while the report is uncorrected. */
  readonly latestRevisionId: string | null;
}

/**
 * The report's value as the public snapshot shows it: the row with its active
 * revisions replayed, including the replay's rule for skipping a revision.
 */
export async function readCurrentReport(
  db: D1Database,
  id: string,
): Promise<CurrentReport | null> {
  const [reportResult, revisionResult] = await db.batch([
    db.prepare(SELECT_CORRECTABLE).bind(id),
    db.prepare(SELECT_ACTIVE).bind(id),
  ]);
  const row = (reportResult?.results as CorrectableRow[] | undefined)?.[0];
  if (row === undefined) {
    return null;
  }
  const original: CorrectableValues = {
    lat: row.lat,
    lng: row.lng,
    species: row.species,
    causes: JSON.parse(row.causes) as CauseCode[],
    evidence: row.evidence as EvidenceCode,
    protected_tree_id: row.protected_tree_id,
    inventory_tree_id: row.inventory_tree_id,
  };
  const active = (revisionResult?.results as ActiveRow[] | undefined) ?? [];
  const { current, applied } = replayRevisions(
    original,
    active.map((revision) => ({ id: revision.id, changes: parseChanges(revision.changes) })),
  );
  return { current, latestRevisionId: applied.at(-1)?.id ?? null };
}

export async function handleCreateRevision(
  request: Request,
  env: Env,
  id: string,
): Promise<Response> {
  const bbox = parseBbox(env.BBOX);
  if (bbox === null) {
    console.error(`invalid BBOX var: ${env.BBOX}`);
    return singleError(500, 'server', 'Server is misconfigured');
  }

  // Check 1: body limits, Turnstile, then types and unknown fields.
  const read = await readJsonBody(request);
  if (read instanceof Response) {
    return read;
  }
  const verified = await verifyTurnstile({
    secret: env.TURNSTILE_SECRET_KEY,
    token: readTurnstileToken(read.body),
    remoteip: request.headers.get('CF-Connecting-IP'),
    expectedHostname: env.TURNSTILE_HOSTNAME ?? '',
  });
  if (!verified) {
    return singleError(403, 'turnstile_token', 'Turnstile verification failed');
  }
  const parsed = parseRevisionBody(read.body);
  if (!parsed.ok) {
    return errorResponse(400, parsed.errors);
  }

  // Check 2: only a visible user report can be corrected.
  if (!isReportId(id)) {
    return notFound();
  }
  const report = await readCurrentReport(env.DB, id);
  if (report === null) {
    return notFound();
  }

  // Checks 3 to 7.
  const result = validateCorrection(parsed.body, { bbox, current: report.current });
  if (!result.ok) {
    return errorResponse(400, result.errors);
  }

  // Check 8: the sender corrected the version that is current now.
  if (parsed.body.base_revision_id !== report.latestRevisionId) {
    return Response.json(
      {
        errors: [{ field: 'base_revision_id', message: 'Report was corrected since loaded' }],
        latest_revision_id: report.latestRevisionId,
      },
      { status: 409 },
    );
  }

  // Check 9.
  const hash = await reporterHash(env.REPORTER_SALT, request.headers.get('CF-Connecting-IP') ?? '');
  const revisionId = ulid();
  await env.DB.prepare(INSERT_REVISION)
    .bind(
      revisionId,
      id,
      report.latestRevisionId,
      JSON.stringify(result.correction.changes),
      result.correction.reason,
      result.correction.link,
      hash,
      new Date().toISOString(),
    )
    .run();

  return Response.json({ id: revisionId }, { status: 201 });
}
