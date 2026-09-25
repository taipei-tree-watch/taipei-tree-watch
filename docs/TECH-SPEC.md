# Taipei Tree Watch 技術規格 Overview

- 需求：`SPEC.md`；查證依據：`RESEARCH.md`；技術棧一覽：`TECH-STACK.md`；詞彙：根目錄 `CONTEXT.md`（本文件的名詞以它為準）；上線後的重複操作：`RUNBOOK.md`
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
                 │   ├─ GET/PUT/DELETE /api/reports/<id>  憑編輯連結讀、改、撤回一筆回報        │
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
                 │   ├─ pipelines（Python, uv）：受保護樹木同步、官方解列紀錄、清冊 diff         │
                 │   └─ data/：管線產出 JSON、每日公開快照（備份與歷史）                          │
                 └────────────────────────────────────────────────────────────────────────────────┘

  外部唯讀來源：data.taipei 受保護樹木 CSV、公園處清冊 CSV（Azure Blob）、文化局樹保會 PDF、
                NLSC WMTS（底圖）、都發局 WMTS（正射）
```

三條原則：

1. **讀寫分離**（SPEC 第 4 節）：使用者讀取永遠只碰 KV 快照與邊緣快取，不碰 D1。唯一的例外是持有編輯連結的人打開修改表單時讀自己那一筆（`GET /api/reports/<id>`，主鍵查詢一列）。
2. **伺服器端驗證是唯一防線**：前端的同等檢查只是 UX。
3. **管線產出進 git**：所有從外部抓來、轉換過的資料以 JSON 進 repo，錯了可以 diff。

---

## 2. Repo 佈局

單一 npm package，`web/` 與 `worker/` 是目錄不是 workspace。Python 管線獨立用 uv 管理。

```
taipei-tree-watch/
├── CONTEXT.md                 詞彙表
├── docs/                      SPEC、RESEARCH、TECH-SPEC、TECH-STACK、TASKS、RUNBOOK
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
├── wrangler.toml
├── package.json
└── workdocs/                  gitignored
```

---

## 3. 元件

### 3.1 前端 `web/`

- 技術棧見 `TECH-STACK.md` 第 2 節：無 UI 框架（DOM 直接操作），回報點叢集用 MapLibre GeoJSON source 內建的 cluster。
- 單一頁面，手機優先，地圖全螢幕。回報表單是底部 sheet，桌面寬度變側欄。說明與免責是可展開區塊，安全警語常駐在表單開頭。
- 啟動時載入兩個檔：`/api/snapshot`（回報）與 `/trees.json`（受保護樹木靜態資產）。兩者都是一次載入、全在記憶體篩選。
- 圖層：底圖 raster（NLSC）、正射 raster（目前 NLSC `PHOTO2`，都發局待授權確認，見第 7 節；由地圖右上角的「顯示航照」浮動鈕切換（與「目前位置」鈕疊在一起；桌面開著回報側欄時移到側欄左側），選點時不自動切換）、受保護樹木（灰色小點）、回報點（依病因著色，褐根病最醒目）、清冊消失層（M3 之後）。
- 篩選：病因、處置、證據來源、資料來源、發現日期範圍，全部在前端對快照做。
- 選點流程（SPEC 第 6 節）：GPS 只用來 flyTo，地圖中心固定準心，zoom 未達 18 或超出收件範圍時「開始填寫」停用；按下「開始填寫」就鎖定點位（表單改讀當下的中心點，地圖手勢、縮放鈕、點擊點位與「目前位置」鈕都暫停），手機上表單填滿頂列以下的畫面，要改位置得按「重新定位」回到選點。用編輯連結打開既有回報時，直接鎖在該筆存的座標，不看地圖飛行中途的中心點。正射圖層維持使用者原本的選擇，要看樹冠就用地圖右上角的「顯示航照」鈕。頂列「回報」和「說明」一樣是開關，再按一次就收起 sheet。收起再打開時，填到一半的欄位原樣保留；送出成功（或修改、撤回完成）後再打開，則從空白表單的選點開始，不停在成功畫面。準心 20 公尺內有受保護樹木時，sheet 顯示「這是受保護樹木 #編號 樹種 嗎？」讓使用者一鍵關聯。準心 20 公尺內已有回報時，同一處以同樣的提示框列出最近那筆回報的內容（與地圖卡片同一套欄位），問「是同一棵樹嗎？」。答「不是」就照常回報；答「是」再問樹況有沒有變：「有新狀況」會帶入那筆的樹種與兩種樹木編號（只填空著的欄位，病因、處置、證據、說明、連結、日期不帶）並切到填表，「跟這筆一樣」清空表單並關閉 sheet。答案只對那一筆有效，準心移到另一筆或重開 sheet 就重問。同一棵樹的多筆回報仍各自獨立、不會合併，新回報也不記錄它跟前一筆的關係。受保護樹木的資訊框有「回報這棵樹」按鈕：打開回報 sheet、先關聯這棵樹（樹種未填時帶入），地圖飛到該樹、縮放至少 18，點位仍由使用者對準，因為清冊座標可能差幾公尺。座標數字以小字顯示。選點時附近的受保護樹木與既有回報只以一行小字點名（距離與編號，或「已關聯」），上面兩種提示框與它們的按鈕要等按下「開始填寫」鎖定點位後才展開，免得選點時蓋住地圖。選點時的操作說明由 sheet 標題列的「說明」開關收合，收合狀態記在 localStorage（`ttw:picker-guide-open`）；沒有記錄時手機預設收合、桌面側欄預設展開。手機上選點時間距也收緊，讓 sheet 盡量矮、準心周圍的地圖盡量大。
- 表單欄位對應 SPEC 第 3 節：只有位置必填。證據來源預設「無公告，僅目擊」；選了它或「高風險掛牌」時病因區塊收合並顯示「無憑據請留空」。說明欄 300 字，前端即時剝 URL 並提示「連結請填在下方欄位」。連結欄即時比對白名單並顯示網域。
- 送出成功後顯示「已收到，約 15 分鐘後出現在地圖上」，並在本機 `localStorage` 暫存該點讓回報者立刻看到自己的點（僅本機、標示為待同步）。同一個畫面給出編輯連結與「複製編輯連結」鈕，並寫明拿到連結的人都能修改或撤回、連結存在哪裡（第 3.2 節「編輯連結」）。
- 修改與撤回也寫進同一份本機暫存：修改後的版本取代快照裡的同一筆，撤回的那筆不畫；快照的 `generated_at` 晚於或等於 Worker 回的 `updated_at` 時才退場，因為快照早就有那個 id，光看 id 分不出新舊。
- 呈現措辭遵守 SPEC 第 8 節：「此處的公告記載原因為……」；連結顯示網域、`rel="nofollow noopener"`。

**深淺色（2026-09-21 定案）**：只跟隨裝置的 `prefers-color-scheme`，沒有站內切換開關，也不記使用者偏好；`<head>` 宣告 `<meta name="color-scheme" content="light dark">`，讓表單控制項與日期選擇器的原生外觀一起跟著換。

- **Token**：`web/src/style.css` 的 `:root` 定義全部顏色（surface、ink、line、accent、danger、shadow、準心光暈、`--bucket-*` 色票），`@media (prefers-color-scheme: dark)` 底下覆寫同一組名稱。樣式規則本身不寫任何顏色字面值，有一個測試掃 CSS 確保這條規矩沒被破壞，另一個測試用 WCAG 相對亮度算九組「文字／底色」的對比，兩種模式都必須到 4.5:1。
- **地圖圖層**：MapLibre 的 style 讀不到 CSS 變數，所以色票同時存在 `web/src/map/colors.ts` 的 `MAP_PALETTES`（light 與 dark 兩份），深色版把點位提亮、把分隔用的光暈由白翻黑。`web/src/theme.ts` 用 `matchMedia('(prefers-color-scheme: dark)')` 讀取與監聽，切換時只呼叫 `setPaintProperty` 更新既有圖層，不重建地圖也不重送資料；點位顏色改用 `match ['get','bucket']` 運算式，所以換色不必重算 GeoJSON。篩選面板的色塊直接吃 `var(--bucket-*)`，一個測試比對 CSS 與 TypeScript 兩份色票不會走鐘。
- **底圖**：NLSC EMAP 是白底深字的淺色地圖。深色模式在該 raster 圖層（只有它，不含航照與點位，也不對 canvas 下 CSS filter）套 `raster-brightness-min: 1`、`raster-brightness-max: 0.08`、`raster-saturation: -0.72`、`raster-contrast: -0.08`。min 高於 max 等於把亮度斜坡倒過來跑，紙面變近黑、字變亮；單純壓暗（`raster-brightness-max: 0.45`）會讓深色字留在灰紙上。實測 z16 臺北市中心圖磚（取最暗 2% 當字、上四分位當紙）：原圖 6.14:1，壓暗版 2.91:1，倒轉版 6.48:1。倒轉會讓綠地轉洋紅，所以抽掉七成飽和度，讓畫面上唯一鮮豔的東西是回報點。
- **Turnstile**：widget 的 `theme` 用 `auto`，跟著同一個系統偏好走。
- **MapLibre 自帶 chrome**：縮放鈕與 attribution 列在深色下改用頁面 token，選擇器前綴 `#map` 提高權重，因為 MapLibre 的樣式表跟著 map chunk 後到；只有控制項的圖示（背景圖）用 `filter: invert(1)`。

### 3.2 Worker `worker/`

原生 `fetch` 與 `scheduled` handler，zod 驗證，不用 web framework（技術棧見 `TECH-STACK.md` 第 3 節）。路徑如下：

| 路徑 | 職責 |
|---|---|
| `POST /api/reports` | Turnstile 驗證 → zod 解析 → 第 6 節的伺服器端檢查 → 產生 ULID 與編輯密鑰 → INSERT D1 → 201 `{id, edit_token}` |
| `GET /api/snapshot` | `KV.get('snapshot:latest')` → 回傳，`Cache-Control: public, max-age=300, stale-while-revalidate=900`，`ETag` 為快照的 `generated_at` |
| `GET /api/reports/<id>` | 憑 `Authorization: Bearer <編輯密鑰>` 讀該筆目前的欄位，給修改表單預填；`Cache-Control: no-store` |
| `PUT /api/reports/<id>` | 同一份 body 與同一套檢查（第 6 節），只是最後是 UPDATE；保留 `reporter_hash`、`created_at`、`source`，寫 `updated_at` → 200 `{id, updated_at}` |
| `DELETE /api/reports/<id>` | 撤回：`status = 2`、寫 `updated_at` → 200 `{id, updated_at}`；不過 Turnstile |
| `scheduled` | `SELECT … WHERE status = 0` → 依 `shared/snapshot.ts` 組陣列 → `KV.put('snapshot:latest')` 與 `KV.put('snapshot:<ts>')` → 更新 `snapshot:index`（保留最近 48 份，超出的刪除） |

其他請求交給 Static Assets。沒有 admin route，軟刪除走 wrangler（第 10 節）。

Bindings：`DB`（D1）、`SNAPSHOTS`（KV）；secrets：`TURNSTILE_SECRET_KEY`、`REPORTER_SALT`；vars：`TURNSTILE_SITE_KEY`（公開）、`TURNSTILE_HOSTNAME`、`BBOX`、`WEB_ANALYTICS_TOKEN`（公開，Worker 不用，只給前端 build 讀）。

靜態前端讀不到 Worker vars，所以前端另有兩份副本：`web/src/config.ts` 的 BBOX（只用來提前停用送出鈕，Worker 才是執行點）與 build 期的 `VITE_TURNSTILE_SITE_KEY`。

site key 注入方式（2026-09-20 定案）：以 `wrangler.toml` 的 `[vars]` 為單一來源，`vite.config.ts` 透過 `scripts/wrangler-vars.ts` 讀出 `TURNSTILE_SITE_KEY`，用 Vite `define` 烘進 `import.meta.env.VITE_TURNSTILE_SITE_KEY`。`npm run deploy` 不必額外帶環境變數，改 key 只改一個檔。不選 `GET /api/config` 是因為那會讓表單多一次往返才能顯示 widget；不選 HTML rewrite 是因為靜態資產由 Static Assets 直送，Worker 不在路徑上。`scripts/wrangler-vars.ts` 只解析 `[vars]` 底下的字串項，另有一個測試比對 `BBOX` 與 `web/src/config.ts` 的副本是否仍一致。單元測試不經 Vite，所以 `web/src/turnstile.ts` 在讀不到值時仍退回 Cloudflare 測試 key。

Web Analytics beacon：站台在 workers.dev，不是專案帳號的 zone，Cloudflare 無法自動注入，所以由 `scripts/web-analytics.ts` 的 Vite plugin 在 production build 把 beacon `<script>` 插進 `index.html` 的 `<head>`，token 同樣從 `[vars]` 的 `WEB_ANALYTICS_TOKEN` 讀。plugin 只在 `vite build` 生效，本機 dev server 與測試不送流量。

`TURNSTILE_SITE_KEY` 與搭配的 secret 都是正式 widget 的金鑰（2026-09-20 設定），secret 用 `wrangler secret put` 管入，不進 repo。

#### 編輯連結

格式是 permalink 加一個參數：`/?report=<ULID>&edit=<密鑰>`。密鑰是 32 bytes 亂數的 base64url（43 字元），只在 `POST /api/reports` 的 201 回應裡出現一次；D1 只存 `sha256(密鑰)` 的 hex（`edit_token_hash`），備份或匯出外流也拿不到可用的連結，弄丟了也讀不回來。密鑰與 ULID 無關，所以 permalink 推導不出編輯連結。

- 三條 `/api/reports/<id>` 路徑的授權條件都是 `id = ? AND edit_token_hash = sha256(密鑰) AND status = 0`，直接寫在 SELECT 或 UPDATE 的 WHERE 裡。缺密鑰、密鑰錯、id 不存在、官方紀錄（`edit_token_hash` 為 NULL）、已撤回或已被站方隱藏，一律回同一個 404，不透露「這筆存在但密鑰錯」。被站方軟刪除的回報不能靠編輯連結改回來。
- 密鑰放 `Authorization` 標頭而不是查詢字串，不進存取日誌與快取鍵。`PUT` 在叫 Turnstile 之前先檢查密鑰的形狀，形狀不對的請求不花 siteverify 與 D1。
- `PUT` 要 Turnstile，理由同 `POST`：否則拿到一條連結就能用程式反覆換 `link` 欄位。`DELETE` 不要：撤回只會讓點消失，機器人沒有好處。
- 前端讀到網址裡的 `edit` 就存進 localStorage 的 `ttw:edit-links`，並立刻用 `replaceState` 把 `edit` 從網址列拿掉；`permalinkSearch` 一律刪掉 `edit`，所以卡片的「複製連結」不會帶出密鑰。接著 `GET` 該筆、把地圖移到它的位置、以修改模式打開表單。
- 「我的回報」是回報 sheet 標題列的 chip，在「說明」旁邊，清單為空時隱藏；清單面板疊在 sheet 之上。每一筆有「在地圖上看」「修改」「複製編輯連結」。卡片上若是這個瀏覽器持有連結的回報，多一個「修改這筆回報」。`GET` 回 404 的連結自動從清單移除，因為它不會再變回有效。
- 在 `0002_edit_token.sql` 之前建立的回報沒有密鑰，可以用 `npm run issue:edit-links -- --remote` 補發（只補 `status = 0` 且 `source = 1` 的列，已有的不動），產出的連結寫到 `workdocs/`，附一段貼進瀏覽器 console 就能匯入「我的回報」的片段。步驟見 `RUNBOOK.md` 第 5 節。

#### permalink

單一回報與單一受保護樹木各有固定網址：`/?report=<ULID>`（ULID 是快照里的 `id`）與 `/?tree=<樹木編號>`（文化局編號，與卡片上顯示的一致）。用查詢字串而不是路徑，Static Assets 就能原樣回應這兩個網址，Worker 不必多一條 route；不用 hash 是因為 hash 不會送到伺服器，分享出去的連結在伺服器眼中會失去指向。兩個參數同時出現時以 `report` 為準，其餘查詢參數一律保留，只有編輯連結的 `edit` 例外，組 permalink 時一律拿掉。解析與組網址的純函式在 `web/src/permalink.ts`。

- 開卡片時用 `history.replaceState` 換網址，關卡片時把參數拿掉。不用 `pushState`，否則連續點幾個點會讓返回鍵要按很多次。
- 帶著 permalink 進站時，等快照（回報）或 `trees.json`（受保護樹木）載入完才定位：flyTo 到該點、縮放拉到 17 以上並開卡片。找不到時顯示一則可關閉的提示，地圖維持預設視野；狀態列已經在說明載入失敗時不蓋掉那則訊息。
- 被目前篩選條件擋掉的回報，在它的卡片開著期間照樣畫在地圖上。作法與待同步回報相同：在篩選之後補回來，不動篩選規則本身，統計數字也還是只算快照。
- 卡片上的「複製連結」：有 `navigator.share` 就開分享面板（title 用站名），否則寫剪貼簿並顯示短暫回饋；兩者都不行才把網址顯示在卡片裡讓人手動複製。

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
  status            INTEGER NOT NULL DEFAULT 0,       -- 0 顯示、1 隱藏（站方軟刪除）、2 回報者撤回
  reporter_hash     TEXT,                             -- sha256(REPORTER_SALT + ip)，官方紀錄為 NULL
  created_at        TEXT NOT NULL,                    -- ISO 8601 UTC
  edit_token_hash   TEXT,                             -- sha256(編輯密鑰) hex；NULL = 不能編輯（官方紀錄、補發前的舊列）
  updated_at        TEXT                              -- 最後一次修改或撤回，ISO 8601 UTC；沒改過為 NULL
);
CREATE INDEX idx_reports_status ON reports(status);
CREATE UNIQUE INDEX idx_reports_external_ref ON reports(external_ref) WHERE external_ref IS NOT NULL;
```

`edit_token_hash` 與 `updated_at` 由 `0002_edit_token.sql` 以 `ALTER TABLE` 加上，所以實際欄位順序在 `created_at` 之後。

受保護樹木不進 D1（決策：它只讀、不與回報 join 出任何查詢）。

### 3.4 KV

| key | 內容 |
|---|---|
| `snapshot:latest` | 最新快照 JSON |
| `snapshot:<ISO ts>` | 歷史版本，保留最近 48 份（12 小時） |
| `snapshot:index` | 歷史 key 清單（由舊到新），避免用 `list()`（每日 1,000 次上限） |

`<ts>` 是 `generated_at`，取 cron 的 `scheduledTime`，ISO 8601 含毫秒。兩個快照 key 都帶 KV metadata `{ generated_at }`，讓讀取路徑不必解析 body 就能組 ETag。列依 `id`（ULID）排序，同資料產出同位元組。

回滾：把某個 `snapshot:<ts>` 的值寫回 `snapshot:latest`，用 wrangler 手動做。手動寫入的值沒有 metadata，讀取路徑會退而從 body 前 256 字元抓 `generated_at`。

### 3.5 Turnstile

Managed 模式 widget 放在表單送出前。Worker 向 `https://challenges.cloudflare.com/turnstile/v0/siteverify` 驗 token，同時比對 `remoteip` 與 siteverify 回應的 `hostname`。

hostname 的期望值來自 var `TURNSTILE_HOSTNAME`，值為 `taipei-tree-watch.taipeitreewatch.workers.dev`；值為空字串或未設時不比對，本機 `wrangler dev` 與 vitest 走的是這條。比對只能配正式 key 使用：測試 key 的 siteverify 一律回 `example.com`，不論請求實際來自哪個網域。回應沒有 `hostname` 欄位時視為不符，不放行。

### 3.6 靜態資產

- `trees.json`：由管線從 data.taipei CSV 產出，build 時複製進 `web/public/`。格式與快照同樣是欄位陣列：

```json
{ "schema": 1, "source": "臺北市政府文化局 臺北市受保護樹木", "fetched_at": "2026-09-18",
  "columns": ["id","species","lat","lng","dbh_m","address","manager","site_type","district"],
  "rows": [["768","榕",25.0232,121.5056,1.13,"臺北市萬華區…","臺北市政府工務局公園路燈工程管理處","公園、綠地","萬華區"], …] }
```

- 匯入時丟棄緯度或經度非數值或小數少於 2 位的列（2026-09-19 為 5 筆：2 筆緯度為整數、3 筆經度只有 1 位小數，後者定位誤差約 1.1 公里），丟棄數量記在 `dropped` 欄位；`district` 從地址前綴「臺北市XX區」解析，解析不到為 null。`rows` 每列一行 compact JSON，讓 git diff 一列一行。
- Cloudflare 自動 gzip/brotli，3,874 筆約 400 KB 壓後約 100 KB。

### 3.7 資料管線 `pipelines/`

Python 與 uv（版本與套件見 `TECH-STACK.md` 第 5 節），在本機執行（排程用本機 launchd 或 cron）。每支管線是一個 CLI 子命令，輸入是外部來源，輸出是 `data/` 下的 JSON，執行後 commit 並 push。共用的 tag 代碼從 `shared/generated/*.json` 讀。

| 管線 | 排程 | 輸入 | 輸出 |
|---|---|---|---|
| `protected-trees` | 第一版手動一次性（自動每週排程列為後續版本，見 TASKS） | data.taipei CSV | `data/protected-trees/trees.json`；與前版 diff 出 `changes/<date>.json`（新增／消失的編號，消失者標「疑似解列」） |
| `delisting`（M2） | 每週 | 文化局樹保會列表頁 → 委員會議程／紀錄 PDF | `data/delisting/<meeting-id>.json`（可上圖的回報列）、`pending.json`（對不到座標的） |
| `inventory-diff`（M3） | 每日 | 公園處 `TaipeiTree.csv`、`TaipeiParkTree.csv` | `data/inventory/<date>.json`（消失與新增的樹籤編號） |
| `snapshot-backup` | 每日 | `GET /api/snapshot` | `data/snapshots/latest.json`、`<date>.json` |
| `d1-export` | 每週 | `wrangler d1 export` | 本機備份目錄（含 `reporter_hash`，不進 repo，保留 90 天） |

官方紀錄匯入 D1：`delisting` 管線另產出 `data/delisting/import.sql`（`INSERT OR IGNORE`，以 `external_ref` 去重），以 `wrangler d1 execute --remote --file` 執行。匯入是冪等的，重跑不會重複。

座標轉換：公園處清冊為 TWD97 TM2（EPSG:3826），用 pyproj 轉 WGS84。受保護樹木已是經緯度，不轉。

---

## 4. 資料流

### 4.1 使用者回報

1. 前端完成選點與表單，取得 Turnstile token，`POST /api/reports`。
2. Worker 依第 6 節檢查；任一失敗回 4xx 與欄位級錯誤訊息。
3. 通過則產生編輯密鑰，連同其雜湊寫入 D1，回 `201 {id, edit_token}`。
4. 前端把該點暫存 `localStorage` 立即顯示、把編輯連結存進「我的回報」，並告知約 15 分鐘後正式出現。
5. 下一次 cron 把它納入快照，邊緣快取在 5 分鐘內過期後所有人看到。

### 4.2 官方解列紀錄（M2）

1. 管線爬列表頁，只下載標題含「委員會」的議程與紀錄 PDF（幹事會沒有解列表）。
2. 抽「受保護樹木需解除列管案件」表，每列產一筆回報：`source` = 樹保會解除列管紀錄、`evidence` = 機關官網公告或計畫書、`protected_tree_id` = 表中編號、`note` = 解列原因與說明原文、`external_ref` = `<meeting-id>:<項次>`。
3. `observed_at`：從說明欄解析民國日期（現勘日期），解析不到用會議日期並在 `note` 前綴「日期為會議日期」。
4. 病因 tag 由關鍵字表對應（褐根病、倒伏、腐朽、枯死、颱風等），對不到留空。
5. 座標：以 `protected_tree_id` 查 `data/protected-trees/` 的所有歷史版本，找到就上圖，找不到進 `pending.json`。
6. 產 `import.sql`，以 `wrangler d1 execute --remote --file` 匯入。

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

處置（僅修枝葉、僅剩主幹、僅剩根部、連根移除、已移植、樹穴填平、原地保留）、證據來源（六項）、資料來源（四項）同格式。`domains.ts` 是白名單陣列，第一版收 14 個網域：`threads.net`、`threads.com`、`instagram.com`、`facebook.com`、`fb.com`、`x.com`、`twitter.com`、`imgur.com`、`flickr.com`、`youtube.com`、`youtu.be`、`plurk.com`、`dcard.tw`、`ptt.cc`；比對規則見第 6 節第 9 條。`snapshot.ts` 定義快照欄位順序與 `schema` 版本。build script 把三者輸出成 `shared/generated/*.json` 並 commit，Python 只讀 JSON。

快照格式：

```json
{ "schema": 1, "generated_at": "2026-09-18T08:15:00Z",
  "columns": ["id","lat","lng","species","causes","dispositions","evidence","source","note","link","observed_at","protected_tree_id","inventory_tree_id","created_at"],
  "rows": [["01J…",25.03412,121.54321,"榕",[1],[3],1,1,"…","https://www.threads.net/…","2026-09-10","1525",null,"2026-09-18T07:02:11Z"], …] }
```

不含 `reporter_hash`、`status`、`edit_token_hash`、`updated_at`；只含 `status = 0` 的列。

---

## 6. 伺服器端驗證（`POST /api/reports`，`PUT /api/reports/<id>` 同）

全部在 Worker 執行，順序如下，任一失敗即停。`PUT` 在第 1 條之前先看編輯密鑰的形狀（不對就 404），第 12 條不做（保留原本的 `reporter_hash`），最後以 UPDATE 的 WHERE 決定密鑰是否打得開這一筆：

1. `Content-Type` 為 JSON、body 小於 16 KB、可解析為 JSON（Turnstile token 在 body 裡，所以解析失敗算在這一條）。
2. Turnstile token 向 Cloudflare 驗證成功，且 `remoteip` 一致。
3. zod schema：欄位型別、未知欄位拒收。
4. `lat`、`lng` 落在 `BBOX`（緯度 24.94 到 25.24、經度 121.43 到 121.68），四捨五入到 5 位。
5. `causes`、`dispositions`、`evidence` 的每個代碼存在於 `shared/tags.ts`；`source` 由伺服器強制為 1，客戶端傳的值忽略。
6. `evidence` 為「無公告，僅目擊」或「高風險掛牌」時，`causes` 必須為空。
7. `species` 去頭尾空白、50 字內。
8. `note` 剝除所有 URL 與 `www.` 起頭的字串，剝除後 300 字內（字數以 code point 計，`species` 同）。
9. `link` 為合法 `https` URL，hostname 等於或以 `.` 結尾比對白名單網域。
10. `observed_at` 為合法日期、不晚於今天（Asia/Taipei）、不早於 2000-01-01。
11. `protected_tree_id`、`inventory_tree_id` 為字串且符合格式（前者數字、後者兩碼字母加十碼數字，接受大小寫、存成大寫）；不驗證存在性。
12. 計算 `reporter_hash = sha256(REPORTER_SALT + CF-Connecting-IP)`。

錯誤回應為 `400 { errors: [{ field, message }] }`（停在第一個失敗的步驟，但回報該步驟找到的所有欄位錯誤），Turnstile 失敗為 `403`，body 過大為 `413`。不做 IP 限流（SPEC 第 2 節）。純函式規則放 `shared/validation.ts`，前端表單直接共用。

---

## 7. 圖磚

| 用途 | 來源 | URL 範本 | 條件 |
|---|---|---|---|
| 底圖 | NLSC 通用電子地圖 | `https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}`（灰階換 `EMAP01`） | 免申請，註明出處 |
| 正射（使用中） | NLSC `PHOTO2` | 同 EMAP 範本換圖層名 | 免申請，註明出處 |
| 正射（候選，2026-09-20 起暫不使用） | 都發局歷史圖資（圖層 Image_3857「最新版航測影像」，2026-09 實測指向 2021 年航照） | `https://www.historygis.udd.gov.taipei/arcgis/rest/services/Aerial/Ortho_2021/MapServer/WMTS/tile/1.0.0/Aerial_Ortho_2021/default/GoogleMapsCompatible/{z}/{y}/{x}`（服務只接受 GetCapabilities 的 ResourceURL 形式，短路徑回 404；回 image/jpeg、帶 CORS、範圍只涵蓋臺北） | 「不得對外流通發布予第三方」條款未澄清；授權確認是獨立待辦，回覆同意後再切回 |

圖磚 URL 集中在 `web/src/basemaps.ts`（`ACTIVE_ORTHO`），但切換正射來源不是只改一行：attribution 字串標示航照的來源機關，`web/src/ui-strings.json`、`web/src/content/attribution.html`、`web/__tests__/content.test.ts` 必須同時改，否則顯名會錯。不預抓、不快取到自己的儲存。attribution 常駐地圖右下，現行字串：「底圖與航照 © 內政部國土測繪中心｜受保護樹木 © 臺北市政府文化局（政府資料開放授權條款－第1版）｜回報資料 CC BY 4.0」；切回都發局時改為「底圖 © 內政部國土測繪中心｜航照 © 臺北市政府都市發展局｜受保護樹木 © 臺北市政府文化局（政府資料開放授權條款－第1版）｜回報資料 CC BY 4.0」。

---

## 8. 部署與環境

- 帳號：Cloudflare 帳號（子網域 `taipeitreewatch`）、GitHub organization `taipei-tree-watch`。網址 `https://taipei-tree-watch.taipeitreewatch.workers.dev`，不買網域。
- `wrangler.toml`：`name = "taipei-tree-watch"`、`main = "worker/src/index.ts"`、`assets = { directory = "web/dist" }`、`triggers.crons = ["*/15 * * * *"]`、D1 與 KV bindings、`observability.enabled = true`。
- 環境只有一個（production）。本機開發用 `wrangler dev` 加 `--local` D1 與 KV。
- Cloudflare 憑證：`CLOUDFLARE_API_TOKEN`（權限：Workers Scripts、D1、KV、Workers Static Assets）與 `CLOUDFLARE_ACCOUNT_ID` 放在部署機器的 shell 環境，不進 repo。Worker secrets 用 `wrangler secret put` 設一次。
- 不使用 GitHub Actions；檢查與部署都是本機 npm script（工具版本見 `TECH-STACK.md` 第 7 節）：
  - `npm run check`：`build:shared` 並確認 `shared/generated` 無 diff → `typecheck` → `lint` → `vitest`（Worker 測試用 `@cloudflare/vitest-pool-workers`）。
  - `npm run check:pipelines`：`uv sync` → `ruff check` → `pytest`。
  - `npm run deploy`：`check` 通過後 `npm run build` → `wrangler deploy`。
  - 管線由本機排程執行，產出 commit 回 `main`。
- 不開 PR、不做預覽環境；直接 push `main`。

---

## 9. 資料保全

| 資產 | 機制 | 保留 |
|---|---|---|
| 公開快照 | `snapshot-backup` 每日 commit 到 `data/snapshots/` | 永久（git 歷史） |
| KV 歷史版本 | cron 保留最近 48 份 | 12 小時 |
| D1 完整內容（含 `reporter_hash`） | `d1-export` 每週寫到本機備份目錄 | 90 天 |
| 管線原始輸入 | 不保留原始 CSV 與 PDF，只保留轉換後 JSON 與來源 URL | 永久 |

D1 免費層無自動備份；若之後需要更長的完整備份再評估綁卡開 R2。

---

## 10. 維運

- **軟刪除**：`wrangler d1 execute taipei-tree-watch --remote --command "UPDATE reports SET status = 1 WHERE id = '…'"`，最多 15 分鐘後從快照消失；要立即生效再手動觸發 cron（`wrangler triggers` 或 dashboard）。`status = 2` 是回報者自己撤回的，除非回報者要求，不要改回 0。
- **補發編輯連結**：`npm run issue:edit-links -- --remote`，見 `RUNBOOK.md` 第 5 節。輸出檔是可用的憑證，存完就刪。
- **回滾快照**：從 `snapshot:index` 挑版本，`wrangler kv key get` 再 `put` 回 `snapshot:latest`；或從 `data/snapshots/<date>.json` 復原。回滾只撐到下一次 cron，cron 會用資料庫現況蓋回去。
- 兩者的完整步驟與 2026-09-20 的演練紀錄在 `RUNBOOK.md`。實測 cron 寫完 KV 後，公開端點還要約 30 到 80 秒才讀得到新版（KV 全球傳播），另外 `/api/snapshot` 的 `max-age=300` 會讓沒帶查詢字串的讀取再晚最多五分鐘。
- **觀測**：Workers Logs（dashboard）與 `wrangler tail`；Web Analytics 看流量。不接第三方錯誤追蹤。
- **額度警戒**：D1 每日 5M rows read，cron 每次讀全表，一萬筆時每日 96 萬 rows；寫入 Worker 每筆 1 row。KV 每日 1,000 writes，每次 cron 是 3 次 put（latest、ts key、index）加穩定期 1 次 delete，96 次排程約 384 次。Workers 每日 10 萬 requests，靠 `max-age=300` 讓快照讀取多數命中邊緣快取。

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
| Workers Free 的 10 ms CPU 也套用在 cron，一萬筆 JSON 序列化可能貼近上限 | 本機實測（2026-09-19，10,000 筆可見列）：cron wall-clock 40 到 66 ms 含本機 D1 與 KV I/O，本機 workerd 量不到 CPU time；純 JS 序列化與 JSON.parse 在 Node 粗估 4 到 5 ms。快照 1,894,799 bytes（ASCII 假資料，真實資料更大），gzip 約 385 KB。遠端實測（2026-09-20，1 到 2 列）：`wrangler tail` 三次 cron 都是 CPU 2 ms、wall 560 到 596 ms，其中 build 259 到 263 ms、store 284 到 321 ms，幾乎全是 D1 與 KV 的往返；同期一次 `POST /api/reports` 是 CPU 8 ms、wall 78 ms，那一筆含冷啟動。遠端的量還不能外推到一萬筆，因為列數幾乎為零，序列化成本尚未進場；資料長到數千筆時要重量一次。超標就切成多個 `snapshot:part:<n>` 加 manifest，或升 Paid（USD 5/月） |
| 都發局正射 WMTS「不得對外流通發布予第三方」條款 | 2026-09-20 決定：確認前不使用，航照已切 NLSC `PHOTO2`；授權確認為獨立待辦（找窗口、擬信、人工寄出），同意後切回並改 attribution 四個檔案（第 7 節） |
| 已解列的樹在現有資料集無座標 | M2 先匯能對到的，`pending.json` 統計數量再決定是否做地址地理編碼 |
| 清冊 diff 誤判（重編號、資料修正） | M3 離線觀察數週再決定上線 |
| 政府 WMTS 無 SLA、無公開流量限制 | 圖磚失效不影響回報功能；備援切換一處改 |
| data.taipei 的根憑證（TWCA Global Root CA）缺 Subject Key Identifier，Python 3.13 起 `ssl.create_default_context()` 預設 `VERIFY_X509_STRICT` 會拒絕連線；httpx 下載在本機 Python 3.14 失敗，curl 正常 | 第一版不自動更新（2026-09-19 決定），`trees.json` 由 curl 手動取得後以 `--input` 產出，httpx 下載函式未經實測。做自動排程時再擇一：只對該 client 清 strict 旗標（保留鏈與 hostname 驗證）、pipelines 釘 Python 3.12、或改用 curl 下載 |
| 前端一次載入全量快照，一萬筆約數百 KB | 陣列格式加 brotli；超過再分區塊或改 PMTiles 向量 |
| Lighthouse 行動版 performance 只有 56（2026-09-19，302 筆回報）：FCP 1.7 s、LCP 4.5 s、TBT 1,590 ms、CLS 0；瓶頸是 MapLibre 在 4 倍 CPU 節流下約 3 秒的腳本執行，傳輸量 672 KiB 不是問題 | 地圖模組已改 dynamic import（46 到 56）；再往上要不渲染 WebGL 地圖，與本頁目的衝突。門檻改為「行動版 FCP 低於 2 秒且 CLS 低於 0.1」，分數只記錄不當關卡 |
| MapLibre 6 從自己的 module URL 推導 worker 路徑，打包後不存在，圖層全部不出現 | 用 Vite `?worker&url` 產出 worker 再 `setWorkerUrl`，`vite.config.ts` 的 `worker.format` 設 es；升級 MapLibre 時重新確認 |
| 受保護樹木資料集有座標合法但與地址不符的列（例：編號 2190 座標在大安區、地址在內湖區） | 管線只丟格式無效的座標；地址與座標不符的列先保留並記錄，是否加行政區一致性檢查留待後續版本 |
