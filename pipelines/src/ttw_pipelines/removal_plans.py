"""Removal and transplant plan pipeline.

The Parks and Street Lights Office publishes tree removal and transplant plans
for review on pkl.gov.taipei. The plans are PDFs; their per-tree tables are
extracted by hand into a CSV kept outside the repo. This module has two steps:

* `curate` reads that CSV and writes `plans.json`: every tree the plans remove
  or transplant, with the plan's own wording, plus one entry per case. This is
  the committed input of everything below.
* `build` turns `plans.json` into report rows. A tree with a usable coordinate
  becomes one INSERT in `import.sql` and one entry in `index.json`, which the
  web app loads to name the plan on the card. A tree without one goes to
  `pending.json`, keyed by the same external_ref, so a later coordinate source
  can place it by writing `coordinates.json` and running `build` again.
  A pending tree whose location is one of the hand-picked sites in
  `sites.json` is drawn as part of that site's summary point instead
  (`plan_sites`), and `pending.json` names the site.

Every report carries a deterministic id and external_ref, so a rerun writes
the same bytes and a repeated import inserts nothing twice.
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
import re
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from pyproj import Transformer

from ttw_pipelines import plan_sites
from ttw_pipelines.protected_trees import dumps
from ttw_pipelines.shared import (
    REPO_ROOT,
    code_for_slug,
    load_bbox,
    load_validation_limits,
)

SCHEMA = 1
SOURCE = "臺北市政府工務局公園路燈工程管理處 樹木移除計畫、移植計畫審查專區"
DEFAULT_OUT_DIR = REPO_ROOT / "data" / "removal-plans"
PLANS_FILENAME = "plans.json"
COORDINATES_FILENAME = "coordinates.json"
IMPORT_FILENAME = "import.sql"
INDEX_FILENAME = "index.json"
PENDING_FILENAME = "pending.json"
REVIEW_FILENAME = "review.json"
INVENTORY_FILENAME = "inventory.json"

TREES_CSV = "trees_2026.csv"
CASES_CSV = "cases_2026.csv"

EXTERNAL_REF_PREFIX = "pkl"

# Only these plan actions describe a tree leaving its spot. "retain" and
# "other" (already felled, dead, no action stated) are not imported.
IMPORTED_ACTIONS = ("remove", "transplant")

PLAN_STATUSES = ("approved", "under_review", "unclear")

TREE_COLUMNS = [
    "case",
    "doc",
    "plan_no",
    "tree_tag",
    "species",
    "action",
    "reason",
    "location",
    "twd97_x",
    "twd97_y",
    "lat",
    "lon",
    "notes",
]

PENDING_COLUMNS = [
    "external_ref",
    "case",
    "plan_no",
    "tree_tag",
    "species",
    "action",
    "location",
    "why",
]

# pending.json adds the site a pending tree is summarised under, or null.
PENDING_FILE_COLUMNS = [*PENDING_COLUMNS, "site"]

# inventory_gone: the inventory date when the tree's tag is no longer in the
# Parks Office inventory, else null. A signal for the card, never a status.
INDEX_COLUMNS = ["id", "case", "action", "inventory_gone"]

# Why a tree is on the pending list rather than on the map.
PENDING_NO_COORDINATE = "no-coordinate"
PENDING_OUTSIDE_BBOX = "outside-bbox"
PENDING_PLACEHOLDER = "placeholder-coordinate"

# Coordinates printed on assessment sheets that the extraction found repeated
# across unrelated trees of one site: a form template value, not a location.
PLACEHOLDER_TWD97 = frozenset({(305699.0, 2765450.0)})

# Trees listed twice: the CF762 transplant plan names the 29 trees it removes,
# and the CF762 removal plan (doc 2 of the CF760 removal case) lists the same
# trees with species and coordinates. The removal plan is the one imported.
COVERED_BY = {
    ("transplant_23FDA7AE92260DD3", "remove"): ("removal_D3BB0AD389D1F53B", 2),
}

# Keywords that let a cause be read off the plan's own reason text, in cause
# slug order. Nothing is inferred beyond the words themselves.
REASON_KEYWORDS: tuple[tuple[str, str], ...] = (
    ("brown-root-rot", r"褐根病"),
    ("decay-cavity", r"腐朽|樹洞"),
    ("dead", r"枯死"),
    ("fall-risk", r"傾倒|公共安全"),
    ("risk-assessment-high", r"高風險|風險評估"),
    ("typhoon", r"颱風"),
)

# The works a case belongs to, read off its title. First match wins, so the
# MRT works are recognised before the park and school words they may contain.
PROJECT_KEYWORDS: tuple[tuple[str, str], ...] = (
    ("mrt-construction", r"捷運"),
    ("road-construction", r"道路|交流道|國道"),
    ("park-school-works", r"公園|綠地|花園|國小|國中|高中|學校"),
)

# Chinese wording written into the note. It is data shown on the card, so it
# lives here rather than in the web app's strings.
ACTION_LABELS = {"remove": "計畫移除", "transplant": "計畫移植"}
STATUS_LABELS = {"approved": "已核准", "under_review": "審查中", "unclear": "狀態不明"}
NOTE_DATE = "日期為計畫上網日期"
NOTE_PLAN_NO = "計畫書編號 {plan_no}"
NOTE_SHARED_COORDINATE = "座標與計畫書編號 {others} 相同，位置可能有誤"
NOTE_REASON = "原因：{reason}"
NOTE_COORDINATE_VIA = {
    "inventory": "座標依樹籤編號取自公園處清冊",
    "geocode": "座標依地點文字定位，可能有誤差",
}
# The data source says where the point comes from: the plan's own coordinate,
# or the Parks Office inventory entry of the tree's tag.
SOURCE_SLUGS = {None: "removal-plan", "inventory": "removal-plan-inventory"}

NOTE_SEPARATOR = "。"
ELLIPSIS = "…"

ROC_DATE_RE = re.compile(r"^(\d{2,3})-(\d{2})-(\d{2})$")
DOC_INDEX_RE = re.compile(r"_(\d+)\.pdf$")
URL_LIKE_RE = re.compile(r"(?:[a-z][a-z0-9+.-]*://|//|www\.)\S*", re.IGNORECASE)
INVENTORY_TAG_RE = re.compile(r"^[A-Za-z]{2}[0-9]{10}$")

TAIPEI = timezone(timedelta(hours=8))
CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

_TWD97_TO_WGS84 = Transformer.from_crs("EPSG:3826", "EPSG:4326", always_xy=True)

_LINE_PER_ITEM_KEYS = frozenset({"cases", "rows", "shared_coordinates", "covered", "sites"})


# ---------------------------------------------------------------------------
# Small conversions


def roc_to_iso(value: str) -> str:
    """Convert an ROC calendar date such as 115-09-23 to 2026-09-23."""
    match = ROC_DATE_RE.match(value.strip())
    if match is None:
        raise ValueError(f"not an ROC date: {value!r}")
    year, month, day = (int(part) for part in match.groups())
    return datetime(year + 1911, month, day).strftime("%Y-%m-%d")


def doc_index(doc: str) -> int:
    """The position of a PDF within its case, from a name like raw/<case>_2.pdf."""
    match = DOC_INDEX_RE.search(doc)
    if match is None:
        raise ValueError(f"cannot read the document index from {doc!r}")
    return int(match.group(1))


def external_ref(case: str, doc: str, plan_no: str) -> str:
    """Source identifier of one tree: pkl:<case>:<doc index>:<plan_no>."""
    return f"{EXTERNAL_REF_PREFIX}:{case}:{doc_index(doc)}:{plan_no}"


def twd97_to_wgs84(x: float, y: float, decimals: int = 5) -> tuple[float, float]:
    """Convert TWD97 TM2 (EPSG:3826) metres to a WGS84 (lat, lng) pair, rounded."""
    lng, lat = _TWD97_TO_WGS84.transform(x, y)
    return round(lat, decimals), round(lng, decimals)


def in_bbox(lat: float, lng: float, bbox: tuple[float, float, float, float]) -> bool:
    min_lng, min_lat, max_lng, max_lat = bbox
    return min_lat <= lat <= max_lat and min_lng <= lng <= max_lng


def _crockford(value: int, length: int) -> str:
    chars = []
    for _ in range(length):
        chars.append(CROCKFORD[value & 31])
        value >>= 5
    return "".join(reversed(chars))


def report_id(ref: str, posted_at: str) -> str:
    """A ULID that is the same on every run for the same tree.

    The time part is midnight Asia/Taipei of the posting date, so imported
    rows sort by when the plan went online; the random part is taken from the
    hash of the external_ref.
    """
    moment = datetime.strptime(posted_at, "%Y-%m-%d").replace(tzinfo=TAIPEI)
    millis = int(moment.astimezone(UTC).timestamp() * 1000)
    digest = int.from_bytes(hashlib.sha256(ref.encode("utf-8")).digest()[:10], "big")
    return _crockford(millis, 10) + _crockford(digest, 16)


def causes_for(reason: str, title: str) -> list[int]:
    """Cause codes stated by the reason text, plus the works the case belongs to."""
    codes = {
        code_for_slug("causes", slug)
        for slug, pattern in REASON_KEYWORDS
        if re.search(pattern, reason)
    }
    for slug, pattern in PROJECT_KEYWORDS:
        if re.search(pattern, title):
            codes.add(code_for_slug("causes", slug))
            break
    return sorted(codes)


def inventory_tag(value: str) -> str | None:
    """The Parks Office tag in its canonical upper case; other numbering is dropped."""
    text = value.strip()
    return text.upper() if INVENTORY_TAG_RE.match(text) else None


def _parse_number(value: str) -> float | None:
    text = value.strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _fit(text: str, limit: int) -> str:
    """Cut to at most `limit` code points, marking the cut."""
    if len(text) <= limit:
        return text
    return text[: limit - len(ELLIPSIS)] + ELLIPSIS


def build_note(
    *,
    action: str,
    title: str,
    status: str,
    plan_no: str,
    reason: str,
    extra: list[str],
    limit: int,
) -> str:
    """The card note: planned action, plan and status, date caveat, then the reason.

    Only the reason is shortened when the whole does not fit, so the parts that
    say what kind of record this is always survive.
    """
    if URL_LIKE_RE.search(reason):
        raise ValueError(f"reason carries a link, which notes never hold: {reason!r}")
    head = [
        ACTION_LABELS[action],
        f"{title}（{STATUS_LABELS[status]}）",
        NOTE_PLAN_NO.format(plan_no=plan_no),
        NOTE_DATE,
        *extra,
    ]
    prefix = NOTE_SEPARATOR.join(head) + NOTE_SEPARATOR
    text = reason.strip()
    if not text:
        return _fit(prefix, limit)
    room = limit - len(prefix)
    reason_part = NOTE_REASON.format(reason=text)
    if room <= len(NOTE_REASON.format(reason="")) + len(ELLIPSIS):
        return _fit(prefix, limit)
    return prefix + _fit(reason_part, room)


# ---------------------------------------------------------------------------
# curate: CSV -> plans.json


def _read_csv(path: Path) -> list[dict[str, str]]:
    text = path.read_bytes().decode("utf-8-sig")
    return [
        {key: (value or "").strip() for key, value in row.items()}
        for row in csv.DictReader(io.StringIO(text))
    ]


def curate(trees: list[dict[str, str]], cases: list[dict[str, str]], *, extracted_at: str) -> dict:
    """Assemble plans.json from the extraction CSVs."""
    case_entries = []
    for row in sorted(cases, key=lambda entry: entry["case"]):
        status = row["status_guess"]
        if status not in PLAN_STATUSES:
            raise ValueError(f"{row['case']}: unknown status {status!r}")
        case_entries.append(
            {
                "case": row["case"],
                "zone": row["zone"],
                "title": row["title"],
                "applicant": row["applicant"],
                "list_date": row["list_date"],
                "posted_at": roc_to_iso(row["list_date"]),
                "status": status,
                "status_quote": row["status_quote"],
                "url": row["page_url"],
            }
        )
    known = {entry["case"] for entry in case_entries}

    rows = []
    for tree in trees:
        if tree["action"] not in IMPORTED_ACTIONS:
            continue
        if tree["case"] not in known:
            raise ValueError(f"tree row names an unknown case: {tree['case']}")
        rows.append([tree[column] for column in TREE_COLUMNS])
    rows.sort(key=lambda row: (row[0], doc_index(row[1]), _plan_sort_key(row[2])))

    return {
        "schema": SCHEMA,
        "source": SOURCE,
        "extracted_at": extracted_at,
        "cases": case_entries,
        "columns": list(TREE_COLUMNS),
        "rows": rows,
    }


def _plan_sort_key(plan_no: str) -> tuple[str, int, str]:
    """Natural order for plan numbers such as A9, A10, C173, Y33-11."""
    match = re.match(r"^([^0-9]*)(\d+)(.*)$", plan_no)
    if match is None:
        return (plan_no, 0, "")
    return (match.group(1), int(match.group(2)), match.group(3))


# ---------------------------------------------------------------------------
# build: plans.json -> import.sql, index.json, pending.json, review.json


@dataclass(frozen=True)
class Placement:
    lat: float
    lng: float
    via: str | None  # None when the plan itself gives the coordinate


@dataclass(frozen=True)
class Report:
    id: str
    external_ref: str
    case: str
    action: str
    lat: float
    lng: float
    species: str | None
    causes: list[int]
    note: str
    link: str
    observed_at: str
    inventory_tree_id: str | None
    source: str  # source slug, see SOURCE_SLUGS


def _plan_coordinate(tree: dict[str, str]) -> tuple[str, tuple[float, float] | None]:
    """The coordinate the plan prints, or why there is none to use."""
    x, y = _parse_number(tree["twd97_x"]), _parse_number(tree["twd97_y"])
    if x is not None and y is not None:
        if (x, y) in PLACEHOLDER_TWD97:
            return PENDING_PLACEHOLDER, None
        return "", twd97_to_wgs84(x, y)
    lat, lng = _parse_number(tree["lat"]), _parse_number(tree["lon"])
    if lat is not None and lng is not None:
        return "", (round(lat, 5), round(lng, 5))
    return PENDING_NO_COORDINATE, None


def _load_coordinates(path: Path) -> dict[str, Placement]:
    """Coordinates found later for pending trees, keyed by external_ref.

    Layout: {"schema": 1, "coordinates": {"<external_ref>": {"lat": .., "lng": ..,
    "via": "inventory" | "geocode"}}}. The plan's own coordinate always wins.
    """
    if not path.exists():
        return {}
    document = json.loads(path.read_text(encoding="utf-8"))
    placements = {}
    for ref, entry in document.get("coordinates", {}).items():
        via = entry["via"]
        if via not in NOTE_COORDINATE_VIA:
            raise ValueError(f"{ref}: unknown coordinate source {via!r}")
        placements[ref] = Placement(round(entry["lat"], 5), round(entry["lng"], 5), via)
    return placements


def build(plans: dict, coordinates: dict[str, Placement] | None = None) -> dict[str, Any]:
    """Turn plans.json into placed reports, pending trees and review notes."""
    limits = load_validation_limits()
    bbox = load_bbox()
    coordinates = coordinates or {}
    cases = {entry["case"]: entry for entry in plans["cases"]}
    trees = [dict(zip(plans["columns"], row, strict=True)) for row in plans["rows"]]

    listed = {(tree["case"], doc_index(tree["doc"]), tree["plan_no"]) for tree in trees}
    covered = []
    kept = []
    for tree in trees:
        cover = COVERED_BY.get((tree["case"], tree["action"]))
        if cover is not None and (cover[0], cover[1], tree["plan_no"]) in listed:
            covered.append(
                [
                    external_ref(tree["case"], tree["doc"], tree["plan_no"]),
                    f"{EXTERNAL_REF_PREFIX}:{cover[0]}:{cover[1]}:{tree['plan_no']}",
                ]
            )
            continue
        kept.append(tree)

    refs = [external_ref(tree["case"], tree["doc"], tree["plan_no"]) for tree in kept]
    duplicates = sorted({ref for ref in refs if refs.count(ref) > 1})
    if duplicates:
        raise ValueError(f"external_ref is not unique: {duplicates}")

    placed: list[tuple[dict[str, str], str, Placement]] = []
    pending = []
    plan_trees = []
    for tree, ref in zip(kept, refs, strict=True):
        why, point = _plan_coordinate(tree)
        placement = Placement(point[0], point[1], None) if point is not None else None
        if placement is None and ref in coordinates:
            placement = coordinates[ref]
        if placement is not None and not in_bbox(placement.lat, placement.lng, bbox):
            why, placement = PENDING_OUTSIDE_BBOX, None
        plan_trees.append(
            plan_sites.PlanTree(
                external_ref=ref,
                case=tree["case"],
                location=tree["location"] or None,
                species=tree["species"] or None,
                action=tree["action"],
                causes=tuple(causes_for(tree["reason"], cases[tree["case"]]["title"])),
                placed=placement is not None,
            )
        )
        if placement is None:
            pending.append(
                [
                    ref,
                    tree["case"],
                    tree["plan_no"],
                    tree["tree_tag"] or None,
                    tree["species"] or None,
                    tree["action"],
                    tree["location"] or None,
                    why,
                ]
            )
            continue
        placed.append((tree, ref, placement))

    # Different trees of one case at the very same point: one of the sheets was
    # most likely copied from the other. Both stay on the map, marked.
    by_point: dict[tuple[str, float, float], list[str]] = {}
    for tree, _, placement in placed:
        by_point.setdefault((tree["case"], placement.lat, placement.lng), []).append(
            tree["plan_no"]
        )
    shared = sorted(
        [case, lat, lng, numbers]
        for (case, lat, lng), numbers in by_point.items()
        if len(numbers) > 1
    )

    reports = []
    for tree, ref, placement in placed:
        case = cases[tree["case"]]
        extra = []
        others = [
            number
            for number in by_point[(tree["case"], placement.lat, placement.lng)]
            if number != tree["plan_no"]
        ]
        if others:
            extra.append(NOTE_SHARED_COORDINATE.format(others="、".join(others)))
        if placement.via is not None:
            extra.append(NOTE_COORDINATE_VIA[placement.via])
        species = tree["species"] or None
        if species is not None and len(species) > limits["species_max_chars"]:
            species = _fit(species, limits["species_max_chars"])
        reports.append(
            Report(
                id=report_id(ref, case["posted_at"]),
                external_ref=ref,
                case=tree["case"],
                action=tree["action"],
                lat=placement.lat,
                lng=placement.lng,
                species=species,
                causes=causes_for(tree["reason"], case["title"]),
                note=build_note(
                    action=tree["action"],
                    title=case["title"],
                    status=case["status"],
                    plan_no=tree["plan_no"],
                    reason=tree["reason"],
                    extra=extra,
                    limit=limits["note_max_chars"],
                ),
                link=case["url"],
                observed_at=case["posted_at"],
                inventory_tree_id=inventory_tag(tree["tree_tag"]),
                source=SOURCE_SLUGS[placement.via],
            )
        )
    reports.sort(key=lambda report: report.id)

    return {
        "reports": reports,
        "pending": pending,
        "shared": shared,
        "covered": covered,
        "trees": plan_trees,
    }


def _sql_text(value: str | None) -> str:
    if value is None:
        return "NULL"
    return "'" + value.replace("'", "''") + "'"


def _sql_number(value: float) -> str:
    return repr(float(value))


def import_sql(reports: list[Report]) -> str:
    """One INSERT OR IGNORE per report, then the data source of rows already imported.

    external_ref's unique index skips known rows, so an INSERT never changes a
    row in place. A tree whose point source changed since its import (a plan
    coordinate replacing an inventory one, say) is brought in line by the
    UPDATE lines, which touch removal-plan rows only.
    """
    evidence = code_for_slug("evidence", "official-document")
    plan_sources = sorted({code_for_slug("sources", slug) for slug in SOURCE_SLUGS.values()})
    lines = [
        "-- Generated by `ttw-pipelines removal-plans`; do not edit by hand.",
        "-- Parks Office removal and transplant plans, one report per tree.",
        "-- Rows already imported are skipped through the unique index on external_ref.",
    ]
    for report in reports:
        values = ", ".join(
            [
                _sql_text(report.id),
                _sql_number(report.lat),
                _sql_number(report.lng),
                _sql_text(report.species),
                _sql_text(json.dumps(report.causes, separators=(",", ":"))),
                "'[]'",
                str(evidence),
                str(code_for_slug("sources", report.source)),
                _sql_text(report.note),
                _sql_text(report.link),
                _sql_text(report.observed_at),
                "NULL",
                _sql_text(report.inventory_tree_id),
                _sql_text(report.external_ref),
                "0",
                "NULL",
                "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
            ]
        )
        lines.append(
            "INSERT OR IGNORE INTO reports (id, lat, lng, species, causes, dispositions, "
            "evidence, source, note, link, observed_at, protected_tree_id, inventory_tree_id, "
            f"external_ref, status, reporter_hash, created_at) VALUES ({values});"
        )
    by_source: dict[int, list[str]] = {}
    for report in reports:
        by_source.setdefault(code_for_slug("sources", report.source), []).append(
            report.external_ref
        )
    for code, refs in sorted(by_source.items()):
        listed = ", ".join(_sql_text(ref) for ref in sorted(refs))
        lines.append(
            f"UPDATE reports SET source = {code} WHERE source IN "
            f"({', '.join(str(entry) for entry in plan_sources)}) AND source <> {code} "
            f"AND external_ref IN ({listed});"
        )
    return "\n".join(lines) + "\n"


def _load_inventory_missing(path: Path) -> dict[str, str]:
    """external_ref -> inventory date, for tagged plan trees missing from the inventory.

    `inventory.json` is written by the plan-inventory join; without it no tree
    is reported missing.
    """
    if not path.exists():
        return {}
    document = json.loads(path.read_text(encoding="utf-8"))
    columns = document["columns"]
    date = document["inventory_date"]
    missing = {}
    for row in document["rows"]:
        entry = dict(zip(columns, row, strict=True))
        if not entry["in_inventory"]:
            missing[entry["external_ref"]] = date
    return missing


def index_document(
    plans: dict,
    reports: list[Report],
    missing: dict[str, str] | None = None,
    sites: list[list[Any]] | None = None,
) -> dict[str, Any]:
    """What the web app needs to name a plan on the card, keyed by report id.

    `sites` are the summary points of trees without a point of their own, in
    `plan_sites.SITE_COLUMNS` order; their cases are named like the reports'.
    """
    missing = missing or {}
    sites = sites or []
    case_column = plan_sites.SITE_COLUMNS.index("case")
    used = {report.case for report in reports} | {site[case_column] for site in sites}
    return {
        "schema": SCHEMA,
        "source": SOURCE,
        "cases": {
            entry["case"]: {
                "title": entry["title"],
                "status": entry["status"],
                "posted_at": entry["posted_at"],
                "url": entry["url"],
            }
            for entry in plans["cases"]
            if entry["case"] in used
        },
        "columns": list(INDEX_COLUMNS),
        "rows": [
            [report.id, report.case, report.action, missing.get(report.external_ref)]
            for report in reports
        ],
        "site_columns": list(plan_sites.SITE_COLUMNS),
        "sites": sites,
    }


def run(
    *,
    out_dir: Path = DEFAULT_OUT_DIR,
    input_dir: Path | None = None,
    extracted_at: str | None = None,
) -> dict[str, Any]:
    """Curate (when an input directory is given), then build every output."""
    plans_path = out_dir / PLANS_FILENAME
    out_dir.mkdir(parents=True, exist_ok=True)
    if input_dir is not None:
        stamp = extracted_at or datetime.now(TAIPEI).strftime("%Y-%m-%d")
        plans = curate(
            _read_csv(input_dir / TREES_CSV), _read_csv(input_dir / CASES_CSV), extracted_at=stamp
        )
        plans_path.write_text(dumps(plans, _LINE_PER_ITEM_KEYS), encoding="utf-8")
    plans = json.loads(plans_path.read_text(encoding="utf-8"))

    result = build(plans, _load_coordinates(out_dir / COORDINATES_FILENAME))
    reports: list[Report] = result["reports"]
    missing = _load_inventory_missing(out_dir / INVENTORY_FILENAME)
    sites = plan_sites.group(
        plan_sites.load_sites(out_dir / plan_sites.SITES_FILENAME),
        result["trees"],
        known_cases={entry["case"] for entry in plans["cases"]},
        bbox=load_bbox(),
        missing=missing,
    )
    membership: dict[str, str] = sites["membership"]

    (out_dir / IMPORT_FILENAME).write_text(import_sql(reports), encoding="utf-8")
    (out_dir / INDEX_FILENAME).write_text(
        dumps(
            index_document(
                plans,
                reports,
                missing,
                sites["rows"],
            ),
            _LINE_PER_ITEM_KEYS,
        ),
        encoding="utf-8",
    )
    pending_counts: dict[str, int] = {}
    for row in result["pending"]:
        pending_counts[row[-1]] = pending_counts.get(row[-1], 0) + 1
    (out_dir / PENDING_FILENAME).write_text(
        dumps(
            {
                "schema": SCHEMA,
                "count": len(result["pending"]),
                "by_reason": dict(sorted(pending_counts.items())),
                "on_site": len(membership),
                "columns": list(PENDING_FILE_COLUMNS),
                "rows": [[*row, membership.get(row[0])] for row in result["pending"]],
            },
            _LINE_PER_ITEM_KEYS,
        ),
        encoding="utf-8",
    )
    (out_dir / REVIEW_FILENAME).write_text(
        dumps(
            {
                "schema": SCHEMA,
                "shared_coordinates": result["shared"],
                "covered": result["covered"],
            },
            _LINE_PER_ITEM_KEYS,
        ),
        encoding="utf-8",
    )
    return {
        "out_dir": out_dir,
        "trees": len(plans["rows"]),
        "imported": len(reports),
        "pending": len(result["pending"]),
        "pending_by_reason": pending_counts,
        "sites": len(sites["rows"]),
        "on_site": len(membership),
        "covered": len(result["covered"]),
        "shared_coordinates": len(result["shared"]),
    }
