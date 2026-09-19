-- Migration number: 0001
-- Single table for every report, whether entered by a user or imported from an
-- official record. Tag dimensions are stored as JSON arrays of integer codes
-- from shared/tags.ts; all filtering happens in the frontend on the KV
-- snapshot, so D1 never queries by tag.

CREATE TABLE reports (
  id                TEXT PRIMARY KEY,                 -- ULID
  lat               REAL NOT NULL,                    -- WGS84, rounded to 5 decimals before insert
  lng               REAL NOT NULL,
  species           TEXT,                             -- free text, <= 50 chars
  causes            TEXT NOT NULL DEFAULT '[]',       -- JSON array of cause codes
  dispositions      TEXT NOT NULL DEFAULT '[]',       -- JSON array of disposition codes
  evidence          INTEGER NOT NULL,                 -- evidence code
  source            INTEGER NOT NULL DEFAULT 1,       -- source code, 1 = user report
  note              TEXT,                             -- <= 300 chars, URLs stripped
  link              TEXT,                             -- full URL, hostname in the whitelist
  observed_at       TEXT,                             -- YYYY-MM-DD, Asia/Taipei
  protected_tree_id TEXT,                             -- protected tree id (Department of Cultural Affairs)
  inventory_tree_id TEXT,                             -- inventory tag id (Parks and Street Lights Office)
  external_ref      TEXT,                             -- source identifier of an official record, for idempotent import
  status            INTEGER NOT NULL DEFAULT 0,       -- 0 visible, 1 hidden (soft delete)
  reporter_hash     TEXT,                             -- sha256(REPORTER_SALT + ip); NULL for official records
  created_at        TEXT NOT NULL                     -- ISO 8601 UTC
);

CREATE INDEX idx_reports_status ON reports(status);

CREATE UNIQUE INDEX idx_reports_external_ref
  ON reports(external_ref)
  WHERE external_ref IS NOT NULL;
