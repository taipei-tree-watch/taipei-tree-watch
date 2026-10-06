import json
from pathlib import Path

import pytest

from ttw_pipelines import plan_inventory, removal_plans
from ttw_pipelines.plan_inventory import (
    REJECT_DOUBTFUL,
    REJECT_SHARED_TAG,
    REJECT_SPECIES,
    Inventory,
    InventoryTree,
    join,
    merge_coordinates,
    parse_inventory,
    species_agree,
)
from ttw_pipelines.removal_plans import curate, twd97_to_wgs84
from ttw_pipelines.shared import code_for_slug

FIXTURES = Path(__file__).parent / "fixtures" / "removal-plans"

STREET_HEADER = (
    "TreeID,Dist,Region,RegionRemark,TreeType,Diameter,TreeHeight,SurveyDate,TWD97X,TWD97Y,UpdDate"
)
PARK_HEADER = "TreeID,Dist,ParkName,TreeType,Diameter,TreeHeight,TWD97X,TWD97Y,SurveyDate,UpdDate"

# Tags of the plan trees added below; A10 in the fixture is SY1680021119.
GOOD = "NH0815000101"
MISMATCH = "NH0815000114"
SHARED = "NH0815000122"
ABSENT = "JS0760011227"
PLACED_TAG = "SY1680021119"

REF_A10 = "pkl:removal_AAAA:0:A10"


def ref(plan_no: str) -> str:
    return f"pkl:transplant_BBBB:0:{plan_no}"


def tree(plan_no: str, tag: str, species: str) -> dict[str, str]:
    row = {column: "" for column in removal_plans.TREE_COLUMNS}
    row.update(
        case="transplant_BBBB",
        doc="raw/transplant_BBBB_0.pdf",
        plan_no=plan_no,
        tree_tag=tag,
        species=species,
        action="transplant",
        location="內湖區瑞光公園",
    )
    return row


@pytest.fixture
def plans() -> dict:
    trees = removal_plans._read_csv(FIXTURES / "trees_2026.csv")
    trees += [
        tree("P1", GOOD.lower().capitalize(), "臺灣海棗"),
        tree("P2", MISMATCH, "羅漢松"),
        tree("P3", SHARED, "臺灣海棗"),
        tree("P4", SHARED, "臺灣海棗"),
        tree("P5", ABSENT, "榕樹"),
    ]
    cases = removal_plans._read_csv(FIXTURES / "cases_2026.csv")
    return curate(trees, cases, extracted_at="2026-09-28")


def inventory_of(*trees: InventoryTree) -> Inventory:
    return Inventory(
        {entry.tag: entry for entry in trees},
        {
            "TaipeiTree.csv": {"trees": len(trees), "updated": "2026-10-05"},
            "TaipeiParkTree.csv": {"trees": 0, "updated": "2026-07-14"},
        },
    )


INVENTORY = inventory_of(
    InventoryTree(GOOD, "海棗", 307000.0, 2774000.0),
    InventoryTree(MISMATCH, "海棗", 307010.0, 2774010.0),
    InventoryTree(SHARED, "海棗", 307020.0, 2774020.0),
)


# --- species ---------------------------------------------------------------


@pytest.mark.parametrize(
    ("plan", "inventory"),
    [
        ("台灣欒樹", "臺灣欒樹"),
        ("臺灣海棗", "海棗"),
        ("台灣櫸", "櫸"),
        ("玉蘭", "白玉蘭"),
        ("艷紫荊", "豔紫荊"),
        ("檬果", "芒果"),
        ("雞蛋花", "緬梔花"),
        ("榕", "榕樹"),
        ("", "榕樹"),
    ],
)
def test_spelling_variants_and_common_names_agree(plan: str, inventory: str) -> None:
    assert species_agree(plan, inventory)


@pytest.mark.parametrize(
    ("plan", "inventory"),
    [("小葉欖仁", "紫薇"), ("羅漢松", "海棗"), ("鐵刀木", "盾柱木"), ("黑板樹", "水黃皮")],
)
def test_different_species_disagree(plan: str, inventory: str) -> None:
    assert not species_agree(plan, inventory)


# --- reading the inventory -------------------------------------------------


def test_inventory_rows_are_read_by_column_name_with_tags_upper_cased() -> None:
    text = "\n".join(
        [
            PARK_HEADER,
            "sl0015101001,士林區,天母公園,欖仁,14.1,6.4,303578.96,2780328.94,"
            "2023-08-07,2026-07-14 17:10:04",
            "SL0015101002,士林區,天母公園,山櫻花,6.1,4.2,,,2023-08-07,2026-07-14 17:10:04",
        ]
    )
    trees, facts = parse_inventory("TaipeiParkTree.csv", text)
    assert trees == [InventoryTree("SL0015101001", "欖仁", 303578.96, 2780328.94)]
    assert facts == {"trees": 2, "updated": "2026-07-14"}


def test_inventory_without_a_version_date_is_refused() -> None:
    text = (
        STREET_HEADER
        + "\nBT0614021096,士林區,文林路,東側,榕樹,54,16,2022-11-18,302404.92,2777358.41,"
    )
    with pytest.raises(ValueError, match="UpdDate"):
        parse_inventory("TaipeiTree.csv", text)


def test_the_inventory_date_is_the_newest_file_version() -> None:
    assert INVENTORY.date == "2026-10-05"


# --- the join --------------------------------------------------------------


def test_a_pending_tree_gets_the_inventory_point_of_its_tag(plans) -> None:
    result = join(plans, INVENTORY)
    lat, lng = twd97_to_wgs84(307000.0, 2774000.0)
    assert result["coordinates"] == {ref("P1"): {"lat": lat, "lng": lng, "via": "inventory"}}


def test_species_mismatch_and_shared_tags_are_not_placed_but_listed(plans) -> None:
    rejected = {row[0]: row for row in join(plans, INVENTORY)["rejected"]}
    assert rejected == {
        ref("P2"): [ref("P2"), MISMATCH, REJECT_SPECIES, "羅漢松", "海棗"],
        ref("P3"): [ref("P3"), SHARED, REJECT_SHARED_TAG, "臺灣海棗", "海棗"],
        ref("P4"): [ref("P4"), SHARED, REJECT_SHARED_TAG, "臺灣海棗", "海棗"],
    }


def test_presence_covers_every_parks_office_tag_placed_or_pending(plans) -> None:
    presence = {row[0]: row for row in join(plans, INVENTORY)["presence"]}
    assert presence[REF_A10] == [REF_A10, PLACED_TAG, False]
    assert presence[ref("P1")] == [ref("P1"), GOOD, True]
    assert presence[ref("P5")] == [ref("P5"), ABSENT, False]
    # School numbering (T1: 333501-126306) is not a Parks Office tag.
    assert ref("T1") not in presence
    assert len(presence) == 6


def test_a_tree_the_plan_already_places_keeps_its_plan_point(plans) -> None:
    inventory = inventory_of(InventoryTree(PLACED_TAG, "黑板樹", 300000.0, 2770000.0))
    result = join(plans, inventory)
    assert REF_A10 not in result["coordinates"]
    assert [row for row in result["presence"] if row[0] == REF_A10] == [[REF_A10, PLACED_TAG, True]]


def test_merge_replaces_inventory_entries_and_keeps_other_sources() -> None:
    existing = {
        "schema": 1,
        "coordinates": {
            "pkl:a:0:1": {"lat": 25.0, "lng": 121.5, "via": "geocode"},
            "pkl:a:0:2": {"lat": 25.0, "lng": 121.5, "via": "inventory"},
        },
    }
    found = {"pkl:a:0:3": {"lat": 25.1, "lng": 121.6, "via": "inventory"}}
    assert merge_coordinates(existing, found) == {
        "schema": 1,
        "coordinates": {
            "pkl:a:0:1": {"lat": 25.0, "lng": 121.5, "via": "geocode"},
            "pkl:a:0:3": {"lat": 25.1, "lng": 121.6, "via": "inventory"},
        },
    }


# --- end to end ------------------------------------------------------------


def write_inventory(directory: Path) -> None:
    directory.mkdir()
    (directory / "TaipeiTree.csv").write_text(
        "﻿"
        + STREET_HEADER
        + f"\n{GOOD},內湖區,瑞光路,,海棗,30,8,2022-11-18,307000,2774000,2026-10-05 10:16:37\n",
        encoding="utf-8",
    )
    (directory / "TaipeiParkTree.csv").write_text(
        "﻿"
        + PARK_HEADER
        + f"\n{SHARED},內湖區,瑞光公園,海棗,30,8,307020,2774020,2023-08-07,2026-07-14 17:10:04\n",
        encoding="utf-8",
    )


def test_run_places_by_tag_and_marks_missing_tags_on_the_index(tmp_path: Path, plans) -> None:
    out = tmp_path / "out"
    out.mkdir()
    (out / removal_plans.PLANS_FILENAME).write_text(json.dumps(plans), encoding="utf-8")
    write_inventory(tmp_path / "cache")

    summary = plan_inventory.run(inventory_dir=tmp_path / "cache", out_dir=out)
    assert summary["filled"] == 1
    assert summary["missing"] == 3  # A10, P2 and P5
    assert summary["missing_placed"] == 1  # A10
    first = (out / removal_plans.COORDINATES_FILENAME).read_text(encoding="utf-8")

    removal_plans.run(out_dir=out)
    index = json.loads((out / removal_plans.INDEX_FILENAME).read_text(encoding="utf-8"))
    assert index["columns"] == ["id", "case", "action", "inventory_gone"]
    gone = {row[0]: row[3] for row in index["rows"]}
    a10 = removal_plans.report_id(REF_A10, "2026-09-23")
    p1 = removal_plans.report_id(ref("P1"), "2026-04-17")
    assert gone[a10] == "2026-10-05"
    assert gone[p1] is None

    sql = (out / removal_plans.IMPORT_FILENAME).read_text(encoding="utf-8")
    p1_line = next(line for line in sql.splitlines() if ref("P1") in line)
    assert removal_plans.NOTE_COORDINATE_VIA["inventory"] in p1_line
    assert f"'{GOOD}'" in p1_line
    inventory_source = code_for_slug("sources", "removal-plan-inventory")
    assert f"'[]', 3, {inventory_source}, " in p1_line

    plan_inventory.run(inventory_dir=tmp_path / "cache", out_dir=out)
    assert (out / removal_plans.COORDINATES_FILENAME).read_text(encoding="utf-8") == first
    assert json.loads(first)["coordinates"][ref("P1")]["via"] == "inventory"


def test_without_an_inventory_check_no_tree_is_marked_missing(tmp_path: Path, plans) -> None:
    (tmp_path / removal_plans.PLANS_FILENAME).write_text(json.dumps(plans), encoding="utf-8")
    removal_plans.run(out_dir=tmp_path)
    index = json.loads((tmp_path / removal_plans.INDEX_FILENAME).read_text(encoding="utf-8"))
    assert {row[3] for row in index["rows"]} == {None}


def test_a_doubtful_tag_is_not_placed_and_is_listed(plans, monkeypatch) -> None:
    monkeypatch.setitem(removal_plans.DOUBTFUL_TAGS, ref("P1"), "inventory point is elsewhere")
    result = join(plans, INVENTORY)
    assert ref("P1") not in result["coordinates"]
    rejected = {row[0]: row for row in result["rejected"]}
    assert rejected[ref("P1")] == [ref("P1"), GOOD, REJECT_DOUBTFUL, "臺灣海棗", "海棗"]


def test_doubtful_tags_name_known_plan_trees_and_say_why() -> None:
    plans = json.loads(
        (removal_plans.DEFAULT_OUT_DIR / removal_plans.PLANS_FILENAME).read_text(encoding="utf-8")
    )
    refs = {removal_plans.external_ref(row[0], row[1], row[2]) for row in plans["rows"]}
    for doubtful, why in removal_plans.DOUBTFUL_TAGS.items():
        assert doubtful in refs
        assert why.strip()
