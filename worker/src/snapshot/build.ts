/**
 * Builds the snapshot and the revisions file that the cron writes to KV.
 *
 * Both come out of one pass: every active revision is replayed onto its
 * report in id order, the snapshot row carries the result, and the revisions
 * file records what each revision replaced. Rows are read with `raw()`
 * because both outputs are positional anyway and object rows would allocate
 * one object plus a key per column for every report.
 */
import type { RevisionRow, RevisionsFile } from '../../../shared/revisions.ts';
import type { CorrectableValues, RevisionChanges } from '../../../shared/revisions.ts';
import {
  REVISIONS_SCHEMA,
  REVISION_ACTIVE,
  REVISION_COLUMNS,
  parseChanges,
  replayRevisions,
} from '../../../shared/revisions.ts';
import type { Snapshot, SnapshotRow } from '../../../shared/snapshot.ts';
import { SNAPSHOT_COLUMNS, SNAPSHOT_SCHEMA } from '../../../shared/snapshot.ts';
import type { CauseCode, DispositionCode, EvidenceCode, SourceCode } from '../../../shared/tags.ts';

/**
 * One report as D1 returns it, with `causes` and `dispositions` still JSON
 * text and no `reporter_hash` or `status`.
 */
type RawReportRow = readonly [
  id: string,
  lat: number,
  lng: number,
  species: string | null,
  causes: string,
  dispositions: string,
  evidence: number,
  source: number,
  note: string | null,
  link: string | null,
  observed_at: string | null,
  protected_tree_id: string | null,
  inventory_tree_id: string | null,
  created_at: string,
  follows_report_id: string | null,
];

type RawRevisionRow = readonly [
  id: string,
  report_id: string,
  changes: string,
  reason: string,
  link: string | null,
  created_at: string,
];

/** Visible reports only; hidden and withdrawn rows never reach the snapshot. */
const SELECT_VISIBLE_REPORTS = `
SELECT id, lat, lng, species, causes, dispositions, evidence, source, note, link,
       observed_at, protected_tree_id, inventory_tree_id, created_at, follows_report_id
FROM reports WHERE status = 0 ORDER BY id
`;

/** Active revisions of visible reports, in the order they apply. */
const SELECT_ACTIVE_REVISIONS = `
SELECT v.id, v.report_id, v.changes, v.reason, v.link, v.created_at
FROM report_revisions v JOIN reports r ON r.id = v.report_id
WHERE v.status = ${String(REVISION_ACTIVE)} AND r.status = 0
ORDER BY v.id
`;

function parseCodes<Code extends number>(json: string): readonly Code[] {
  return JSON.parse(json) as readonly Code[];
}

interface PendingRevision {
  readonly id: string;
  readonly changes: RevisionChanges;
  readonly reason: string;
  readonly link: string | null;
  readonly createdAt: string;
}

function groupRevisions(rows: readonly RawRevisionRow[]): Map<string, PendingRevision[]> {
  const byReport = new Map<string, PendingRevision[]>();
  for (const [id, reportId, changes, reason, link, createdAt] of rows) {
    const list = byReport.get(reportId) ?? [];
    list.push({ id, changes: parseChanges(changes), reason, link, createdAt });
    byReport.set(reportId, list);
  }
  return byReport;
}

export interface Publication {
  readonly snapshot: Snapshot;
  readonly revisions: RevisionsFile;
}

/** Reads every visible report and its revisions and lays both out for KV. */
export async function buildPublication(db: D1Database, generatedAt: Date): Promise<Publication> {
  const [reports, revisions] = await Promise.all([
    db.prepare(SELECT_VISIBLE_REPORTS).raw<RawReportRow>(),
    db.prepare(SELECT_ACTIVE_REVISIONS).raw<RawRevisionRow>(),
  ]);
  const byReport = groupRevisions(revisions);

  const snapshotRows: SnapshotRow[] = [];
  const revisionRows: RevisionRow[] = [];

  for (const raw of reports) {
    const [
      id,
      lat,
      lng,
      species,
      causes,
      dispositions,
      evidence,
      source,
      note,
      link,
      observedAt,
      protectedTreeId,
      inventoryTreeId,
      createdAt,
      followsReportId,
    ] = raw;

    const original: CorrectableValues = {
      lat,
      lng,
      species,
      causes: parseCodes<CauseCode>(causes),
      evidence: evidence as EvidenceCode,
      protected_tree_id: protectedTreeId,
      inventory_tree_id: inventoryTreeId,
    };
    const pending = byReport.get(id) ?? [];
    const { current, applied } = replayRevisions(original, pending);
    const details = new Map(pending.map((revision) => [revision.id, revision]));

    let revisedAt: string | null = null;
    for (const revision of applied) {
      const detail = details.get(revision.id);
      if (detail === undefined) {
        continue;
      }
      revisedAt = detail.createdAt;
      revisionRows.push([
        revision.id,
        id,
        revision.changes,
        revision.previous,
        detail.reason,
        detail.link,
        detail.createdAt,
      ]);
    }

    snapshotRows.push([
      id,
      current.lat,
      current.lng,
      current.species,
      current.causes,
      parseCodes<DispositionCode>(dispositions),
      current.evidence,
      source as SourceCode,
      note,
      link,
      observedAt,
      current.protected_tree_id,
      current.inventory_tree_id,
      createdAt,
      followsReportId,
      applied.length,
      revisedAt,
    ]);
  }

  // Revisions come out grouped by report; the file lists them in apply order.
  revisionRows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  const generated = generatedAt.toISOString();
  return {
    snapshot: {
      schema: SNAPSHOT_SCHEMA,
      generated_at: generated,
      columns: SNAPSHOT_COLUMNS,
      rows: snapshotRows,
    },
    revisions: {
      schema: REVISIONS_SCHEMA,
      generated_at: generated,
      columns: REVISION_COLUMNS,
      rows: revisionRows,
    },
  };
}

/** Served while KV holds no snapshot yet, so the frontend still gets a valid document. */
export function emptySnapshot(generatedAt: Date): Snapshot {
  return {
    schema: SNAPSHOT_SCHEMA,
    generated_at: generatedAt.toISOString(),
    columns: SNAPSHOT_COLUMNS,
    rows: [],
  };
}

/** Served while KV holds no revisions file yet. */
export function emptyRevisions(generatedAt: Date): RevisionsFile {
  return {
    schema: REVISIONS_SCHEMA,
    generated_at: generatedAt.toISOString(),
    columns: REVISION_COLUMNS,
    rows: [],
  };
}
