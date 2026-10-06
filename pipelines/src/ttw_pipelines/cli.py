"""Command line entry point for the Taipei Tree Watch data pipelines."""

from __future__ import annotations

import argparse
from pathlib import Path

from ttw_pipelines import plan_inventory, protected_trees, removal_plans


def _run_protected_trees(args: argparse.Namespace) -> int:
    summary = protected_trees.run(out_dir=args.out, input_path=args.input)
    print(f"wrote {summary['trees_path']}: {summary['kept']} rows")
    for record in summary["dropped"]:
        print(f"dropped: {record}")
    if summary["changes_path"] is not None:
        print(
            f"wrote {summary['changes_path']}: "
            f"{summary['added']} added, {summary['removed']} removed"
        )
    return 0


def _run_removal_plans(args: argparse.Namespace) -> int:
    if args.input is not None:
        # Curate first so the join reads the plans.json the build will use.
        removal_plans.run(out_dir=args.out, input_dir=args.input)
    if args.inventory is not None:
        joined = plan_inventory.run(inventory_dir=args.inventory, out_dir=args.out)
        print(
            f"inventory {joined['inventory_date']} ({joined['inventory_trees']} trees): "
            f"{joined['tagged']} tagged plan trees, {joined['missing']} missing from it "
            f"({joined['missing_placed']} of them on the map); "
            f"{joined['filled']} of {joined['fillable']} trees without a point placed by tag"
        )
        for reason, count in sorted(joined["rejected"].items()):
            print(f"not placed by tag, {reason}: {count}")
    summary = removal_plans.run(out_dir=args.out)
    print(
        f"wrote {summary['out_dir']}: {summary['trees']} planned trees, "
        f"{summary['imported']} placed, {summary['pending']} pending, "
        f"{summary['covered']} listed twice"
    )
    for reason, count in sorted(summary["pending_by_reason"].items()):
        print(f"pending {reason}: {count}")
    if summary["sites"]:
        print(
            f"sites: {summary['sites']} summary points cover {summary['on_site']} "
            f"of the {summary['pending']} pending trees (sites.json)"
        )
    if summary["shared_coordinates"]:
        print(f"points shared by more than one tree: {summary['shared_coordinates']} (review.json)")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="ttw-pipelines", description="Taipei Tree Watch data pipelines"
    )
    subparsers = parser.add_subparsers(dest="pipeline", required=True)

    trees = subparsers.add_parser(
        "protected-trees",
        help="Fetch the data.taipei protected-tree dataset and emit trees.json",
    )
    trees.add_argument(
        "--out",
        type=Path,
        default=protected_trees.DEFAULT_OUT_DIR,
        help="output directory (default: data/protected-trees in the checkout)",
    )
    trees.add_argument(
        "--input",
        type=Path,
        default=None,
        help="read this local CSV instead of downloading (offline runs)",
    )
    trees.set_defaults(handler=_run_protected_trees)

    plans = subparsers.add_parser(
        "removal-plans",
        help="Turn the Parks Office removal and transplant plans into report rows and import.sql",
    )
    plans.add_argument(
        "--out",
        type=Path,
        default=removal_plans.DEFAULT_OUT_DIR,
        help="output directory (default: data/removal-plans in the checkout)",
    )
    plans.add_argument(
        "--input",
        type=Path,
        default=None,
        help=(
            "directory holding the extraction CSVs; rewrites plans.json from them "
            "(without it, the committed plans.json is rebuilt)"
        ),
    )
    plans.add_argument(
        "--inventory",
        type=Path,
        default=None,
        help=(
            "directory holding the Parks Office TaipeiTree.csv and TaipeiParkTree.csv; "
            "joins plan trees on their tag, rewriting coordinates.json and inventory.json"
        ),
    )
    plans.set_defaults(handler=_run_removal_plans)

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return int(args.handler(args))


if __name__ == "__main__":
    raise SystemExit(main())
