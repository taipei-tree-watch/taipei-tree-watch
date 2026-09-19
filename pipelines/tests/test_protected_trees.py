import json
from pathlib import Path

import pytest

from ttw_pipelines.protected_trees import (
    COLUMNS,
    REMOVED_FLAG,
    SCHEMA,
    SOURCE,
    build_document,
    diff_documents,
    dumps,
    parse_district,
    parse_rows,
    read_csv_file,
    run,
)

FIXTURE = Path(__file__).parent / "fixtures" / "protected-trees.csv"


@pytest.fixture
def parsed() -> tuple[list[list[object]], list[dict[str, str]]]:
    return parse_rows(read_csv_file(FIXTURE))


def test_reads_csv_with_byte_order_mark(tmp_path: Path) -> None:
    path = tmp_path / "bom.csv"
    path.write_bytes(b"\xef\xbb\xbf" + FIXTURE.read_bytes())
    rows, _ = parse_rows(read_csv_file(path))
    assert [row[0] for row in rows] == ["12", "768", "9001"]


def test_maps_columns_and_strips_whitespace(parsed) -> None:
    rows, _ = parsed
    by_id = {row[0]: dict(zip(COLUMNS, row, strict=True)) for row in rows}
    banyan = by_id["768"]
    assert banyan["species"] == "榕"
    assert banyan["lat"] == 25.0232
    assert banyan["lng"] == 121.5056
    assert banyan["dbh_m"] == 1.13
    assert banyan["address"] == "臺北市萬華區騰雲里青年公園1.2號草坪"
    assert banyan["manager"] == "臺北市政府工務局公園路燈工程管理處"
    assert banyan["site_type"] == "公園、綠地"
    assert by_id["12"]["address"] == "臺北市士林區天母東路100號"


def test_rows_are_sorted_by_numeric_id(parsed) -> None:
    rows, _ = parsed
    assert [row[0] for row in rows] == ["12", "768", "9001"]


def test_drops_unusable_coordinates(parsed) -> None:
    rows, dropped = parsed
    assert [row[0] for row in rows] == ["12", "768", "9001"]
    assert [record["樹木編號"] for record in dropped] == ["2303", "1671", "9002", "9003"]


def test_blank_diameter_becomes_null(parsed) -> None:
    rows, _ = parsed
    by_id = {row[0]: dict(zip(COLUMNS, row, strict=True)) for row in rows}
    assert by_id["9001"]["dbh_m"] is None


def test_parse_district() -> None:
    assert parse_district("臺北市萬華區騰雲里青年公園") == "萬華區"
    assert parse_district("台北市士林區天母東路100號") == "士林區"
    assert parse_district("  臺北市南港區研究院路二段  ") == "南港區"
    assert parse_district("新北市新店區碧潭路9號") is None
    assert parse_district("") is None


def test_district_column_follows_the_address(parsed) -> None:
    rows, _ = parsed
    by_id = {row[0]: dict(zip(COLUMNS, row, strict=True)) for row in rows}
    assert by_id["768"]["district"] == "萬華區"
    assert by_id["12"]["district"] == "士林區"
    assert by_id["9001"]["district"] is None


def test_document_header(parsed) -> None:
    rows, dropped = parsed
    document = build_document(rows, fetched_at="2026-09-19", dropped=len(dropped))
    assert document["schema"] == SCHEMA
    assert document["source"] == SOURCE
    assert document["fetched_at"] == "2026-09-19"
    assert document["columns"] == COLUMNS
    assert document["dropped"] == 4


def _document(rows: list[list[object]]) -> dict[str, object]:
    return build_document(rows, fetched_at="2026-09-19", dropped=0)


# id, species, lat, lng, dbh_m, address, manager, site_type, district
ROW_A = ["1", "榕", 25.0448, 121.532, 1.08,
         "臺北市中正區八德路一段55號", "甲", "公共場所", "中正區"]
ROW_B = ["2", "樟", 25.1184, 121.5323, 0.95,
         "臺北市士林區天母東路100號", "乙", "道路、人行道", "士林區"]
ROW_C = ["3", "楓香", 25.0232, 121.5056, 0.7,
         "臺北市萬華區青年公園", "丙", "公園、綠地", "萬華區"]


def test_diff_reports_added_and_removed() -> None:
    changes = diff_documents(_document([ROW_A, ROW_B]), _document([ROW_A, ROW_C]))
    assert changes["added"] == [
        {
            "id": "3",
            "species": "楓香",
            "address": "臺北市萬華區青年公園",
            "lat": 25.0232,
            "lng": 121.5056,
        }
    ]
    assert changes["removed"] == [
        {
            "id": "2",
            "species": "樟",
            "address": "臺北市士林區天母東路100號",
            "lat": 25.1184,
            "lng": 121.5323,
            "flag": REMOVED_FLAG,
        }
    ]


def test_diff_is_empty_when_the_id_set_is_unchanged() -> None:
    changed = list(ROW_A)
    changed[2] = 25.0449
    changes = diff_documents(_document([ROW_A, ROW_B]), _document([changed, ROW_B]))
    assert changes == {"added": [], "removed": []}


def test_diff_tolerates_a_previous_file_with_fewer_columns() -> None:
    previous = {
        "columns": ["id", "species", "lat", "lng", "dbh_m", "address", "manager", "site_type"],
        "rows": [ROW_A[:8], ROW_B[:8]],
    }
    changes = diff_documents(previous, _document([ROW_A]))
    assert [entry["id"] for entry in changes["removed"]] == ["2"]
    assert changes["added"] == []


def test_dumps_is_valid_json_and_repeatable(parsed) -> None:
    rows, dropped = parsed
    document = build_document(rows, fetched_at="2026-09-19", dropped=len(dropped))
    text = dumps(document)
    assert text.endswith("\n")
    assert json.loads(text) == document
    assert dumps(build_document(rows, fetched_at="2026-09-19", dropped=len(dropped))) == text


def test_run_is_byte_stable_and_writes_changes_only_when_ids_move(tmp_path: Path) -> None:
    first = run(out_dir=tmp_path, input_path=FIXTURE, fetched_at="2026-09-19")
    trees = tmp_path / "trees.json"
    assert first["changes_path"] is None
    assert not (tmp_path / "changes").exists()
    baseline = trees.read_bytes()

    second = run(out_dir=tmp_path, input_path=FIXTURE, fetched_at="2026-09-19")
    assert second["changes_path"] is None
    assert trees.read_bytes() == baseline

    shortened = json.loads(baseline)
    shortened["rows"] = shortened["rows"][:-1]
    trees.write_text(dumps(shortened), encoding="utf-8")

    third = run(out_dir=tmp_path, input_path=FIXTURE, fetched_at="2026-09-20")
    assert third["changes_path"] == tmp_path / "changes" / "2026-09-20.json"
    changes = json.loads(third["changes_path"].read_text(encoding="utf-8"))
    assert [entry["id"] for entry in changes["added"]] == ["9001"]
    assert changes["removed"] == []
    assert json.loads(trees.read_bytes())["rows"] == json.loads(baseline)["rows"]
