import json
import re
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path

import pytest
from pyproj import Transformer

from ttw_pipelines import removal_plans
from ttw_pipelines.removal_plans import (
    CROCKFORD,
    PENDING_COLUMNS,
    Placement,
    build,
    build_note,
    causes_for,
    curate,
    external_ref,
    import_sql,
    index_document,
    inventory_tag,
    report_id,
    roc_to_iso,
    run,
    twd97_to_wgs84,
)
from ttw_pipelines.shared import code_for_slug, load_bbox

FIXTURES = Path(__file__).parent / "fixtures" / "removal-plans"
ULID_RE = re.compile(r"^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$")


def cause(slug: str) -> int:
    return code_for_slug("causes", slug)


@pytest.fixture
def plans() -> dict:
    trees = removal_plans._read_csv(FIXTURES / "trees_2026.csv")
    cases = removal_plans._read_csv(FIXTURES / "cases_2026.csv")
    return curate(trees, cases, extracted_at="2026-09-28")


def by_ref(result: dict) -> dict:
    return {report.external_ref: report for report in result["reports"]}


def pending_by_ref(result: dict) -> dict:
    return {row[0]: dict(zip(PENDING_COLUMNS, row, strict=True)) for row in result["pending"]}


# --- conversions -----------------------------------------------------------


def test_roc_dates_become_iso_dates() -> None:
    assert roc_to_iso("115-09-23") == "2026-09-23"
    assert roc_to_iso("99-01-05") == "2010-01-05"
    with pytest.raises(ValueError):
        roc_to_iso("2026-09-23")


def test_twd97_central_meridian_maps_to_121_east() -> None:
    lat, lng = twd97_to_wgs84(250000, 2770000)
    assert lng == 121.0
    assert 25.0 < lat < 25.1


def test_twd97_point_round_trips_within_a_metre() -> None:
    lat, lng = twd97_to_wgs84(307367, 2769650)
    assert (lat, lng) == (round(lat, 5), round(lng, 5))
    back = Transformer.from_crs("EPSG:4326", "EPSG:3826", always_xy=True)
    x, y = back.transform(lng, lat)
    assert abs(x - 307367) < 1.5
    assert abs(y - 2769650) < 1.5
    assert removal_plans.in_bbox(lat, lng, load_bbox())


def test_external_ref_names_case_document_and_plan_number() -> None:
    assert external_ref("removal_X", "raw/removal_X_2.pdf", "216") == "pkl:removal_X:2:216"
    with pytest.raises(ValueError):
        external_ref("removal_X", "raw/removal_X.pdf", "216")


def test_report_id_is_a_stable_ulid_dated_by_posting_day() -> None:
    first = report_id("pkl:removal_X:0:A1", "2026-09-23")
    assert first == report_id("pkl:removal_X:0:A1", "2026-09-23")
    assert first != report_id("pkl:removal_X:0:A2", "2026-09-23")
    assert ULID_RE.match(first)
    millis = 0
    for char in first[:10]:
        millis = millis * 32 + CROCKFORD.index(char)
    moment = datetime.fromtimestamp(millis / 1000, UTC).astimezone(timezone(timedelta(hours=8)))
    assert moment.strftime("%Y-%m-%d %H:%M") == "2026-09-23 00:00"


def test_causes_come_from_reason_words_and_the_works_in_the_title() -> None:
    assert causes_for("主幹明顯腐朽，有傾倒之虞", "捷運環狀線移除計畫") == sorted(
        [cause("decay-cavity"), cause("fall-risk"), cause("mrt-construction")]
    )
    assert causes_for("罹患褐根病", "某某道路工程") == [
        cause("brown-root-rot"),
        cause("road-construction"),
    ]
    assert causes_for("樹木風險評估為高風險；颱風後枯死", "") == sorted(
        [cause("dead"), cause("risk-assessment-high"), cause("typhoon")]
    )
    assert causes_for("基於公共安全考量", "仁愛國中圍牆修復") == [
        cause("fall-risk"),
        cause("park-school-works"),
    ]


def test_unmatched_reason_and_title_leave_causes_empty() -> None:
    assert causes_for("先驅樹種", "貯留設施新建工程") == []


def test_mrt_title_wins_over_park_words() -> None:
    assert causes_for("", "捷運站旁公園") == [cause("mrt-construction")]


def test_only_parks_office_tags_become_inventory_ids() -> None:
    assert inventory_tag("sy1680021119") == "SY1680021119"
    assert inventory_tag("333501-126306") is None
    assert inventory_tag("") is None


def test_note_leads_with_action_plan_status_and_date_caveat() -> None:
    note = build_note(
        action="transplant",
        title="測試計畫",
        status="under_review",
        plan_no="T1",
        reason="配合工程",
        extra=[],
        limit=300,
    )
    assert note == "計畫移植。測試計畫（審查中）。計畫書編號 T1。日期為計畫上網日期。原因：配合工程"


def test_long_reason_is_cut_but_the_prefix_survives() -> None:
    note = build_note(
        action="remove",
        title="測試計畫",
        status="approved",
        plan_no="A1",
        reason="很長" * 300,
        extra=[],
        limit=300,
    )
    assert len(note) == 300
    assert note.startswith("計畫移除。測試計畫（已核准）。")
    assert note.endswith("…")


def test_note_refuses_a_reason_with_a_link() -> None:
    with pytest.raises(ValueError):
        build_note(
            action="remove",
            title="t",
            status="unclear",
            plan_no="1",
            reason="見 https://example.com",
            extra=[],
            limit=300,
        )


# --- curate ----------------------------------------------------------------


def test_curate_keeps_only_remove_and_transplant(plans) -> None:
    actions = {row[plans["columns"].index("action")] for row in plans["rows"]}
    assert actions == {"remove", "transplant"}
    assert len(plans["rows"]) == 7


def test_curate_orders_plan_numbers_naturally(plans) -> None:
    numbers = [row[2] for row in plans["rows"] if row[0] == "removal_AAAA"]
    assert numbers == ["A9", "A10", "A11", "216", "254"]


def test_curate_records_case_status_and_posting_date(plans) -> None:
    cases = {entry["case"]: entry for entry in plans["cases"]}
    assert cases["removal_AAAA"]["status"] == "unclear"
    assert cases["removal_AAAA"]["posted_at"] == "2026-09-23"
    assert cases["transplant_BBBB"]["status"] == "approved"


# --- build -----------------------------------------------------------------


def test_placed_tree_maps_every_report_field(plans) -> None:
    report = by_ref(build(plans))["pkl:removal_AAAA:0:A10"]
    assert (report.lat, report.lng) == twd97_to_wgs84(307367, 2769650)
    assert report.species == "黑板樹"
    assert report.causes == sorted(
        [cause("decay-cavity"), cause("fall-risk"), cause("mrt-construction")]
    )
    assert report.inventory_tree_id == "SY1680021119"
    assert report.observed_at == "2026-09-23"
    assert report.link == "https://pkl.gov.taipei/News_Content.aspx?n=X&s=AAAA"
    assert report.note.startswith("計畫移除。臺北捷運環狀線測試區段標樹木移除計畫（狀態不明）。")
    assert report.action == "remove"


def test_wgs84_coordinates_from_the_plan_are_used_as_given(plans) -> None:
    report = by_ref(build(plans))["pkl:transplant_BBBB:0:T1"]
    assert (report.lat, report.lng) == (25.03752, 121.5505)
    assert report.inventory_tree_id is None
    assert report.action == "transplant"


def test_trees_without_a_usable_point_go_to_pending(plans) -> None:
    result = build(plans)
    pending = pending_by_ref(result)
    assert pending["pkl:removal_AAAA:0:A11"]["why"] == "no-coordinate"
    assert pending["pkl:transplant_BBBB:0:T2"]["why"] == "placeholder-coordinate"
    assert pending["pkl:removal_AAAA:0:A11"]["location"] == "信義區"
    assert "pkl:removal_AAAA:0:A11" not in by_ref(result)


def test_points_outside_the_report_area_go_to_pending(plans, monkeypatch) -> None:
    monkeypatch.setattr(removal_plans, "load_bbox", lambda: (121.0, 24.0, 121.1, 24.1))
    result = build(plans)
    assert result["reports"] == []
    assert {row[-1] for row in result["pending"]} >= {"outside-bbox"}


def test_trees_sharing_a_point_are_both_kept_and_marked(plans) -> None:
    result = build(plans)
    reports = by_ref(result)
    assert "座標與計畫書編號 254 相同" in reports["pkl:removal_AAAA:2:216"].note
    assert "座標與計畫書編號 216 相同" in reports["pkl:removal_AAAA:2:254"].note
    assert [entry[3] for entry in result["shared"]] == [["216", "254"]]


def test_a_tree_listed_by_two_plans_is_imported_once(plans, monkeypatch) -> None:
    monkeypatch.setattr(
        removal_plans, "COVERED_BY", {("transplant_BBBB", "remove"): ("removal_AAAA", 2)}
    )
    trees = [dict(zip(plans["columns"], row, strict=True)) for row in plans["rows"]]
    twin = next(tree for tree in trees if tree["plan_no"] == "T2")
    twin["plan_no"] = "216"
    plans["rows"] = [[tree[column] for column in plans["columns"]] for tree in trees]

    result = build(plans)
    assert result["covered"] == [["pkl:transplant_BBBB:0:216", "pkl:removal_AAAA:2:216"]]
    refs = [report.external_ref for report in result["reports"]]
    assert "pkl:transplant_BBBB:0:216" not in refs
    assert "pkl:transplant_BBBB:0:216" not in pending_by_ref(result)


def test_later_coordinates_place_a_pending_tree_and_say_how(plans) -> None:
    ref = "pkl:removal_AAAA:0:A11"
    result = build(plans, {ref: Placement(25.03, 121.56, "inventory")})
    report = by_ref(result)[ref]
    assert (report.lat, report.lng) == (25.03, 121.56)
    assert "座標依樹籤編號取自公園處清冊" in report.note
    assert ref not in pending_by_ref(result)


def test_the_data_source_says_where_the_point_comes_from(plans) -> None:
    ref = "pkl:removal_AAAA:0:A11"
    reports = by_ref(build(plans, {ref: Placement(25.03, 121.56, "inventory")}))
    assert reports[ref].source == "removal-plan-inventory"
    assert reports["pkl:removal_AAAA:0:A10"].source == "removal-plan"


def test_the_plans_own_coordinate_wins_over_a_later_one(plans) -> None:
    ref = "pkl:removal_AAAA:0:A10"
    result = build(plans, {ref: Placement(25.0, 121.5, "geocode")})
    assert (by_ref(result)[ref].lat, by_ref(result)[ref].lng) == twd97_to_wgs84(307367, 2769650)


def test_coordinates_file_rejects_an_unknown_source(tmp_path: Path) -> None:
    path = tmp_path / "coordinates.json"
    entry = {"lat": 25, "lng": 121.5, "via": "guess"}
    path.write_text(
        json.dumps({"schema": 1, "coordinates": {"pkl:x:0:1": entry}}), encoding="utf-8"
    )
    with pytest.raises(ValueError):
        removal_plans._load_coordinates(path)


# --- outputs ---------------------------------------------------------------


def test_import_sql_is_one_idempotent_insert_per_report(plans) -> None:
    reports = build(plans)["reports"]
    sql = import_sql(reports)
    inserts = [line for line in sql.splitlines() if line.startswith("INSERT")]
    assert len(inserts) == len(reports)
    assert all(line.startswith("INSERT OR IGNORE INTO reports") for line in inserts)
    evidence = code_for_slug("evidence", "official-document")
    source = code_for_slug("sources", "removal-plan")
    assert f"'[]', {evidence}, {source}, " in inserts[0]
    assert "'pkl:" in inserts[0]


def test_import_sql_brings_the_source_of_imported_rows_in_line(plans) -> None:
    ref = "pkl:removal_AAAA:0:A11"
    reports = build(plans, {ref: Placement(25.03, 121.56, "inventory")})["reports"]
    updates = [line for line in import_sql(reports).splitlines() if line.startswith("UPDATE")]
    plan_code = code_for_slug("sources", "removal-plan")
    inventory_code = code_for_slug("sources", "removal-plan-inventory")
    plan_sources = f"({', '.join(str(code) for code in sorted([plan_code, inventory_code]))})"
    by_code = {int(line.split("SET source = ")[1].split(" ")[0]): line for line in updates}
    assert set(by_code) == {plan_code, inventory_code}
    assert (
        f"WHERE source IN {plan_sources} AND source <> {inventory_code} " in by_code[inventory_code]
    )
    assert by_code[inventory_code].endswith(f"external_ref IN ('{ref}');")
    assert "'pkl:removal_AAAA:0:A10'" in by_code[plan_code]


def test_import_sql_escapes_single_quotes(plans) -> None:
    reports = build(plans)["reports"]
    first = reports[0]
    tricky = removal_plans.Report(**{**first.__dict__, "species": "O'Tree"})
    assert "'O''Tree'" in import_sql([tricky])


def test_index_names_each_report_plan_and_action(plans) -> None:
    reports = build(plans)["reports"]
    index = index_document(plans, reports)
    assert index["columns"] == ["id", "case", "action", "inventory_gone"]
    assert len(index["rows"]) == len(reports)
    case = index["cases"]["transplant_BBBB"]
    assert case["status"] == "approved"
    assert case["url"].startswith("https://pkl.gov.taipei/")


def test_run_is_byte_stable(tmp_path: Path) -> None:
    run(out_dir=tmp_path, input_dir=FIXTURES, extracted_at="2026-09-28")
    first = {path.name: path.read_bytes() for path in tmp_path.iterdir()}
    run(out_dir=tmp_path)
    second = {path.name: path.read_bytes() for path in tmp_path.iterdir()}
    assert first == second
    assert set(first) == {"plans.json", "import.sql", "index.json", "pending.json", "review.json"}
    pending = json.loads(first["pending.json"])
    assert pending["count"] == len(pending["rows"])


def test_an_inventory_point_of_a_doubtful_tag_is_not_used(plans, monkeypatch) -> None:
    pending_ref = "pkl:removal_AAAA:0:A11"
    point = {pending_ref: Placement(25.03, 121.56, "inventory")}
    assert pending_ref in by_ref(build(plans, point))
    monkeypatch.setitem(removal_plans.DOUBTFUL_TAGS, pending_ref, "inventory point is elsewhere")
    result = build(plans, point)
    assert pending_ref not in by_ref(result)
    assert pending_by_ref(result)[pending_ref]["why"] == "no-coordinate"


def test_import_hides_rows_of_withdrawn_trees_only_when_no_longer_placed(plans) -> None:
    reports = build(plans)["reports"]
    placed = reports[0].external_ref
    sql = import_sql(reports, ["pkl:removal_AAAA:0:A11", placed])
    hide = [line for line in sql.splitlines() if line.startswith("UPDATE reports SET status = 1")]
    assert len(hide) == 1
    assert "'pkl:removal_AAAA:0:A11'" in hide[0]
    assert f"'{placed}'" not in hide[0]
    assert "status = 0 AND source IN (3, 4)" in hide[0]
    assert "status = 1" not in import_sql(reports)
