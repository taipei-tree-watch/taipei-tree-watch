from ttw_pipelines.shared import (
    code_for_slug,
    load_link_domains,
    load_snapshot_layout,
    load_tags,
    tag_dimension,
)


def test_causes_include_brown_root_rot_as_code_1() -> None:
    causes = tag_dimension("causes")
    by_code = {tag["code"]: tag["slug"] for tag in causes}
    assert by_code[1] == "brown-root-rot"
    assert code_for_slug("causes", "brown-root-rot") == 1


def test_every_dimension_has_unique_codes_and_slugs() -> None:
    tags = load_tags()
    for name in ("causes", "dispositions", "evidence", "sources"):
        entries = tags[name]
        codes = [tag["code"] for tag in entries]
        slugs = [tag["slug"] for tag in entries]
        assert len(set(codes)) == len(codes), name
        assert len(set(slugs)) == len(slugs), name


def test_link_domains_and_snapshot_layout_load() -> None:
    assert "threads.net" in load_link_domains()
    layout = load_snapshot_layout()
    assert layout["schema"] == 1
    assert layout["columns"][0] == "id"
