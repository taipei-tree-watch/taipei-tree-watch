"""Site summary points for plan trees that have no point of their own.

Most pending plan trees carry only a site-level location such as
「內湖區瑞光公園」 or 「東機廠基地」: the plan says which site, not where in it.
Rather than stacking one invented point per tree, each site gets one summary
point chosen by hand in `sites.json`, and the trees of that case listed at
that location become its members.

`sites.json` is a committed input:

    {"schema": 1, "sites": [{"id": "cf720-ruiguang-park",
      "case": "removal_46B5198DD00B117C", "locations": ["內湖區瑞光公園"],
      "lat": 25.07065, "lng": 121.57833, "via": "park-centroid",
      "how": "Median of the 691 inventory trees of 瑞光公園"}]}

A pending tree is a member when its case matches and its location text is
one of the site's `locations`, exactly. Species and causes are counted per
tree, so the card can say how many of the site's trees each one concerns.
`inventory_gone` is `[count, inventory date]` when members' tags have left
the Parks Office inventory, else null: a signal only, as on a tree's card.
Trees of the same case and location that already have a point of their own
are counted as `placed`, so the card can say how many more of that site's
trees are drawn one by one. Members stay out of `import.sql`: a site is an
aggregate of official records, not a report.
"""

from __future__ import annotations

import json
import re
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any

SCHEMA = 1
SITES_FILENAME = "sites.json"

SITE_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,47}$")

# How the point was chosen. The card turns this into a sentence, so a new
# method needs a string in the web app as well.
VIA = (
    "park-centroid",
    "school-centroid",
    "site-centroid",
    "placed-trees",
    "road-segment",
    "intersection",
    "address",
    "site-plan",
)

SITE_COLUMNS = [
    "id",
    "case",
    "lat",
    "lng",
    "via",
    "locations",
    "remove",
    "transplant",
    "species",
    "placed",
    "causes",
    "inventory_gone",
]


@dataclass(frozen=True)
class Site:
    id: str
    case: str
    locations: tuple[str, ...]
    lat: float
    lng: float
    via: str


@dataclass(frozen=True)
class PlanTree:
    """What the site grouping needs to know about one curated plan tree."""

    external_ref: str
    case: str
    location: str | None
    species: str | None
    action: str
    causes: tuple[int, ...]
    placed: bool


def load_sites(path: Path) -> list[Site]:
    """The curated sites, or none when the file does not exist."""
    if not path.exists():
        return []
    document = json.loads(path.read_text(encoding="utf-8"))
    if document.get("schema") != SCHEMA:
        raise ValueError(f"{path.name}: unsupported schema {document.get('schema')!r}")
    sites = []
    for entry in document["sites"]:
        site_id = entry["id"]
        if not isinstance(site_id, str) or not SITE_ID_RE.match(site_id):
            raise ValueError(f"site id must be lower case letters, digits and '-': {site_id!r}")
        if entry["via"] not in VIA:
            raise ValueError(f"{site_id}: unknown point method {entry['via']!r}")
        locations = tuple(entry["locations"])
        if not locations or not all(isinstance(text, str) and text for text in locations):
            raise ValueError(f"{site_id}: locations must be a non-empty list of texts")
        if not isinstance(entry.get("how"), str) or not entry["how"].strip():
            raise ValueError(f"{site_id}: say how the point was chosen in 'how'")
        sites.append(
            Site(
                id=site_id,
                case=entry["case"],
                locations=locations,
                lat=round(float(entry["lat"]), 5),
                lng=round(float(entry["lng"]), 5),
                via=entry["via"],
            )
        )
    return sites


def _species_breakdown(members: list[PlanTree]) -> list[list[Any]]:
    """[[species, count], ...], most frequent first; an unnamed species is null and last."""
    counts = Counter(member.species for member in members)
    named = sorted(
        ((name, count) for name, count in counts.items() if name is not None),
        key=lambda item: (-item[1], item[0]),
    )
    rows: list[list[Any]] = [[name, count] for name, count in named]
    if None in counts:
        rows.append([None, counts[None]])
    return rows


def group(
    sites: list[Site],
    trees: list[PlanTree],
    *,
    known_cases: set[str],
    bbox: tuple[float, float, float, float],
    missing: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Assign pending trees to sites and summarise each site.

    Returns `rows` (one per site, in SITE_COLUMNS order) and `membership`
    (external_ref -> site id). A site that names an unknown case, lies outside
    the BBOX, or has no pending tree at all is an error, and so is a tree that
    two sites claim: each of these means sites.json no longer matches the plans.
    `missing` maps the external_ref of a tree whose tag left the inventory to
    the inventory date.
    """
    missing = missing or {}
    min_lng, min_lat, max_lng, max_lat = bbox
    seen_ids: set[str] = set()
    claimed: dict[tuple[str, str], str] = {}
    for site in sites:
        if site.id in seen_ids:
            raise ValueError(f"site id used twice: {site.id}")
        seen_ids.add(site.id)
        if site.case not in known_cases:
            raise ValueError(f"{site.id}: unknown case {site.case}")
        if not (min_lat <= site.lat <= max_lat and min_lng <= site.lng <= max_lng):
            raise ValueError(f"{site.id}: point is outside the BBOX")
        for location in site.locations:
            key = (site.case, location)
            if key in claimed:
                raise ValueError(f"{site.id} and {claimed[key]} both claim {location!r}")
            claimed[key] = site.id

    members: dict[str, list[PlanTree]] = {site.id: [] for site in sites}
    placed: Counter[str] = Counter()
    membership: dict[str, str] = {}
    for tree in trees:
        if tree.location is None:
            continue
        site_id = claimed.get((tree.case, tree.location))
        if site_id is None:
            continue
        if tree.placed:
            placed[site_id] += 1
            continue
        members[site_id].append(tree)
        membership[tree.external_ref] = site_id

    rows = []
    for site in sorted(sites, key=lambda entry: entry.id):
        group_members = members[site.id]
        if not group_members:
            raise ValueError(f"{site.id}: no pending tree of {site.case} is at {site.locations}")
        actions = Counter(member.action for member in group_members)
        causes = Counter(code for member in group_members for code in member.causes)
        gone = [
            missing[member.external_ref]
            for member in group_members
            if member.external_ref in missing
        ]
        rows.append(
            [
                site.id,
                site.case,
                site.lat,
                site.lng,
                site.via,
                list(site.locations),
                actions.get("remove", 0),
                actions.get("transplant", 0),
                _species_breakdown(group_members),
                placed[site.id],
                [[code, count] for code, count in sorted(causes.items())],
                [len(gone), max(gone)] if gone else None,
            ]
        )
    return {"rows": rows, "membership": membership}
