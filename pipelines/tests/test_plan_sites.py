import json
from pathlib import Path

import pytest

from ttw_pipelines import plan_sites, removal_plans
from ttw_pipelines.plan_sites import SITE_COLUMNS, PlanTree, Site, group, load_sites
from ttw_pipelines.removal_plans import PENDING_FILE_COLUMNS, curate, run
from ttw_pipelines.shared import load_bbox

FIXTURES = Path(__file__).parent / "fixtures" / "removal-plans"
BBOX = (121.43, 24.94, 121.68, 25.24)


def tree(ref: str, location: str | None = "A 公園", **fields) -> PlanTree:
    values = {
        "external_ref": ref,
        "case": "removal_X",
        "location": location,
        "species": "榕樹",
        "action": "remove",
        "causes": (20,),
        "placed": False,
        **fields,
    }
    return PlanTree(**values)


def site(**fields) -> Site:
    values = {
        "id": "x-park",
        "case": "removal_X",
        "locations": ("A 公園",),
        "lat": 25.05,
        "lng": 121.55,
        "via": "park-centroid",
        **fields,
    }
    return Site(**values)


def as_dict(row: list) -> dict:
    return dict(zip(SITE_COLUMNS, row, strict=True))


def sites_document(*entries: dict) -> str:
    return json.dumps({"schema": 1, "sites": list(entries)}, ensure_ascii=False)


def entry(**fields) -> dict:
    return {
        "id": "x-park",
        "case": "removal_X",
        "locations": ["A 公園"],
        "lat": 25.05,
        "lng": 121.55,
        "via": "park-centroid",
        "how": "Median of the inventory trees of A 公園",
        **fields,
    }


# --- grouping ----------------------------------------------------------------


def test_pending_trees_at_a_site_location_become_its_members() -> None:
    trees = [
        tree("r1"),
        tree("r2", species="樟樹", action="transplant", causes=(1, 20)),
        tree("r3", species="榕樹"),
        tree("r4", location="B 路"),
        tree("r5", placed=True),
        tree("r6", case="removal_Y"),
    ]
    result = group([site()], trees, known_cases={"removal_X", "removal_Y"}, bbox=BBOX)
    assert result["membership"] == {"r1": "x-park", "r2": "x-park", "r3": "x-park"}
    row = as_dict(result["rows"][0])
    assert row["remove"] == 2
    assert row["transplant"] == 1
    assert row["placed"] == 1
    assert row["causes"] == [[1, 1], [20, 3]]
    assert row["species"] == [["榕樹", 2], ["樟樹", 1]]
    assert row["locations"] == ["A 公園"]
    assert (row["lat"], row["lng"], row["via"]) == (25.05, 121.55, "park-centroid")


def test_members_whose_tag_left_the_inventory_are_counted_as_a_signal() -> None:
    trees = [tree("r1"), tree("r2"), tree("r3", placed=True)]
    missing = {"r1": "2026-10-05", "r3": "2026-10-05"}
    rows = group([site()], trees, known_cases={"removal_X"}, bbox=BBOX, missing=missing)["rows"]
    assert as_dict(rows[0])["inventory_gone"] == [1, "2026-10-05"]
    rows = group([site()], trees, known_cases={"removal_X"}, bbox=BBOX)["rows"]
    assert as_dict(rows[0])["inventory_gone"] is None


def test_one_site_may_cover_several_location_texts() -> None:
    trees = [tree("r1"), tree("r2", location="A 公園人行道"), tree("r3", location="C 路")]
    result = group(
        [site(locations=("A 公園", "A 公園人行道"))], trees, known_cases={"removal_X"}, bbox=BBOX
    )
    assert set(result["membership"]) == {"r1", "r2"}


def test_species_breakdown_puts_the_unnamed_last_and_breaks_ties_by_name() -> None:
    trees = [
        tree("r1", species=None),
        tree("r2", species="樟樹"),
        tree("r3", species="榕樹"),
        tree("r4", species=None),
    ]
    row = as_dict(group([site()], trees, known_cases={"removal_X"}, bbox=BBOX)["rows"][0])
    assert row["species"] == [["榕樹", 1], ["樟樹", 1], [None, 2]]


def test_rows_are_ordered_by_site_id() -> None:
    trees = [tree("r1"), tree("r2", location="B 路")]
    sites = [site(id="z-road", locations=("B 路",)), site(id="a-park")]
    rows = group(sites, trees, known_cases={"removal_X"}, bbox=BBOX)["rows"]
    assert [row[0] for row in rows] == ["a-park", "z-road"]


@pytest.mark.parametrize(
    ("sites", "message"),
    [
        ([site(case="removal_Z")], "unknown case"),
        ([site(lat=24.5)], "outside the BBOX"),
        ([site(), site(id="other")], "both claim"),
        ([site(), site(locations=("B 路",))], "used twice"),
        ([site(locations=("Nowhere",))], "no pending tree"),
    ],
)
def test_sites_that_no_longer_match_the_plans_are_errors(sites, message) -> None:
    trees = [tree("r1"), tree("r2", location="B 路")]
    with pytest.raises(ValueError, match=message):
        group(sites, trees, known_cases={"removal_X"}, bbox=BBOX)


def test_a_site_whose_trees_all_have_points_is_an_error() -> None:
    with pytest.raises(ValueError, match="no pending tree"):
        group([site()], [tree("r1", placed=True)], known_cases={"removal_X"}, bbox=BBOX)


# --- sites.json ----------------------------------------------------------------


def test_missing_sites_file_means_no_sites(tmp_path: Path) -> None:
    assert load_sites(tmp_path / "sites.json") == []


def test_sites_file_is_read_and_rounded(tmp_path: Path) -> None:
    path = tmp_path / "sites.json"
    path.write_text(sites_document(entry(lat=25.0500049, locations=["A 公園", "A 公園內"])))
    [loaded] = load_sites(path)
    assert loaded == site(lat=25.05, locations=("A 公園", "A 公園內"))


@pytest.mark.parametrize(
    ("fields", "message"),
    [
        ({"id": "X Park"}, "site id"),
        ({"via": "guess"}, "unknown point method"),
        ({"locations": []}, "locations"),
        ({"how": " "}, "how the point was chosen"),
    ],
)
def test_malformed_sites_are_rejected(tmp_path: Path, fields, message) -> None:
    path = tmp_path / "sites.json"
    path.write_text(sites_document(entry(**fields)))
    with pytest.raises(ValueError, match=message):
        load_sites(path)


def test_unknown_schema_is_rejected(tmp_path: Path) -> None:
    path = tmp_path / "sites.json"
    path.write_text(json.dumps({"schema": 2, "sites": []}))
    with pytest.raises(ValueError, match="schema"):
        load_sites(path)


# --- the build with sites ---------------------------------------------------------


def fixture_sites() -> str:
    return sites_document(
        entry(id="aaaa-xinyi", case="removal_AAAA", locations=["信義區"], lat=25.033, lng=121.565),
        entry(
            id="bbbb-wenshan",
            case="transplant_BBBB",
            locations=["文山區"],
            lat=24.99,
            lng=121.55,
            via="placed-trees",
        ),
    )


def test_run_writes_sites_to_the_index_and_names_them_in_pending(tmp_path: Path) -> None:
    run(out_dir=tmp_path, input_dir=FIXTURES, extracted_at="2026-09-28")
    (tmp_path / "sites.json").write_text(fixture_sites(), encoding="utf-8")
    summary = run(out_dir=tmp_path)
    assert (summary["sites"], summary["on_site"]) == (2, 2)

    index = json.loads((tmp_path / "index.json").read_text(encoding="utf-8"))
    assert index["site_columns"] == SITE_COLUMNS
    sites = {row[0]: as_dict(row) for row in index["sites"]}
    xinyi = sites["aaaa-xinyi"]
    assert (xinyi["remove"], xinyi["transplant"], xinyi["placed"]) == (1, 0, 4)
    assert xinyi["species"] == [["樟樹", 1]]
    wenshan = sites["bbbb-wenshan"]
    assert (wenshan["remove"], wenshan["placed"]) == (1, 1)
    assert set(index["cases"]) >= {"removal_AAAA", "transplant_BBBB"}

    pending = json.loads((tmp_path / "pending.json").read_text(encoding="utf-8"))
    assert pending["columns"] == PENDING_FILE_COLUMNS
    assert pending["on_site"] == 2
    assert {row[0]: row[-1] for row in pending["rows"]} == {
        "pkl:removal_AAAA:0:A11": "aaaa-xinyi",
        "pkl:transplant_BBBB:0:T2": "bbbb-wenshan",
    }
    # Members are summarised, never inserted as reports.
    sql = (tmp_path / "import.sql").read_text(encoding="utf-8")
    assert "A11" not in sql
    assert "T2'" not in sql


def test_a_case_named_only_by_a_site_is_still_in_the_index() -> None:
    trees = removal_plans._read_csv(FIXTURES / "trees_2026.csv")
    cases = removal_plans._read_csv(FIXTURES / "cases_2026.csv")
    plans = curate(trees, cases, extracted_at="2026-09-28")
    built = removal_plans.build(plans)
    only_aaaa = [report for report in built["reports"] if report.case == "removal_AAAA"]
    rows = group(
        [site(id="b", case="transplant_BBBB", locations=("文山區",))],
        built["trees"],
        known_cases={"removal_AAAA", "transplant_BBBB"},
        bbox=load_bbox(),
    )["rows"]
    index = removal_plans.index_document(plans, only_aaaa, sites=rows)
    assert "transplant_BBBB" in index["cases"]


def test_run_with_sites_is_byte_stable(tmp_path: Path) -> None:
    run(out_dir=tmp_path, input_dir=FIXTURES, extracted_at="2026-09-28")
    (tmp_path / "sites.json").write_text(fixture_sites(), encoding="utf-8")
    run(out_dir=tmp_path)
    first = {path.name: path.read_bytes() for path in tmp_path.iterdir()}
    run(out_dir=tmp_path)
    second = {path.name: path.read_bytes() for path in tmp_path.iterdir()}
    assert first == second


def test_the_committed_sites_cover_every_pending_tree_they_claim() -> None:
    """sites.json and the committed outputs agree: every claimed tree is pending."""
    out = removal_plans.DEFAULT_OUT_DIR
    sites = load_sites(out / plan_sites.SITES_FILENAME)
    if not sites:
        pytest.skip("no sites.json committed")
    pending = json.loads((out / removal_plans.PENDING_FILENAME).read_text(encoding="utf-8"))
    on_site = [row for row in pending["rows"] if row[-1] is not None]
    assert pending["on_site"] == len(on_site)
    assert {row[-1] for row in on_site} == {entry.id for entry in sites}
