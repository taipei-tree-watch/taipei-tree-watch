"""Command line entry point for the Taipei Tree Watch data pipelines."""

from __future__ import annotations

import argparse
from pathlib import Path

from ttw_pipelines import protected_trees


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

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return int(args.handler(args))


if __name__ == "__main__":
    raise SystemExit(main())
