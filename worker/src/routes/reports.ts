/**
 * POST /api/reports: the only write path in the system.
 *
 * Runs the twelve server-side checks of TECH-SPEC section 6 in order and stops
 * at the first failure. The frontend performs the same field checks, but only
 * this handler decides what reaches D1.
 *
 * Responses: 201 {id, edit_token} on success, 400 {errors} for a rejected
 * field, 403 for a failed Turnstile verification, 413 for an oversized body.
 * The edit token appears in this response and nowhere else; D1 keeps its hash.
 */
import type { Env } from '../index.ts';
import { parseBbox, taipeiDate } from '../../../shared/validation.ts';
import type { FieldError, ValidatedReport } from '../validate/report.ts';
import { readTurnstileToken, validateReport } from '../validate/report.ts';
import { verifyTurnstile } from '../validate/turnstile.ts';
import { hashEditToken, newEditToken } from './edit-token.ts';
import { ulid } from './ulid.ts';

/** Check 1: a report body never legitimately exceeds this. */
export const MAX_BODY_BYTES = 16 * 1024;

const INSERT_REPORT = `
INSERT INTO reports (
  id, lat, lng, species, causes, dispositions, evidence, source,
  note, link, observed_at, protected_tree_id, inventory_tree_id,
  status, reporter_hash, edit_token_hash, created_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
`;

export function errorResponse(status: number, errors: readonly FieldError[]): Response {
  return Response.json({ errors }, { status });
}

export function singleError(status: number, field: string, message: string): Response {
  return errorResponse(status, [{ field, message }]);
}

/** Check 12: sha256(REPORTER_SALT + ip) as lowercase hex. */
async function reporterHash(salt: string, ip: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + ip));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Check 1, shared by every route that takes a report body: JSON content type,
 * at most MAX_BODY_BYTES, parsable. Returns the rejection to send, or the body.
 */
export async function readJsonBody(request: Request): Promise<Response | { body: unknown }> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return singleError(400, 'content-type', 'Content-Type must be application/json');
  }

  const declaredLength = Number(request.headers.get('content-length') ?? '');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return singleError(413, 'body', `Body must be at most ${MAX_BODY_BYTES} bytes`);
  }

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return singleError(413, 'body', `Body must be at most ${MAX_BODY_BYTES} bytes`);
  }

  try {
    return { body: JSON.parse(rawBody) as unknown };
  } catch {
    return singleError(400, 'body', 'Body must be valid JSON');
  }
}

export async function handleCreateReport(request: Request, env: Env): Promise<Response> {
  const bbox = parseBbox(env.BBOX);
  if (bbox === null) {
    console.error(`invalid BBOX var: ${env.BBOX}`);
    return singleError(500, 'server', 'Server is misconfigured');
  }

  // Check 1: JSON content type, body under the size limit, parsable JSON.
  const read = await readJsonBody(request);
  if (read instanceof Response) {
    return read;
  }
  const body = read.body;

  // Check 2: Turnstile, verified against the same client IP that solved it.
  const verified = await verifyTurnstile({
    secret: env.TURNSTILE_SECRET_KEY,
    token: readTurnstileToken(body),
    remoteip: request.headers.get('CF-Connecting-IP'),
    expectedHostname: env.TURNSTILE_HOSTNAME ?? '',
  });
  if (!verified) {
    return singleError(403, 'turnstile_token', 'Turnstile verification failed');
  }

  // Checks 3 to 11.
  const result = validateReport(body, { bbox, today: taipeiDate(new Date()) });
  if (!result.ok) {
    return errorResponse(400, result.errors);
  }

  const id = ulid();
  const hash = await reporterHash(
    env.REPORTER_SALT,
    request.headers.get('CF-Connecting-IP') ?? '',
  );
  const editToken = newEditToken();
  await insertReport(
    env,
    id,
    result.report,
    hash,
    await hashEditToken(editToken),
    new Date().toISOString(),
  );

  return Response.json({ id, edit_token: editToken }, { status: 201 });
}

async function insertReport(
  env: Env,
  id: string,
  report: ValidatedReport,
  hash: string,
  editTokenHash: string,
  createdAt: string,
): Promise<void> {
  await env.DB.prepare(INSERT_REPORT)
    .bind(
      id,
      report.lat,
      report.lng,
      report.species,
      JSON.stringify(report.causes),
      JSON.stringify(report.dispositions),
      report.evidence,
      report.source,
      report.note,
      report.link,
      report.observed_at,
      report.protected_tree_id,
      report.inventory_tree_id,
      hash,
      editTokenHash,
      createdAt,
    )
    .run();
}
