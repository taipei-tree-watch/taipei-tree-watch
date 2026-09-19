"""Read the shared definitions emitted by `npm run build:shared`.

The JSON files under `shared/generated/` are the Python-side view of the
TypeScript source of truth in `shared/`. Paths resolve relative to the
repository root, so this module expects to run from a checkout (the package is
installed in editable mode by `uv sync`).
"""

from __future__ import annotations

import json
from functools import cache
from pathlib import Path
from typing import Any, TypedDict

# src/ttw_pipelines/shared.py -> src/ttw_pipelines -> src -> pipelines -> repo root
REPO_ROOT = Path(__file__).resolve().parents[3]
GENERATED_DIR = REPO_ROOT / "shared" / "generated"


class Tag(TypedDict):
    code: int
    slug: str
    label: str


def _read_json(name: str) -> Any:
    path = GENERATED_DIR / name
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


@cache
def load_tags() -> dict[str, Any]:
    """Return the full contents of tags.json (causes, dispositions, evidence, sources, defaults)."""
    return _read_json("tags.json")


def tag_dimension(name: str) -> list[Tag]:
    """Return one tag dimension: "causes", "dispositions", "evidence" or "sources"."""
    return load_tags()[name]


def code_for_slug(dimension: str, slug: str) -> int:
    """Look up the integer code of a tag by its slug. Raises KeyError when the slug is unknown."""
    for tag in tag_dimension(dimension):
        if tag["slug"] == slug:
            return tag["code"]
    raise KeyError(f"unknown {dimension} slug: {slug}")


@cache
def load_link_domains() -> list[str]:
    """Return the link domain whitelist from domains.json."""
    return _read_json("domains.json")["domains"]


@cache
def load_snapshot_layout() -> dict[str, Any]:
    """Return the snapshot schema version and column order from snapshot.json."""
    return _read_json("snapshot.json")
