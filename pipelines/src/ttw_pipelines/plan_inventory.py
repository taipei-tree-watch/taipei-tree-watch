"""Join the removal and transplant plans against the Parks Office inventory.

The inventory (data.taipei "臺北市行道樹及公園樹木分布圖": TaipeiTree.csv for
street trees, TaipeiParkTree.csv for park trees) lists each tree by its tag
id with a TWD97 coordinate, and has no status column. Many plan trees carry
the same tag, which gives two things:

* a coordinate for plan trees whose plan prints none, written to
  `coordinates.json` with `via` = "inventory" for the removal-plans build;
* whether each tagged plan tree is still in the inventory, written to
  `inventory.json`. A tag missing from the inventory is only a signal: the
  tree may be gone, renumbered, or the record corrected.

A tag is used for a coordinate only when the inventory's species agrees with
the plan's, no other plan tree claims the same tag, and the tree is not in
`removal_plans.DOUBTFUL_TAGS`; the rest stay pending and are listed under
`rejected`.

The raw CSVs are about 19 MB and are not committed. data.taipei's certificate
chain fails Python's strict X.509 check, so they are downloaded with curl and
the directory holding them is passed in.
"""

from __future__ import annotations

import csv
import io
import json
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ttw_pipelines import removal_plans
from ttw_pipelines.protected_trees import dumps

SCHEMA = 1
SOURCE = "臺北市政府工務局公園路燈工程管理處 臺北市行道樹及公園樹木分布圖"
INVENTORY_FILES = ("TaipeiTree.csv", "TaipeiParkTree.csv")
VIA = "inventory"

PRESENCE_COLUMNS = ["external_ref", "tree_tag", "in_inventory"]
REJECTED_COLUMNS = ["external_ref", "tree_tag", "why", "plan_species", "inventory_species"]

REJECT_SPECIES = "species-mismatch"
REJECT_SHARED_TAG = "shared-tag"
REJECT_DOUBTFUL = "doubtful-tag"

# Pending reasons a coordinate from the inventory may resolve. A plan point
# outside the BBOX is the plan's own coordinate and is not overridden.
FILLABLE = frozenset({removal_plans.PENDING_NO_COORDINATE, removal_plans.PENDING_PLACEHOLDER})

# Spelling variants between the plans and the inventory: 台/臺 and 艷/豔.
_CHARACTER_VARIANTS = str.maketrans({"台": "臺", "艷": "豔"})

# Common names for one species that share no characters.
_SPECIES_SYNONYMS = {"檬果": "芒果", "雞蛋花": "緬梔花"}

_LINE_PER_ITEM_KEYS = frozenset({"rows", "rejected"})


@dataclass(frozen=True)
class InventoryTree:
    tag: str
    species: str
    x: float
    y: float


@dataclass(frozen=True)
class Inventory:
    trees: dict[str, InventoryTree]
    # Per file: tree count and the newest UpdDate (YYYY-MM-DD).
    files: dict[str, dict[str, Any]]

    @property
    def date(self) -> str:
        """The newest version date across the files: what "current" means here."""
        return max(entry["updated"] for entry in self.files.values())


def parse_inventory(name: str, text: str) -> tuple[list[InventoryTree], dict[str, Any]]:
    """Trees of one inventory CSV with a numeric coordinate, plus file facts."""
    trees = []
    updated = ""
    rows = 0
    for row in csv.DictReader(io.StringIO(text)):
        rows += 1
        updated = max(updated, (row.get("UpdDate") or "").strip()[:10])
        tag = (row.get("TreeID") or "").strip().upper()
        try:
            x, y = float(row["TWD97X"]), float(row["TWD97Y"])
        except (KeyError, TypeError, ValueError):
            continue
        if tag:
            trees.append(InventoryTree(tag, (row.get("TreeType") or "").strip(), x, y))
    if not updated:
        raise ValueError(f"{name}: no UpdDate, cannot tell which version this is")
    return trees, {"trees": rows, "updated": updated}


def read_inventory(directory: Path) -> Inventory:
    trees: dict[str, InventoryTree] = {}
    files = {}
    for name in INVENTORY_FILES:
        text = (directory / name).read_bytes().decode("utf-8-sig")
        parsed, facts = parse_inventory(name, text)
        for tree in parsed:
            trees.setdefault(tree.tag, tree)
        files[name] = facts
    return Inventory(trees, files)


def _species_key(name: str) -> str:
    text = "".join(name.split()).translate(_CHARACTER_VARIANTS)
    text = _SPECIES_SYNONYMS.get(text, text)
    return text[:-1] if len(text) > 1 and text.endswith("樹") else text


def species_agree(plan: str, inventory: str) -> bool:
    """Whether two species names plausibly name one tree.

    A name that ends the other counts as agreeing: the inventory writes 海棗
    for the plans' 臺灣海棗 and 櫸 for 臺灣櫸. A missing name cannot disagree.
    """
    a, b = _species_key(plan), _species_key(inventory)
    if not a or not b:
        return True
    return a == b or a.endswith(b) or b.endswith(a)


def join(plans: dict, inventory: Inventory) -> dict[str, Any]:
    """Presence of every tagged plan tree, and coordinates for the fillable ones."""
    built = removal_plans.build(plans)
    fillable = {row[0] for row in built["pending"] if row[-1] in FILLABLE}
    placed = {report.external_ref for report in built["reports"]}
    covered = {pair[0] for pair in built["covered"]}

    tagged: list[tuple[str, str, str]] = []
    for row in plans["rows"]:
        tree = dict(zip(plans["columns"], row, strict=True))
        ref = removal_plans.external_ref(tree["case"], tree["doc"], tree["plan_no"])
        tag = removal_plans.inventory_tag(tree["tree_tag"])
        if tag is None or ref in covered:
            continue
        tagged.append((ref, tag, tree["species"]))
    claims = Counter(tag for _, tag, _ in tagged)

    presence = []
    rejected = []
    coordinates = {}
    for ref, tag, species in sorted(tagged):
        found = inventory.trees.get(tag)
        presence.append([ref, tag, found is not None])
        if found is None or ref not in fillable:
            continue
        why = None
        if ref in removal_plans.DOUBTFUL_TAGS:
            why = REJECT_DOUBTFUL
        elif claims[tag] > 1:
            why = REJECT_SHARED_TAG
        elif not species_agree(species, found.species):
            why = REJECT_SPECIES
        if why is not None:
            rejected.append([ref, tag, why, species or None, found.species or None])
            continue
        lat, lng = removal_plans.twd97_to_wgs84(found.x, found.y)
        coordinates[ref] = {"lat": lat, "lng": lng, "via": VIA}

    return {
        "presence": presence,
        "rejected": rejected,
        "coordinates": coordinates,
        "fillable": len(fillable),
        "placed_refs": placed,
    }


def merge_coordinates(existing: dict | None, found: dict[str, dict]) -> dict:
    """Replace the inventory entries of coordinates.json, keep those from other sources."""
    kept = {
        ref: entry
        for ref, entry in ((existing or {}).get("coordinates", {})).items()
        if entry.get("via") != VIA
    }
    merged = {**kept, **found}
    return {"schema": SCHEMA, "coordinates": dict(sorted(merged.items()))}


def coordinates_text(document: dict) -> str:
    """coordinates.json with one tree per line, so a rerun diffs line by line."""
    entries = [
        f"  {json.dumps(ref, ensure_ascii=False)}: "
        + json.dumps(entry, ensure_ascii=False, separators=(",", ":"))
        for ref, entry in document["coordinates"].items()
    ]
    body = "{\n" + ",\n".join(entries) + "\n }" if entries else "{}"
    return f'{{\n "schema": {document["schema"]},\n "coordinates": {body}\n}}\n'


def inventory_document(inventory: Inventory, result: dict[str, Any]) -> dict[str, Any]:
    present = sum(1 for row in result["presence"] if row[2])
    return {
        "schema": SCHEMA,
        "source": SOURCE,
        "inventory_date": inventory.date,
        "files": inventory.files,
        "tagged": len(result["presence"]),
        "in_inventory": present,
        "missing": len(result["presence"]) - present,
        "columns": list(PRESENCE_COLUMNS),
        "rows": result["presence"],
        "rejected_columns": list(REJECTED_COLUMNS),
        "rejected": result["rejected"],
    }


def run(*, inventory_dir: Path, out_dir: Path = removal_plans.DEFAULT_OUT_DIR) -> dict[str, Any]:
    """Join, write coordinates.json and inventory.json, then rebuild the plan outputs."""
    plans = json.loads((out_dir / removal_plans.PLANS_FILENAME).read_text(encoding="utf-8"))
    inventory = read_inventory(inventory_dir)
    result = join(plans, inventory)

    coordinates_path = out_dir / removal_plans.COORDINATES_FILENAME
    existing = (
        json.loads(coordinates_path.read_text(encoding="utf-8"))
        if coordinates_path.exists()
        else None
    )
    coordinates_path.write_text(
        coordinates_text(merge_coordinates(existing, result["coordinates"])), encoding="utf-8"
    )
    document = inventory_document(inventory, result)
    (out_dir / removal_plans.INVENTORY_FILENAME).write_text(
        dumps(document, _LINE_PER_ITEM_KEYS), encoding="utf-8"
    )
    return {
        "inventory_date": inventory.date,
        "inventory_trees": len(inventory.trees),
        "tagged": document["tagged"],
        "missing": document["missing"],
        "missing_placed": sum(
            1
            for ref, _, present in result["presence"]
            if not present and ref in result["placed_refs"]
        ),
        "fillable": result["fillable"],
        "filled": len(result["coordinates"]),
        "rejected": Counter(row[2] for row in result["rejected"]),
    }
