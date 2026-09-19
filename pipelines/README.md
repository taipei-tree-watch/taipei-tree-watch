# ttw-pipelines

Python data pipelines for Taipei Tree Watch. Managed with uv; see the repository root for the project overview.

Tag codes, the link domain whitelist and the snapshot layout are read from `shared/generated/*.json`, which `npm run build:shared` produces from the TypeScript definitions in `shared/`.

## `protected-trees`

```
uv run ttw-pipelines protected-trees [--out data/protected-trees] [--input <csv>]
```

Downloads the data.taipei protected-tree dataset (resource `a7c2db0d-8b6e-42b2-bdcc-ae69a6797e1d`) and writes `data/protected-trees/trees.json`. `--input` reads a local copy of the CSV instead, for offline runs and reruns; `pipelines/.cache/` is gitignored and is the place to keep one.

Rows whose latitude or longitude is not numeric, or carries fewer than two decimal places, are dropped and counted in the `dropped` field. `district` is parsed from the address prefix and is null when the address does not start with a Taipei district.

When `trees.json` already exists, the tree id sets are compared and the difference is written to `changes/<fetched_at>.json`. Ids that disappeared are flagged `suspected-delisting`: the dataset drops a tree once its protected status is lifted, so the disappearance is the only public trace. No file is written when the id set is unchanged.

Output is byte-stable for identical input, so a scheduled rerun produces an empty git diff unless the source data moved. `.github/workflows/pipeline-protected-trees.yml` runs this weekly and commits the result.

The dataset is published under the Open Government Data License v1; the site must credit the provider, year and dataset name.
