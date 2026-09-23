/**
 * The three routes behind an edit link, all under /api/reports/<id> and all
 * authorised by `Authorization: Bearer <edit token>`:
 *
 * - GET reads the current row, so the form is filled from the database rather
 *   than from a snapshot that can be a quarter of an hour old.
 * - PUT replaces every user-supplied field, through the same checks as POST.
 * - DELETE withdraws the report (status 2); it stays in D1, hidden.
 *
 * A missing token, a wrong token, an unknown id, an official record and a
 * report that is already hidden all answer 404 alike. Nothing distinguishes
 * "this report exists" from "this token is wrong", and a hidden report cannot
 * be brought back or rewritten by whoever holds its link.
 */
import type { Env } from '../index.ts';
import { parseBbox, taipeiDate } from '../../../shared/validation.ts';
import type { ValidatedReport } from '../validate/report.ts';
import { readTurnstileToken, validateReport } from '../validate/report.ts';
import { verifyTurnstile } from '../validate/turnstile.ts';
import { hashEditToken, readBearerToken } from './edit-token.ts';
import { errorResponse, readJsonBody, singleError } from './reports.ts';

/** Status of a report its reporter withdrew through the edit link. */
export const WITHDRAWN_STATUS = 2;

const EDITABLE = 'id = ? AND edit_token_hash = ? AND status = 0';

const SELECT_EDITABLE = `
SELECT id, lat, lng, species, causes, dispositions, evidence, note, link,
       observed_at, protected_tree_id, inventory_tree_id, created_at, updated_at
FROM reports WHERE ${EDITABLE}
`;

const UPDATE_EDITABLE = `
UPDATE reports SET
  lat = ?, lng = ?, species = ?, causes = ?, dispositions = ?, evidence = ?,
  note = ?, link = ?, observed_at = ?, protected_tree_id = ?, inventory_tree_id = ?,
  updated_at = ?
WHERE ${EDITABLE}
`;

const WITHDRAW_EDITABLE = `
UPDATE reports SET status = ${String(WITHDRAWN_STATUS)}, updated_at = ?
WHERE ${EDITABLE}
`;

interface EditableRow {
  id: string;
  lat: number;
  lng: number;
  species: string | null;
  causes: string;
  dispositions: string;
  evidence: number;
  note: string | null;
  link: string | null;
  observed_at: string | null;
  protected_tree_id: string | null;
  inventory_tree_id: string | null;
  created_at: string;
  updated_at: string | null;
}

/** Nothing about an edit link answer may be stored by any cache. */
const NO_STORE = { 'cache-control': 'no-store' };

function notFound(): Response {
  return Response.json(
    { errors: [{ field: 'edit_token', message: 'No editable report for this link' }] },
    { status: 404, headers: NO_STORE },
  );
}

async function tokenHash(request: Request): Promise<string | null> {
  const token = readBearerToken(request);
  return token === null ? null : hashEditToken(token);
}

export async function handleReadReport(request: Request, env: Env, id: string): Promise<Response> {
  const hash = await tokenHash(request);
  if (hash === null) {
    return notFound();
  }
  const row = await env.DB.prepare(SELECT_EDITABLE).bind(id, hash).first<EditableRow>();
  if (row === null) {
    return notFound();
  }
  return Response.json(
    {
      ...row,
      causes: JSON.parse(row.causes) as number[],
      dispositions: JSON.parse(row.dispositions) as number[],
    },
    { headers: NO_STORE },
  );
}

/**
 * Same order as POST: body, Turnstile, then the field checks. The token is
 * shape-checked before Turnstile is called, so a request with no plausible
 * token costs neither a siteverify call nor a D1 read; whether it opens the
 * row is decided by the UPDATE itself.
 */
export async function handleUpdateReport(
  request: Request,
  env: Env,
  id: string,
): Promise<Response> {
  const bbox = parseBbox(env.BBOX);
  if (bbox === null) {
    console.error(`invalid BBOX var: ${env.BBOX}`);
    return singleError(500, 'server', 'Server is misconfigured');
  }

  const hash = await tokenHash(request);
  if (hash === null) {
    return notFound();
  }

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

  const result = validateReport(read.body, { bbox, today: taipeiDate(new Date()) });
  if (!result.ok) {
    return errorResponse(400, result.errors);
  }

  const updatedAt = new Date().toISOString();
  const changed = await updateReport(env, id, hash, result.report, updatedAt);
  if (!changed) {
    return notFound();
  }
  return Response.json({ id, updated_at: updatedAt }, { headers: NO_STORE });
}

async function updateReport(
  env: Env,
  id: string,
  hash: string,
  report: ValidatedReport,
  updatedAt: string,
): Promise<boolean> {
  const result = await env.DB.prepare(UPDATE_EDITABLE)
    .bind(
      report.lat,
      report.lng,
      report.species,
      JSON.stringify(report.causes),
      JSON.stringify(report.dispositions),
      report.evidence,
      report.note,
      report.link,
      report.observed_at,
      report.protected_tree_id,
      report.inventory_tree_id,
      updatedAt,
      id,
      hash,
    )
    .run();
  return result.meta.changes > 0;
}

/**
 * No Turnstile here: withdrawing only ever takes a report off the map, which
 * is nothing a bot gains from, and the token already proves the right to it.
 */
export async function handleWithdrawReport(
  request: Request,
  env: Env,
  id: string,
): Promise<Response> {
  const hash = await tokenHash(request);
  if (hash === null) {
    return notFound();
  }
  const updatedAt = new Date().toISOString();
  const result = await env.DB.prepare(WITHDRAW_EDITABLE).bind(updatedAt, id, hash).run();
  if (result.meta.changes === 0) {
    return notFound();
  }
  return Response.json({ id, updated_at: updatedAt }, { headers: NO_STORE });
}
