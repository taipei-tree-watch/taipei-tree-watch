# 部署

這份文件寫的是把 `main` 的現況部署到 Cloudflare Workers、以及部署後怎麼確認上線。資料庫的日常操作（軟刪除、快照回滾、備份）在 `RUNBOOK.md`。

線上位址是 `https://taipei-tree-watch.taipeitreewatch.workers.dev`。

## 1. 流程總覽

| 步驟 | 指令 | 何時需要 |
|---|---|---|
| 檢查 | `npm run check` | 每次，部署前先在本機確認 |
| 查 migration | `npx wrangler d1 migrations list taipei-tree-watch --remote` | 每次 |
| 套 migration | `npx wrangler d1 migrations apply taipei-tree-watch --remote` | 上一步列出待套用項目時 |
| 部署 | `npm run deploy` | 每次 |
| 驗證 | 見第 5 節 | 每次 |

凡是帶 `--remote` 的 wrangler 指令與 `npm run deploy` 都需要 Cloudflare 憑證，帶法見第 2 節。

## 2. 憑證

wrangler 從環境變數讀 `CLOUDFLARE_ACCOUNT_ID` 與 `CLOUDFLARE_API_TOKEN`。兩個值從哪裡取、怎麼帶進單一指令，照 `RUNBOOK.md` 第 0 節做，不要 export 到 shell，也不要寫進檔案。

`npm run deploy` 第一步會先檢查這兩個變數，沒設或是空字串就直接停下並指到這裡，不會先跑完檢查與 build 才失敗。空字串通常代表取值的那段指令失敗了，例如密碼管理工具沒有登入。

直接呼叫 wrangler 時沒有這層檢查，缺憑證會看到下列其中一種錯誤：

- `In a non-interactive environment, it's necessary to set a CLOUDFLARE_API_TOKEN environment variable`
- `The given account is not valid or is not authorized to access this service [code: 7403]`：`CLOUDFLARE_ACCOUNT_ID` 沒有帶到，或 token 不屬於這個帳號

## 3. Migration

先查遠端還缺哪些：

```bash
npx wrangler d1 migrations list taipei-tree-watch --remote
```

回 `No migrations to apply!` 就跳過這節。有待套用的項目時，**先套 migration，再部署**：

```bash
npx wrangler d1 migrations apply taipei-tree-watch --remote
```

順序反過來的話，新版 Worker 會寫入還不存在的欄位，所有新回報都會失敗。migration 直接改正式資料庫，套之前先確認 SQL 內容。

## 4. 部署

```bash
npm run deploy
```

它依序做四件事：檢查憑證、`npm run check`、`npm run build`、`wrangler deploy`。輸出很長，可以導到檔案再找關鍵字：

```bash
grep -E "Tests  |Uploaded|Deployed|workers.dev|Version ID|ERROR" deploy.log
```

成功時會看到 `Uploaded taipei-tree-watch`、`Deployed taipei-tree-watch triggers`、`schedule: */15 * * * *` 與 `Current Version ID`。

幾個常見狀況：

- build 的 chunk 大於 500 kB 警告是既有的，可以忽略。
- 如果檢查與 build 都過了、只在 `wrangler deploy` 那步失敗，程式碼沒變的話可以只補跑 `npx wrangler deploy`，`web/dist` 已經是這次的產物。
- `wrangler.toml` 的 `[vars]` 同時供應 Worker 與前端 build（經由 `scripts/wrangler-vars.ts`）。build 需要的項目不存在時，build 會直接失敗。

### `npm run check` 常見的失敗

`check` 會重新產生 `shared/generated`、確認它沒有差異，再跑 typecheck、lint 與測試。拉進新的改動之後，就算沒有衝突，也可能在這裡失敗：

- 改了 `shared/tags.ts` 卻沒有一起提交重新產生的 `shared/generated`。
- 某個元件新增了必填選項，但其他測試檔自己的 options helper 沒補上，typecheck 會失敗。
- 頁面上新增了一個 `<form>`，既有測試用 `querySelector('form')` 抓到的就變成另一個表單。選擇器要寫得夠具體，例如 `form.form-fields`。
- `theme-tokens.test.ts` 不允許在規則裡直接寫顏色值。顏色要寫成 `:root` 的 token，深色主題也要重新定義一次。

## 5. 上線驗證

以下請求都加上 `?cb=<隨機值>`。剛部署完，根網址可能還是邊緣快取的舊 HTML（回應標頭 `cf-cache-status: HIT`），幾分鐘後才會更新。

1. **前端是不是這次的 build**：從線上 HTML 的 `<script>` 標籤取出 `assets/index-*.js` 的檔名，和本機 `web/dist/assets/` 比對。同一頁也可能出現 preload 的其他 chunk，要比的是 script 標籤引用的那一支。

   ```bash
   curl -s "https://taipei-tree-watch.taipeitreewatch.workers.dev/?cb=$(date +%s)" | grep -o 'assets/index-[^"]*\.js'
   ```

2. **改動有沒有上去**：抓那支 JS 或 HTML，找這次新增的字串或 class。如果是刪除某段 UI，就確認那個字串只剩預期的出現處。
3. **API 正常**：

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "https://taipei-tree-watch.taipeitreewatch.workers.dev/api/snapshot?cb=$(date +%s)"
   ```

   要回 200。
4. **資料相關的改動**：快照由 cron 每 15 分鐘重建一次，寫進 KV 後還要約 80 秒才會傳播到全球。純前端改動重新整理就看得到。
5. **表單、API 或 migration 的改動**：從線上送一筆測試回報，確認成功畫面有編輯連結，換一個瀏覽器用編輯連結打開，再用它撤回這筆回報。這會寫進正式資料庫，做完要確認那筆已經撤回。

## 6. 部署前在本機預覽

- `npm run dev` 啟動的 `wrangler dev` 提供的是 `web/dist`，改了前端要先 `npm run build`，否則看到的是舊版。
- 本機 D1 一開始是空的，先套 migration，否則會看到 `no such table: reports`：

  ```bash
  npx wrangler d1 migrations apply taipei-tree-watch --local
  ```

- 要產生本機快照，以 `--test-scheduled` 啟動 `wrangler dev`，再打 `/__scheduled?cron=*/15+*+*+*+*` 手動觸發 cron。
- 本機 `data/snapshots/latest.json` 沒有回報。要測有回報的畫面，可以在 localStorage 寫假資料（待同步回報的 key 是 `ttw:pending-reports`）。假的編輯連結要是 26 碼 ULID 加 43 碼 token，格式不對會被悄悄丟掉。測完記得刪掉。
- 要測從樹木卡片回報的流程，可以直接開 `/?tree=<id>`，按「回報這棵樹」後地圖會自動縮放到可以進表單的層級。
- localhost 上出現 `cloudflareinsights.com` 的 CORS 錯誤是 Web Analytics beacon 造成的，不影響功能。
