# Taipei Tree Watch 技術規格 Overview

- 需求：`SPEC.md`；查證依據：`RESEARCH.md`；詞彙：根目錄 `CONTEXT.md`（本文件的名詞以它為準）
- 定案日期：2026-09-18。本文件是 overview，寫到「每個元件負責什麼、邊界在哪、資料長什麼樣」的深度；實作細節在 task 展開時決定。
- 選型唯一標準沿用 SPEC 第 4 節：免費、方便、不因無流量被停用。所有額度數字見 `RESEARCH.md` 第 7 節。

---

## 1. 系統架構

```
                 ┌──────────────────────────── Cloudflare ──────────────────────────────────────┐
                 │                                                                                │
  瀏覽器 ───────►│  Worker  taipei-tree-watch                                                     │
  (MapLibre)     │   ├─ Static Assets   /            前端 build 產物（HTML/JS/CSS、trees.json）  │
                 │   ├─ POST /api/reports            驗證 Turnstile + 欄位 → 寫 D1              │
                 │   ├─ GET  /api/snapshot           從 KV 取快照，附 Cache-Control              │
                 │   └─ scheduled  */15 * * * *      D1 全表 dump → 快照 → KV                    │
                 │                                                                                │
                 │  D1  reports        KV  snapshot:latest / snapshot:<ts> / snapshot:index      │
                 │  Turnstile widget   Web Analytics                                              │
                 └────────────────────────────────────────────────────────────────────────────────┘
                                   ▲                                    │
      wrangler d1 execute（匯入官方紀錄、軟刪除）                       │ 每日抓公開快照
                                   │                                    ▼
                 ┌──────────────────── GitHub organization taipei-tree-watch ─────────────────────┐
                 │  repo（public）                                                                │
                 │   ├─ CI：typecheck / lint / vitest / pytest / ruff → wrangler deploy           │
                 │   ├─ pipelines（Python, uv）：受保護樹木同步、官方解列紀錄、清冊 diff         │
                 │   └─ data/：管線產出 JSON、每日公開快照（備份與歷史）                          │
                 └────────────────────────────────────────────────────────────────────────────────┘

  外部唯讀來源：data.taipei 受保護樹木 CSV、公園處清冊 CSV（Azure Blob）、文化局樹保會 PDF、
                NLSC WMTS（底圖）、都發局 WMTS（正射）
```

三條原則：

1. **讀寫分離**（SPEC 第 4 節）：使用者讀取永遠只碰 KV 快照與邊緣快取，不碰 D1。
2. **伺服器端驗證是唯一防線**：前端的同等檢查只是 UX。
3. **管線產出進 git**：所有從外部抓來、轉換過的資料以 JSON 進 repo，錯了可以 diff。

---

## 2. Repo 佈局

單一 npm package，`web/` 與 `worker/` 是目錄不是 workspace。Python 管線獨立用 uv 管理。

```
taipei-tree-watch/
├── CONTEXT.md                 詞彙表
├── docs/                      SPEC、RESEARCH、TECH-SPEC、TASKS
├── shared/                    前後端與管線共用的 source of truth
│   ├── tags.ts                病因、處置、證據來源、資料來源的代碼表
│   ├── domains.ts             連結網域白名單
│   ├── snapshot.ts            快照 schema 型別與版本號
│   └── generated/             build 時由上面三檔產出的 JSON，給 Python 讀（進 git）
├── web/                       Vite 前端：index.html、src/
├── worker/                    Worker：src/index.ts、routes/、validate/、snapshot/
├── migrations/                D1 SQL migrations（wrangler d1 migrations）
├── data/
│   ├── protected-trees/       trees.json（前端資產來源）＋ changes/<date>.json
│   ├── delisting/             官方解列紀錄：<meeting-id>.json、pending.json（待定位）
│   ├── inventory/             M3：清冊 diff 結果
│   └── snapshots/             每日公開快照 latest.json ＋ <date>.json
├── pipelines/                 Python：pyproject.toml、src/ttw_pipelines/、tests/
├── .github/workflows/         ci.yml、deploy.yml、pipeline-*.yml
├── wrangler.toml
├── package.json
└── workdocs/                  gitignored
```

---

## 3. 元件

### 3.1 前端 `web/`

- Vite 加 TypeScript，無框架（DOM 直接操作），MapLibre GL JS，client-side clustering 用 MapLibre 內建 cluster 或 supercluster。
- 單一頁面，手機優先，地圖全螢幕。回報表單是底部 sheet，桌面寬度變側欄。說明與免責是可展開區塊，安全警語常駐在表單開頭。
- 啟動時載入兩個檔：`/api/snapshot`（回報）與 `/trees.json`（受保護樹木靜態資產）。兩者都是一次載入、全在記憶體篩選。
- 圖層：底圖 raster（NLSC）、正射 raster（都發局，選點時預設開）、受保護樹木（灰色小點）、回報點（依病因著色，褐根病最醒目）、清冊消失層（M3 之後）。
- 篩選：病因、處置、證據來源、資料來源、發現日期範圍，全部在前端對快照做。
- 選點流程（SPEC 第 6 節）：GPS 只用來 flyTo，地圖中心固定準心，zoom 未達 18 時送出鈕停用，正射圖層在此步驟預設開啟。準心 20 公尺內有受保護樹木時，sheet 顯示「這是受保護樹木 #編號 樹種 嗎？」讓使用者一鍵關聯。
- 表單欄位對應 SPEC 第 3 節：只有位置必填。證據來源預設「無公告，僅目擊」；選了它或「高風險掛牌」時病因區塊收合並顯示「無憑據請留空」。說明欄 300 字，前端即時剝 URL 並提示「連結請填在下方欄位」。連結欄即時比對白名單並顯示網域。
- 送出成功後顯示「已收到，約 15 分鐘後出現在地圖上」，並在本機 `localStorage` 暫存該點讓回報者立刻看到自己的點（僅本機、標示為待同步）。
- 呈現措辭遵守 SPEC 第 8 節：「此處的公告記載原因為……」；連結顯示網域、`rel="nofollow noopener"`。

### 3.2 Worker `worker/`

原生 `fetch` 與 `scheduled` handler，zod 驗證，不用 web framework。三條路徑：

| 路徑 | 職責 |
|---|---|
| `POST /api/reports` | Turnstile 驗證 → zod 解析 → 第 6 節的伺服器端檢查 → 產生 ULID → INSERT D1 → 201 |
| `GET /api/snapshot` | `KV.get('snapshot:latest')` → 回傳，`Cache-Control: public, max-age=300, stale-while-revalidate=900`，`ETag` 為快照的 `generated_at` |
| `scheduled` | `SELECT … WHERE status = 0` → 依 `shared/snapshot.ts` 組陣列 → `KV.put('snapshot:latest')` 與 `KV.put('snapshot:<ts>')` → 更新 `snapshot:index`（保留最近 48 份，超出的刪除） |

其他請求交給 Static Assets。沒有 admin route，軟刪除走 wrangler（第 10 節）。

Bindings：`DB`（D1）、`SNAPSHOTS`（KV）；secrets：`TURNSTILE_SECRET_KEY`、`REPORTER_SALT`；vars：`TURNSTILE_SITE_KEY`（公開）、`BBOX`。

### 3.3 D1

一張表。tag 存 JSON 陣列文字，因為所有篩選都在前端對快照做，D1 沒有依 tag 查詢的路徑。

```sql
CREATE TABLE reports (
  id                TEXT PRIMARY KEY,                 -- ULID
  lat               REAL NOT NULL,                    -- WGS84，寫入前四捨五入到 5 位
  lng               REAL NOT NULL,
  species           TEXT,                             -- 自由文字，<= 50 字
  causes            TEXT NOT NULL DEFAULT '[]',       -- JSON: 病因代碼陣列
  dispositions      TEXT NOT NULL DEFAULT '[]',       -- JSON: 處置代碼陣列
  evidence          INTEGER NOT NULL,                 -- 證據來源代碼
  source            INTEGER NOT NULL DEFAULT 1,       -- 資料來源代碼，1 = 使用者回報
  note              TEXT,                             -- <= 300 字，已剝 URL
  link              TEXT,                             -- 完整 URL，網域在白名單
  observed_at       TEXT,                             -- YYYY-MM-DD，Asia/Taipei
  protected_tree_id TEXT,                             -- 文化局樹木編號
  inventory_tree_id TEXT,                             -- 公園處樹籤編號
  external_ref      TEXT,                             -- 官方紀錄的來源識別（會議 id + 項次），匯入去重用
  status            INTEGER NOT NULL DEFAULT 0,       -- 0 顯示、1 隱藏（軟刪除）
  reporter_hash     TEXT,                             -- sha256(REPORTER_SALT + ip)，官方紀錄為 NULL
  created_at        TEXT NOT NULL                     -- ISO 8601 UTC
);
CREATE INDEX idx_reports_status ON reports(status);
CREATE UNIQUE INDEX idx_reports_external_ref ON reports(external_ref) WHERE external_ref IS NOT NULL;
```

受保護樹木不進 D1（決策：它只讀、不與回報 join 出任何查詢）。

### 3.4 KV

| key | 內容 |
|---|---|
| `snapshot:latest` | 最新快照 JSON |
| `snapshot:<ISO ts>` | 歷史版本，保留最近 48 份（12 小時） |
| `snapshot:index` | 歷史 key 清單，避免用 `list()`（每日 1,000 次上限） |

回滾：把某個 `snapshot:<ts>` 的值寫回 `snapshot:latest`，用 wrangler 手動做。

### 3.5 Turnstile

Managed 模式 widget 放在表單送出前。Worker 向 `https://challenges.cloudflare.com/turnstile/v0/siteverify` 驗 token，同時比對 `remoteip`。hostname 為 `taipei-tree-watch.taipeitreewatch.workers.dev`。

### 3.6 靜態資產

- `trees.json`：由管線從 data.taipei CSV 產出，build 時複製進 `web/public/`。格式與快照同樣是欄位陣列：

```json
{ "schema": 1, "source": "臺北市政府文化局 臺北市受保護樹木", "fetched_at": "2026-09-18",
  "columns": ["id","species","lat","lng","dbh_m","address","manager","site_type"],
  "rows": [["768","榕",25.0232,121.5056,1.13,"臺北市萬華區…","臺北市政府工務局公園路燈工程管理處","公園、綠地"], …] }
```

- 匯入時丟棄緯度非數值或小數少於 2 位的列（目前 2 筆），行政區從地址前綴解析。
- Cloudflare 自動 gzip/brotli，3,874 筆約 400 KB 壓後約 100 KB。

### 3.7 資料管線 `pipelines/`

Python 3.12 以上，uv 管理，跑在 GitHub Actions。每支管線是一個 CLI 子命令，輸入是外部來源，輸出是 `data/` 下的 JSON，由 Actions commit。共用的 tag 代碼從 `shared/generated/*.json` 讀。

| 管線 | 排程 | 輸入 | 輸出 |
|---|---|---|---|
| `protected-trees` | 每週 | data.taipei CSV | `data/protected-trees/trees.json`；與前版 diff 出 `changes/<date>.json`（新增／消失的編號，消失者標「疑似解列」） |
| `delisting`（M2） | 每週 | 文化局樹保會列表頁 → 委員會議程／紀錄 PDF | `data/delisting/<meeting-id>.json`（可上圖的回報列）、`pending.json`（對不到座標的） |
| `inventory-diff`（M3） | 每日 | 公園處 `TaipeiTree.csv`、`TaipeiParkTree.csv` | `data/inventory/<date>.json`（消失與新增的樹籤編號） |
| `snapshot-backup` | 每日 | `GET /api/snapshot` | `data/snapshots/latest.json`、`<date>.json` |
| `d1-export` | 每週 | `wrangler d1 export` | Actions artifact（含 `reporter_hash`，不進 repo，保留 90 天） |

官方紀錄匯入 D1：`delisting` 管線另產出 `data/delisting/import.sql`（`INSERT OR IGNORE`，以 `external_ref` 去重），Actions 用 `wrangler d1 execute --remote --file` 執行。匯入是冪等的，重跑不會重複。

座標轉換：公園處清冊為 TWD97 TM2（EPSG:3826），用 pyproj 轉 WGS84。受保護樹木已是經緯度，不轉。

---

## 4. 資料流

### 4.1 使用者回報

1. 前端完成選點與表單，取得 Turnstile token，`POST /api/reports`。
2. Worker 依第 6 節檢查；任一失敗回 4xx 與欄位級錯誤訊息。
3. 通過則寫入 D1，回 `201 {id}`。
4. 前端把該點暫存 `localStorage` 立即顯示，並告知約 15 分鐘後正式出現。
5. 下一次 cron 把它納入快照，邊緣快取在 5 分鐘內過期後所有人看到。

### 4.2 官方解列紀錄（M2）

1. 管線爬列表頁，只下載標題含「委員會」的議程與紀錄 PDF（幹事會沒有解列表）。
2. 抽「受保護樹木需解除列管案件」表，每列產一筆回報：`source` = 樹保會解除列管紀錄、`evidence` = 機關官網公告或計畫書、`protected_tree_id` = 表中編號、`note` = 解列原因與說明原文、`external_ref` = `<meeting-id>:<項次>`。
3. `observed_at`：從說明欄解析民國日期（現勘日期），解析不到用會議日期並在 `note` 前綴「日期為會議日期」。
4. 病因 tag 由關鍵字表對應（褐根病、倒伏、腐朽、枯死、颱風等），對不到留空。
5. 座標：以 `protected_tree_id` 查 `data/protected-trees/` 的所有歷史版本，找到就上圖，找不到進 `pending.json`。
6. 產 `import.sql`，Actions 匯入。

### 4.3 清冊消失（M3，離線階段）

每日抓兩份 CSV，以樹籤編號集合 diff 前一日，輸出消失與新增清單。連續數週後人工檢視：消失的編號多少比例在幾天內以新編號重現（重編號）、多少永久消失。誤判率可接受才進入「匯入為資料來源＝清冊消失偵測」的階段，屆時 `inventory_tree_id` 填樹籤編號、座標取自消失前最後一版清冊。

---

## 5. 共用定義 `shared/`

`tags.ts` 是 tag 的唯一 source of truth。每個值有永不重用的整數 `code` 與字串 `slug`；只能新增，不能重排或回收。

```ts
export const causes = [
  { code: 1,  slug: 'brown-root-rot',        label: '褐根病' },
  { code: 2,  slug: 'pest-disease-other',    label: '病蟲害（褐根病以外）' },
  { code: 3,  slug: 'decay-cavity',          label: '腐朽／樹洞' },
  { code: 4,  slug: 'dead',                  label: '枯死／自然死亡' },
  { code: 5,  slug: 'fall-risk',             label: '傾倒風險／公共安全' },
  { code: 6,  slug: 'risk-assessment-high',  label: '風險評估高風險' },
  { code: 7,  slug: 'root-heave',            label: '竄根／破壞路面' },
  { code: 8,  slug: 'vehicle-damage',        label: '車輛撞損' },
  { code: 9,  slug: 'unknown',               label: '不明' },
  { code: 20, slug: 'mrt-construction',      label: '捷運工程' },
  { code: 21, slug: 'road-construction',     label: '道路工程' },
  { code: 22, slug: 'building-construction', label: '建築工程' },
  { code: 23, slug: 'park-school-works',     label: '公園整建／校舍工程' },
  { code: 24, slug: 'typhoon',               label: '防颱修剪／颱風倒伏' },
] as const;
```

處置（僅修枝葉、僅剩主幹、僅剩根部、連根移除、已移植、樹穴水泥填平、原地保留）、證據來源（六項）、資料來源（四項）同格式。`domains.ts` 是白名單陣列。`snapshot.ts` 定義快照欄位順序與 `schema` 版本。build script 把三者輸出成 `shared/generated/*.json` 並 commit，Python 只讀 JSON。

快照格式：

```json
{ "schema": 1, "generated_at": "2026-09-18T08:15:00Z",
  "columns": ["id","lat","lng","species","causes","dispositions","evidence","source","note","link","observed_at","protected_tree_id","inventory_tree_id","created_at"],
  "rows": [["01J…",25.03412,121.54321,"榕",[1],[3],1,1,"…","https://www.threads.net/…","2026-09-10","1525",null,"2026-09-18T07:02:11Z"], …] }
```

不含 `reporter_hash` 與 `status`；只含 `status = 0` 的列。

---

## 6. 伺服器端驗證（`POST /api/reports`）

全部在 Worker 執行，順序如下，任一失敗即停：

1. `Content-Type` 為 JSON、body 小於 16 KB。
2. Turnstile token 向 Cloudflare 驗證成功，且 `remoteip` 一致。
3. zod schema：欄位型別、未知欄位拒收。
4. `lat`、`lng` 落在 `BBOX`（緯度 24.85 到 25.35、經度 121.30 到 121.75），四捨五入到 5 位。
5. `causes`、`dispositions`、`evidence` 的每個代碼存在於 `shared/tags.ts`；`source` 由伺服器強制為 1，客戶端傳的值忽略。
6. `evidence` 為「無公告，僅目擊」或「高風險掛牌」時，`causes` 必須為空。
7. `species` 去頭尾空白、50 字內。
8. `note` 剝除所有 URL 與 `www.` 起頭的字串、300 字內。
9. `link` 為合法 `https` URL，hostname 等於或以 `.` 結尾比對白名單網域。
10. `observed_at` 為合法日期、不晚於今天（Asia/Taipei）、不早於 2000-01-01。
11. `protected_tree_id`、`inventory_tree_id` 為字串且符合格式（前者數字、後者兩碼字母加十碼數字）；不驗證存在性。
12. 計算 `reporter_hash = sha256(REPORTER_SALT + CF-Connecting-IP)`。

錯誤回應為 `400 { errors: [{ field, message }] }`，Turnstile 失敗為 `403`。不做 IP 限流（SPEC 第 2 節）。

---

## 7. 圖磚

| 用途 | 來源 | URL 範本 | 條件 |
|---|---|---|---|
| 底圖 | NLSC 通用電子地圖 | `https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}`（灰階換 `EMAP01`） | 免申請，註明出處 |
| 正射 | 都發局歷史圖資 | `https://historygis.udd.gov.taipei/WMTS/Image_3857/default/GoogleMapsCompatible/{z}/{y}/{x}`（依 GetCapabilities 確認實際 style 與 matrix 名稱） | 條款灰色地帶，上線前寄信確認 |
| 正射備援 | NLSC `PHOTO2` | 同 EMAP 範本換圖層名 | 免申請 |

圖磚 URL 與 attribution 集中在 `web/src/basemaps.ts`，切換備援只改一處。不預抓、不快取到自己的儲存。attribution 常駐地圖右下：「底圖 © 內政部國土測繪中心｜航照 © 臺北市政府都市發展局｜受保護樹木 © 臺北市政府文化局（政府資料開放授權條款－第1版）｜回報資料 CC BY 4.0」。

---

## 8. 部署與環境

- 帳號：Cloudflare 帳號（子網域 `taipeitreewatch`）、GitHub organization `taipei-tree-watch`。網址 `https://taipei-tree-watch.taipeitreewatch.workers.dev`，不買網域。
- `wrangler.toml`：`name = "taipei-tree-watch"`、`main = "worker/src/index.ts"`、`assets = { directory = "web/dist" }`、`triggers.crons = ["*/15 * * * *"]`、D1 與 KV bindings、`observability.enabled = true`。
- 環境只有一個（production）。本機開發用 `wrangler dev` 加 `--local` D1 與 KV。
- GitHub secrets：`CLOUDFLARE_API_TOKEN`（權限：Workers Scripts、D1、KV、Workers Static Assets）、`CLOUDFLARE_ACCOUNT_ID`。Worker secrets 用 `wrangler secret put` 設一次。
- Workflows：
  - `ci.yml`：push 與 PR 觸發；`npm ci` → `tsc --noEmit` → `eslint` → `vitest`（Worker 測試用 `@cloudflare/vitest-pool-workers`）；`uv sync` → `ruff check` → `pytest`。
  - `deploy.yml`：push `main` 且 `ci` 成功後 `npm run build` → `wrangler deploy`。
  - `pipeline-*.yml`：各管線的排程與手動觸發，產出 commit 回 `main`（commit 作者為 GitHub Actions bot）。
- 不開 PR、不做預覽環境；直接 push `main`。

---

## 9. 資料保全

| 資產 | 機制 | 保留 |
|---|---|---|
| 公開快照 | `snapshot-backup` 每日 commit 到 `data/snapshots/` | 永久（git 歷史） |
| KV 歷史版本 | cron 保留最近 48 份 | 12 小時 |
| D1 完整內容（含 `reporter_hash`） | `d1-export` 每週 Actions artifact | 90 天 |
| 管線原始輸入 | 不保留原始 CSV 與 PDF，只保留轉換後 JSON 與來源 URL | 永久 |

D1 免費層無自動備份；若之後需要更長的完整備份再評估綁卡開 R2。

---

## 10. 維運

- **軟刪除**：`wrangler d1 execute taipei-tree-watch --remote --command "UPDATE reports SET status = 1 WHERE id = '…'"`，最多 15 分鐘後從快照消失；要立即生效再手動觸發 cron（`wrangler triggers` 或 dashboard）。
- **回滾快照**：從 `snapshot:index` 挑版本，`wrangler kv key get` 再 `put` 回 `snapshot:latest`；或從 `data/snapshots/<date>.json` 復原。
- **觀測**：Workers Logs（dashboard）與 `wrangler tail`；Web Analytics 看流量。不接第三方錯誤追蹤。
- **額度警戒**：D1 每日 5M rows read，cron 每次讀全表，一萬筆時每日 96 萬 rows；寫入 Worker 每筆 1 row。KV 每日 1,000 writes，cron 用 96 加 index 更新 96。Workers 每日 10 萬 requests，靠 `max-age=300` 讓快照讀取多數命中邊緣快取。

---

## 11. 授權與 attribution

- 程式碼 MIT（`LICENSE`）。
- 回報資料快照 CC BY 4.0，頁尾與 `data/snapshots/README.md` 寫明，並附「使用者回報、非官方診斷」的免責脈絡。
- 受保護樹木資料依政府資料開放授權條款第 1 版顯名（機關、年份、資料集名稱）。
- 圖磚 attribution 見第 7 節。

---

## 12. 已知風險與待驗證

| 項目 | 處理 |
|---|---|
| Workers Free 的 10 ms CPU 也套用在 cron，一萬筆 JSON 序列化可能貼近上限 | M1 用假資料實測；不夠就分批寫多個 key 或升 Paid（USD 5/月） |
| 都發局正射 WMTS「不得對外流通發布予第三方」條款 | 上線前寄信確認；`basemaps.ts` 一鍵切 `PHOTO2` |
| 已解列的樹在現有資料集無座標 | M2 先匯能對到的，`pending.json` 統計數量再決定是否做地址地理編碼 |
| 清冊 diff 誤判（重編號、資料修正） | M3 離線觀察數週再決定上線 |
| 政府 WMTS 無 SLA、無公開流量限制 | 圖磚失效不影響回報功能；備援切換一處改 |
| 前端一次載入全量快照，一萬筆約數百 KB | 陣列格式加 brotli；超過再分區塊或改 PMTiles 向量 |
