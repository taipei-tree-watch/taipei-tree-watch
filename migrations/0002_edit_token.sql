-- Migration number: 0002
-- Edit links. A user report is created with a random edit token; only its
-- SHA-256 is stored, so the table never holds a working credential. Official
-- records and reports created before this migration have no token and can
-- never be edited through the API.
--
-- status gains a third value: 2 = withdrawn by the reporter through the edit
-- link. It is hidden exactly like 1 (soft delete by the operator) and is kept
-- apart only so the two can be told apart later.

ALTER TABLE reports ADD COLUMN edit_token_hash TEXT;  -- sha256(edit token) as lowercase hex; NULL = not editable

ALTER TABLE reports ADD COLUMN updated_at TEXT;       -- ISO 8601 UTC of the last edit or withdrawal; NULL until then
