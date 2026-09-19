/**
 * GET /api/snapshot: hands back the KV snapshot with caching headers.
 *
 * The ETag is the snapshot's `generated_at`, taken from the KV metadata so a
 * request never has to parse the body. A snapshot restored by hand (see the
 * rollback procedure) carries no metadata, so the timestamp is then read from
 * the head of the document instead.
 */
import { emptySnapshot } from './build.ts';
import type { SnapshotMetadata } from './store.ts';
import { SNAPSHOT_LATEST_KEY } from './store.ts';

const CACHE_CONTROL = 'public, max-age=300, stale-while-revalidate=900';

/** `generated_at` is the second member of the document, so a short prefix is enough. */
const GENERATED_AT_PREFIX_LENGTH = 256;
const GENERATED_AT_PATTERN = /"generated_at":"([^"]+)"/;

function readGeneratedAt(body: string, metadata: SnapshotMetadata | null): string | null {
  if (metadata !== null) {
    return metadata.generated_at;
  }
  return GENERATED_AT_PATTERN.exec(body.slice(0, GENERATED_AT_PREFIX_LENGTH))?.[1] ?? null;
}

function isEtagMatch(ifNoneMatch: string | null, etag: string): boolean {
  if (ifNoneMatch === null) {
    return false;
  }
  return ifNoneMatch.split(',').some((entry) => {
    const candidate = entry.trim();
    return candidate === '*' || candidate === etag || candidate === `W/${etag}`;
  });
}

export async function handleSnapshotRequest(request: Request, kv: KVNamespace): Promise<Response> {
  const { value, metadata } = await kv.getWithMetadata<SnapshotMetadata>(
    SNAPSHOT_LATEST_KEY,
    'text',
  );

  if (value === null) {
    return Response.json(emptySnapshot(new Date()), {
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  const headers = new Headers({
    'Content-Type': 'application/json',
    'Cache-Control': CACHE_CONTROL,
  });

  const generatedAt = readGeneratedAt(value, metadata);
  if (generatedAt === null) {
    return new Response(value, { headers });
  }

  const etag = `"${generatedAt}"`;
  headers.set('ETag', etag);
  if (isEtagMatch(request.headers.get('If-None-Match'), etag)) {
    return new Response(null, { status: 304, headers });
  }

  return new Response(value, { headers });
}
