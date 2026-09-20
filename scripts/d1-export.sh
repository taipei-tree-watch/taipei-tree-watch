#!/usr/bin/env bash
#
# Export the whole D1 database, including reporter_hash, to a local backup
# directory. The dump is personal data, so it stays outside the repo and is
# never committed.
#
# D1 on the free plan has no automatic backups; this is the only full copy.
# Files older than the retention window are deleted at the end of each run.
#
# Run with: npm run backup:d1
set -euo pipefail

BACKUP_DIR="${TTW_BACKUP_DIR:-$HOME/backups/taipei-tree-watch}"
RETENTION_DAYS="${TTW_BACKUP_RETENTION_DAYS:-90}"
LPASS_ENTRY="taipei-tree-watch/cloudflare-api"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

# Credentials come from the environment when one is already set up, and
# otherwise from the password manager, so the scheduled job needs no secrets of
# its own.
if [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
  CLOUDFLARE_ACCOUNT_ID="$(lpass show --username "$LPASS_ENTRY")"
fi
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  CLOUDFLARE_API_TOKEN="$(lpass show --password "$LPASS_ENTRY")"
fi
export CLOUDFLARE_ACCOUNT_ID CLOUDFLARE_API_TOKEN

mkdir -p "$BACKUP_DIR"
stamp="$(TZ=Asia/Taipei date +%Y-%m-%d)"
target="$BACKUP_DIR/taipei-tree-watch-$stamp.sql"

npx wrangler d1 export taipei-tree-watch --remote --output "$target"

# An export that produced nothing would quietly replace a good backup with an
# empty file, so fail loudly instead.
if [ ! -s "$target" ]; then
  echo "export produced an empty file: $target" >&2
  exit 1
fi

echo "wrote $target ($(wc -c <"$target" | tr -d ' ') bytes)"

find "$BACKUP_DIR" -name 'taipei-tree-watch-*.sql' -type f -mtime "+$RETENTION_DAYS" -print -delete
