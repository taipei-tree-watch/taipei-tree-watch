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

Output is byte-stable for identical input, so a rerun produces an empty git diff unless the source data moved. The first release refreshes the dataset by hand: download the CSV with curl, run the command with `--input`, and commit `trees.json` together with any `changes/` file. Scheduled runs are deferred until the data.taipei TLS issue noted in docs/TECH-SPEC.md section 12 is resolved.

The dataset is published under the Open Government Data License v1; the site must credit the provider, year and dataset name.

## `removal-plans`

```
uv run ttw-pipelines removal-plans [--input <dir>] [--inventory <dir>] [--out data/removal-plans]
```

Turns the Parks Office tree removal and transplant plans (pkl.gov.taipei review pages) into report rows. The per-tree tables are extracted from the plan PDFs by hand into `trees_2026.csv` and `cases_2026.csv`, which stay outside the repo; `--input` names the directory holding them and rewrites `plans.json` from them. Without `--input` the committed `plans.json` is rebuilt, which is what a coordinate update needs.

`plans.json` keeps every tree a plan removes or transplants, with the plan's own wording, plus one entry per case with its title, review status (`approved`, `under_review`, `unclear`) and posting date. Trees the plans retain, or mark as already felled or dead, are left out.

The build writes, all byte-stable for identical input:

- `import.sql`: one `INSERT OR IGNORE` per tree with a usable point, `evidence` = official document and `source` = removal plan, split by where the point comes from: `removal-plan` (the plan's own coordinate) or `removal-plan-inventory` (the inventory entry of the tree's tag). One `UPDATE` per source at the end moves rows already imported to the right source when their point source changed; it only touches removal-plan rows. Run it with `wrangler d1 execute --remote --file` after deploying (docs/DEPLOY.md section 4.1); rows already imported are skipped through the unique index on `external_ref`.
- `index.json`: case title, status and page per report id, shipped as `/removal-plans.json` for the detail card. Its `inventory_gone` column holds the inventory version date when the tree's tag is no longer in the Parks Office inventory, read from `inventory.json`.
- `pending.json`: trees without a usable point, columns `external_ref, case, plan_no, tree_tag, species, action, location, why, site`; `why` is `no-coordinate`, `placeholder-coordinate` or `outside-bbox`, and `site` is the plan site the tree is summarised under (see below) or null. `on_site` counts the trees that have one.
- `review.json`: trees of one case sharing the exact same point, and trees listed by two plans (only one of each pair is imported).

### Plan sites

Most pending trees have a site-level location only (a park, a works compound, a road stretch). Rather than invent a point per tree, `sites.json` next to the other files lists one hand-picked point per site:

```json
{"schema": 1, "sites": [{"id": "cf720-ruiguang-park", "case": "removal_46B5198DD00B117C",
  "locations": ["內湖區瑞光公園"], "lat": 25.07208, "lng": 121.57881, "via": "site-plan",
  "how": "Median of the inventory trees in the strip the plan marks as the Y33 work area"}]}
```

A pending tree of that case whose `location` equals one of `locations` becomes a member; trees of the same case and location that already have a point are counted as `placed` instead. `via` is one of `site-plan`, `placed-trees`, `park-centroid`, `school-centroid`, `site-centroid`, `road-segment`, `intersection`, `address`, and the card says which; `how` is for maintainers. The build writes the sites into `index.json` (`site_columns`, `sites`: counts by action, species and cause counts, `placed`, and the inventory-gone signal) and fails when a site names an unknown case, lies outside the `BBOX`, has no pending member, or claims a location another site already claims. Members are never written to `import.sql`; the sites ship with the web build, so no D1 import is involved. After editing `sites.json`, rerun the build and commit it with `index.json` and `pending.json`.

`external_ref` is `pkl:<case>:<pdf index>:<plan number>`, and the report id is a ULID derived from it and the posting date, so reruns and re-imports never duplicate a tree. TWD97 coordinates (EPSG:3826) are converted with pyproj and rounded to 5 decimals; points outside the `BBOX` in `wrangler.toml` are not placed.

To place pending trees later, write `coordinates.json` next to the other files:

```json
{"schema": 1, "coordinates": {"pkl:<case>:<pdf>:<plan no>": {"lat": 25.0, "lng": 121.5, "via": "inventory"}}}
```

`via` is `inventory` (joined on `tree_tag` against the Parks Office inventory) or `geocode` (from the location text); the note on the card says which. A coordinate printed in the plan always wins. Rebuild, commit, and import the new `import.sql`.

### Joining against the Parks Office inventory

From `pipelines/`:

```
curl -sS -o .cache/TaipeiTree.csv https://tppkl.blob.core.windows.net/blobfs/TaipeiTree.csv
curl -sS -o .cache/TaipeiParkTree.csv https://tppkl.blob.core.windows.net/blobfs/TaipeiParkTree.csv
uv run ttw-pipelines removal-plans --inventory .cache
```

The inventory (data.taipei 臺北市行道樹及公園樹木分布圖, about 160k trees) is downloaded with curl because of the data.taipei TLS issue; the CSVs stay in the gitignored cache. `--inventory` matches every plan tree's Parks Office tag (two letters and ten digits, any case) exactly, then:

- writes `coordinates.json` entries with `via` = `inventory` for trees the plan gives no usable point, replacing earlier inventory entries and keeping those from other sources. A tag is not used when the inventory species disagrees with the plan's (`species-mismatch`; 台/臺 and 艷/豔 spellings, a name ending the other such as 臺灣海棗/海棗, and a few common-name pairs count as agreeing) or when two plan trees carry the same tag (`shared-tag`);
- writes `inventory.json`: for every tagged plan tree, placed or pending, whether its tag is in the inventory, plus the `rejected` list above. The inventory version date is the newest `UpdDate` across the two files. A tag missing from the inventory is only a signal (removal, renumbering or a data correction); it never changes an imported row.

The build then runs as usual. Commit `coordinates.json`, `inventory.json` and the rebuilt files.

Field mapping, cause keywords and the reasoning behind them are in docs/TECH-SPEC.md section 4.2.1.
