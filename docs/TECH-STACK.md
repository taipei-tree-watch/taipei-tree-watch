# Taipei Tree Watch 技術棧

- 本文件一頁列出專案用到的語言、平台、套件與工具。各元件怎麼用、邊界在哪，寫在 `TECH-SPEC.md`；為什麼這樣選，寫在 `SPEC.md` 第 4 節與 `RESEARCH.md` 第 7 節。
- 版本以 `package.json`、`.nvmrc`、`pipelines/pyproject.toml` 為準，這裡只記主版本；升級主版本時同步改這份。

---

## 1. 總覽

| 層 | 技術 | 細節 |
|---|---|---|
| 前端 | TypeScript、Vite、MapLibre GL JS，MVP 階段不用 UI 框架 | 第 2 節、`TECH-SPEC.md` 第 3.1 節 |
| 後端 | Cloudflare Workers，無 web framework，zod 驗證 | 第 3 節、`TECH-SPEC.md` 第 3.2 節 |
| 資料儲存 | Cloudflare D1（回報）、KV（快照） | 第 3 節、`TECH-SPEC.md` 第 3.3、3.4 節 |
| 防濫用 | Cloudflare Turnstile | `TECH-SPEC.md` 第 3.5 節 |
| 共用定義 | TypeScript 原始檔，build 時產出 JSON 給 Python | 第 4 節、`TECH-SPEC.md` 第 5 節 |
| 資料管線 | Python、uv | 第 5 節、`TECH-SPEC.md` 第 3.7 節 |
| 測試與檢查 | Vitest、pytest、ESLint、ruff、tsc | 第 7 節 |
| 部署 | Wrangler，本機 npm script，不使用 CI 服務 | 第 7 節、`TECH-SPEC.md` 第 8 節 |

---

## 2. 前端 `web/`

| 項目 | 版本 | 用途 |
|---|---|---|
| TypeScript | 6 | 全部前端程式；MVP 階段直接操作 DOM，先不用 React、Vue 等框架 |
| Vite | 8 | 打包與開發伺服器；`define` 注入 Turnstile site key，`?worker&url` 產出 MapLibre worker |
| MapLibre GL JS | 6 | 地圖、raster 底圖與航照、回報點圖層；叢集用 GeoJSON source 內建的 `cluster: true` |
| Lucide（`lucide`） | 1 | 按鈕圖示；具名 import 逐個 tree shake，`createElement` 直接產生 SVG 元素，stroke 用 `currentColor` 跟著 token 換色；包裝在 `web/src/icons.ts`。之後改用 React 時換成同名的 `lucide-react`。ISC 授權，顯名在 `web/src/content/attribution.html` |
| CSS | | 單一 `web/src/style.css`，顏色全部是 `:root` token，深色模式用 `prefers-color-scheme` 覆寫 |

地圖模組以 dynamic import 載入，讓頂列與狀態列先出現。

---

## 3. Worker 與 Cloudflare 服務

| 項目 | 用途 |
|---|---|
| Cloudflare Workers | 原生 `fetch` 與 `scheduled` handler，處理 `/api/*` 與每 15 分鐘的快照 cron；`compatibility_date` 見 `wrangler.toml` |
| Workers Static Assets | 直送 `web/dist`，只有 `/api/*` 先進 Worker（`run_worker_first`） |
| D1 | `reports` 表；schema 由 `migrations/` 的 SQL 管理 |
| KV | `snapshot:latest`、歷史快照與 index |
| Turnstile | 回報表單的 Managed 模式 widget，Worker 端向 siteverify 驗證 |
| zod 4 | 請求 body 驗證 |
| Workers Logs 與 observability | 執行紀錄；以 dashboard 或 `wrangler tail` 查看 |
| Web Analytics | 規劃用來看流量，beacon 尚未加進 `web/index.html`（見 `TASKS.md`） |

ULID 由 `worker/src/routes/ulid.ts` 自行產生，不依賴套件。

---

## 4. 共用定義 `shared/`

`tags.ts`、`domains.ts`、`snapshot.ts` 是前端、Worker 與管線共用的 source of truth。`npm run build:shared`（`scripts/build-shared.ts`，以 tsx 執行）把它們輸出成 `shared/generated/*.json` 並進 git，Python 管線讀這份 JSON。

---

## 5. 資料管線與本機腳本

**Python 管線 `pipelines/`**

| 項目 | 版本 | 用途 |
|---|---|---|
| Python | 3.12 以上 | 管線語言 |
| uv | build backend `uv_build` 0.12 | 相依與虛擬環境管理，`uv.lock` 進 git |
| httpx | 0.28 | 下載外部資料 |
| pyproj | 3.7 | TWD97 TM2（EPSG:3826）轉 WGS84 |
| pypdf | 6 | 解析文化局樹保會 PDF |

目前實作的子命令只有 `protected-trees`；`delisting`、`inventory-diff` 還在規劃（`TASKS.md`）。

**Node 腳本 `scripts/`**：以 tsx 執行的 TypeScript，涵蓋 `snapshot-backup`、`issue-edit-links`、`build-shared`、`copy-assets`、`check-deploy-env`（`npm run deploy` 的第一步，缺 Cloudflare 憑證時提早停下並指向 `DEPLOY.md`）；`d1-export.sh` 是呼叫 `wrangler d1 export` 的 bash 腳本。定期執行的腳本由本機 launchd 排程，plist 範例在 `RUNBOOK.md` 第 3.1 節。

---

## 6. 外部服務與資料來源

| 來源 | 用途 |
|---|---|
| NLSC WMTS `EMAP` | 底圖 |
| NLSC WMTS `PHOTO2` | 航照（使用中） |
| 都發局歷史圖資 WMTS | 航照候選，授權確認前不使用（`TECH-SPEC.md` 第 7 節） |
| data.taipei 受保護樹木 CSV | `trees.json` 的來源 |
| 公園處清冊 CSV、文化局樹保會 PDF | M2、M3 管線的輸入 |

---

## 7. 開發、測試與部署

| 項目 | 版本 | 用途 |
|---|---|---|
| Node.js | 24.21（`.nvmrc`） | 開發與 build 環境 |
| Vitest | 4 | 前端、Worker 與腳本測試 |
| `@cloudflare/vitest-pool-workers` | 0.22 | Worker 測試跑在 workerd 裡，D1 與 KV 為本機模擬 |
| happy-dom | 20 | 前端 DOM 測試環境 |
| ESLint 與 typescript-eslint | 10、8 | TypeScript lint |
| pytest、ruff | 8.4、0.13 | Python 測試與 lint |
| Wrangler | 4 | 本機開發（`wrangler dev`）、D1 migration、部署 |

檢查與部署都是本機 npm script：`npm run check`、`npm run check:pipelines`、`npm run deploy`，流程見 `TECH-SPEC.md` 第 8 節。

---

## 8. 刻意不用的東西

| 不用 | 改用 | 理由出處 |
|---|---|---|
| 前端 UI 框架（MVP 階段） | 直接操作 DOM | 為了讓初版簡單，不是長期原則；之後若 React 等框架有明顯好處再評估 |
| Icon font、圖示 CDN | npm 套件的 SVG 圖示（Lucide），隨 bundle 出貨 | 本文件第 2 節 |
| Worker web framework | 原生 handler | `TECH-SPEC.md` 第 3.2 節 |
| Cloudflare Pages | Workers Static Assets | `RESEARCH.md` 第 7.3 節 |
| R2 | KV 存快照 | `RESEARCH.md` 第 7.3 節 |
| Google Maps | MapLibre 加政府 WMTS | `SPEC.md` 第 4 節 |
| GitHub Actions 等 CI 服務 | 本機 npm script | `TASKS.md` E0.3 |
| 第三方錯誤追蹤 | Workers Logs | `TECH-SPEC.md` 第 10 節 |
