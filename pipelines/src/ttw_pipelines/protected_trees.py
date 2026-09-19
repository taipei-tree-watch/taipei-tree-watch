"""Protected tree pipeline.

Downloads the Taipei protected-tree dataset published on data.taipei, converts
it to the column-array layout the web app loads as `trees.json`, and records the
id-level difference against the previous run under `changes/<fetched_at>.json`.

Rows whose latitude or longitude is not numeric, or carries fewer than two
decimal places, are dropped: the published coordinate precision is about 11
metres at four decimals, and a coarser value cannot be placed on the map.
"""

from __future__ import annotations

import csv
import io
import json
import re
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx

from ttw_pipelines.shared import REPO_ROOT

RESOURCE_ID = "a7c2db0d-8b6e-42b2-bdcc-ae69a6797e1d"
CSV_URL = (
    "https://data.taipei/api/frontstage/tpeod/dataset/resource.download"
    f"?rid={RESOURCE_ID}"
)
SOURCE = "臺北市政府文化局 臺北市受保護樹木"
SCHEMA = 1
COLUMNS = [
    "id",
    "species",
    "lat",
    "lng",
    "dbh_m",
    "address",
    "manager",
    "site_type",
    "district",
]
DEFAULT_OUT_DIR = REPO_ROOT / "data" / "protected-trees"
TREES_FILENAME = "trees.json"
CHANGES_DIRNAME = "changes"
REMOVED_FLAG = "suspected-delisting"

# Source column names, quoted from the published CSV header.
CSV_ID = "樹木編號"
CSV_SPECIES = "樹種名稱"
CSV_DBH = "樹胸徑寬度公尺"
CSV_ADDRESS = "地址"
CSV_LAT = "緯度"
CSV_LNG = "經度"
CSV_SITE_TYPE = "地理位置名稱"
CSV_MANAGER = "管理單位"

# Addresses start with the city name; the district is always two characters.
DISTRICT_RE = re.compile(r"^[臺台]北市(..區)")
# Reject integers and one-decimal values along with anything non-numeric.
COORDINATE_RE = re.compile(r"^-?\d+\.\d{2,}$")

# Keys whose array members are written one per line.
_LINE_PER_ITEM_KEYS = frozenset({"rows", "added", "removed"})


def fetch_csv(url: str = CSV_URL, *, attempts: int = 3, timeout: float = 60.0) -> str:
    """Download the dataset CSV, retrying transient failures with a backoff."""
    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            response = httpx.get(url, timeout=timeout, follow_redirects=True)
            response.raise_for_status()
        except httpx.HTTPError as error:
            last_error = error
            if attempt == attempts:
                break
            time.sleep(2**attempt)
            continue
        return response.content.decode("utf-8-sig")
    raise RuntimeError(f"failed to download {url} after {attempts} attempts") from last_error


def read_csv_file(path: Path) -> str:
    """Read a locally cached copy of the dataset CSV."""
    return path.read_bytes().decode("utf-8-sig")


def parse_district(address: str) -> str | None:
    """Return the district taken from the address prefix, or None when absent."""
    match = DISTRICT_RE.match(address.strip())
    return match.group(1) if match else None


def _parse_coordinate(raw: str) -> float | None:
    """Return the coordinate, or None when it is unusable."""
    if not COORDINATE_RE.match(raw.strip()):
        return None
    return float(raw)


def _parse_diameter(raw: str) -> float | None:
    """Return the trunk diameter in metres, or None when the source leaves it blank."""
    text = raw.strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _sort_key(tree_id: str) -> tuple[int, int, str]:
    """Order by numeric id; ids that are not numeric sort last, by text."""
    if tree_id.isdigit():
        return (0, int(tree_id), "")
    return (1, 0, tree_id)


def parse_rows(csv_text: str) -> tuple[list[list[Any]], list[dict[str, str]]]:
    """Convert the CSV into column-array rows plus the raw records that were dropped."""
    reader = csv.DictReader(io.StringIO(csv_text))
    kept: list[list[Any]] = []
    dropped: list[dict[str, str]] = []
    for record in reader:
        lat = _parse_coordinate(record.get(CSV_LAT) or "")
        lng = _parse_coordinate(record.get(CSV_LNG) or "")
        if lat is None or lng is None:
            dropped.append({key: (value or "").strip() for key, value in record.items()})
            continue
        address = (record.get(CSV_ADDRESS) or "").strip()
        kept.append(
            [
                (record.get(CSV_ID) or "").strip(),
                (record.get(CSV_SPECIES) or "").strip(),
                lat,
                lng,
                _parse_diameter(record.get(CSV_DBH) or ""),
                address,
                (record.get(CSV_MANAGER) or "").strip(),
                (record.get(CSV_SITE_TYPE) or "").strip(),
                parse_district(address),
            ]
        )
    kept.sort(key=lambda row: _sort_key(row[0]))
    return kept, dropped


def build_document(
    rows: list[list[Any]], *, fetched_at: str, dropped: int
) -> dict[str, Any]:
    """Assemble the trees.json document."""
    return {
        "schema": SCHEMA,
        "source": SOURCE,
        "fetched_at": fetched_at,
        "columns": list(COLUMNS),
        "dropped": dropped,
        "rows": rows,
    }


def _records_by_id(document: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Index a trees.json document by tree id, keyed on its own column order."""
    columns = document["columns"]
    return {row[0]: dict(zip(columns, row, strict=False)) for row in document["rows"]}


def _change_entry(record: dict[str, Any], *, flag: str | None = None) -> dict[str, Any]:
    entry: dict[str, Any] = {
        "id": record.get("id"),
        "species": record.get("species"),
        "address": record.get("address"),
        "lat": record.get("lat"),
        "lng": record.get("lng"),
    }
    if flag is not None:
        entry["flag"] = flag
    return entry


def diff_documents(
    previous: dict[str, Any], current: dict[str, Any]
) -> dict[str, list[dict[str, Any]]]:
    """Compare the tree id sets of two documents.

    Ids missing from the current dataset are flagged as suspected delistings: the
    dataset drops a tree once the protection is lifted, so the disappearance is
    the only public trace of the decision.
    """
    before = _records_by_id(previous)
    after = _records_by_id(current)
    added = [
        _change_entry(after[tree_id])
        for tree_id in sorted(set(after) - set(before), key=_sort_key)
    ]
    removed = [
        _change_entry(before[tree_id], flag=REMOVED_FLAG)
        for tree_id in sorted(set(before) - set(after), key=_sort_key)
    ]
    return {"added": added, "removed": removed}


def dumps(document: dict[str, Any]) -> str:
    """Serialise a document with one row per line, byte-identical for equal input."""
    parts = []
    for key, value in document.items():
        if key in _LINE_PER_ITEM_KEYS and isinstance(value, list):
            items = [
                json.dumps(item, ensure_ascii=False, separators=(",", ":")) for item in value
            ]
            rendered = "[\n  " + ",\n  ".join(items) + "\n ]" if items else "[]"
        else:
            rendered = json.dumps(value, ensure_ascii=False)
        parts.append(f" {json.dumps(key, ensure_ascii=False)}: {rendered}")
    return "{\n" + ",\n".join(parts) + "\n}\n"


def _load_document(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def run(
    *,
    out_dir: Path = DEFAULT_OUT_DIR,
    input_path: Path | None = None,
    fetched_at: str | None = None,
) -> dict[str, Any]:
    """Run the pipeline and return a summary of what was written."""
    csv_text = read_csv_file(input_path) if input_path else fetch_csv()
    rows, dropped = parse_rows(csv_text)
    stamp = fetched_at or datetime.now(UTC).strftime("%Y-%m-%d")
    document = build_document(rows, fetched_at=stamp, dropped=len(dropped))

    trees_path = out_dir / TREES_FILENAME
    previous = _load_document(trees_path)
    out_dir.mkdir(parents=True, exist_ok=True)
    trees_path.write_text(dumps(document), encoding="utf-8")

    changes_path: Path | None = None
    changes = {"added": [], "removed": []}
    if previous is not None:
        changes = diff_documents(previous, document)
        if changes["added"] or changes["removed"]:
            changes_path = out_dir / CHANGES_DIRNAME / f"{stamp}.json"
            changes_path.parent.mkdir(parents=True, exist_ok=True)
            changes_path.write_text(
                dumps({"schema": SCHEMA, "fetched_at": stamp, **changes}), encoding="utf-8"
            )

    return {
        "trees_path": trees_path,
        "changes_path": changes_path,
        "kept": len(rows),
        "dropped": dropped,
        "added": len(changes["added"]),
        "removed": len(changes["removed"]),
    }
