-- Migration number: 0003
-- Follow-up reports and corrections.
--
-- follows_report_id links a report to an earlier report of the same tree. It
-- has no foreign key: D1 does not enforce one by default, and hiding the
-- earlier report must not touch the follow-up. The write API checks once that
-- the target exists.
--
-- report_revisions holds corrections: anyone may change what a report says
-- the tree is, where it stands and what the evidence says. The report row is
-- never rewritten by a correction; its current value is the row with every
-- active revision applied in id order. status 1 is a revert by the operator,
-- status 2 means the reporter's own edit link later changed the same field.

ALTER TABLE reports ADD COLUMN follows_report_id TEXT;  -- earlier report of the same tree; NULL = not a follow-up

CREATE TABLE report_revisions (
  id               TEXT PRIMARY KEY,                  -- ULID, also the order revisions apply in
  report_id        TEXT NOT NULL,                     -- the corrected report
  base_revision_id TEXT,                              -- latest active revision the sender saw; NULL = the report itself
  changes          TEXT NOT NULL,                     -- JSON object of changed fields and their new values
  reason           TEXT NOT NULL,                     -- <= 100 chars, URLs stripped
  link             TEXT,                              -- supporting URL, hostname in the whitelist
  status           INTEGER NOT NULL DEFAULT 0,        -- 0 active, 1 reverted, 2 superseded by the reporter's edit
  reporter_hash    TEXT NOT NULL,                     -- sha256(REPORTER_SALT + ip), as in reports
  created_at       TEXT NOT NULL                      -- ISO 8601 UTC
);

CREATE INDEX idx_revisions_report ON report_revisions(report_id, status);

CREATE INDEX idx_revisions_reporter ON report_revisions(reporter_hash);
