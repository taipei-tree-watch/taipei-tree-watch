# 維運手冊

這份文件寫的是上線後會重複執行的操作：軟刪除一筆回報、把快照回滾到前一版、以及兩支本機備份工作的排程。每一節都是照著做就能完成的步驟，附上 2026-09-20 首次演練的實際觀察。

設計背景與決策理由在 `TECH-SPEC.md`，部署步驟在 `DEPLOY.md`，這裡不重複。

## 0. 前置

所有 wrangler 指令都需要 Cloudflare 帳號 id 與 API token。兩者放在密碼管理工具，取用時逐條帶進單一指令的環境，不要寫進檔案、不要 export 到 shell：

```bash
CLOUDFLARE_ACCOUNT_ID=$(lpass show --username taipei-tree-watch/cloudflare-api) CLOUDFLARE_API_TOKEN=$(lpass show --password taipei-tree-watch/cloudflare-api) npx wrangler <子命令>
```

以下各節為了好讀，只寫 `npx wrangler …` 的部分，實際執行時前面都要補上這一段。

線上位址是 `https://taipei-tree-watch.taipeitreewatch.workers.dev`。cron 每 15 分鐘重建一次快照，所以任何對資料庫的修改最多 15 分鐘後才會反映到 `/api/snapshot`。

## 1. 軟刪除一筆回報

系統沒有管理介面，隱藏一筆回報是直接改資料庫的 `status` 欄位：0 是顯示、1 是隱藏。列不會被刪掉，只是下一次 cron 重建快照時不會被選進去。`status = 2` 是回報者用編輯連結自己撤回的，同樣不進快照；除非回報者要求，不要把它改回 0。隱藏（1）之後，那筆的編輯連結也跟著失效。

### 步驟

先確認要隱藏的是哪一筆，用座標、樹種或 `created_at` 找出 id：

```bash
npx wrangler d1 execute taipei-tree-watch --remote --command "SELECT id, lat, lng, species, note, created_at FROM reports WHERE status = 0 ORDER BY created_at DESC LIMIT 20"
```

把那一筆標成隱藏：

```bash
npx wrangler d1 execute taipei-tree-watch --remote --command "UPDATE reports SET status = 1 WHERE id = '<id>'"
```

回應裡的 `changes` 要是 1。是 0 代表 id 打錯，不是已經隱藏。

等下一次 cron（最多 15 分鐘）重建快照，或到 dashboard 手動觸發一次。之後確認該筆已從公開快照消失：

```bash
curl -s "https://taipei-tree-watch.taipeitreewatch.workers.dev/api/snapshot?cb=$(date +%s)" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['generated_at'], len(d['rows']))"
```

查詢字串是為了避開邊緣快取（快照的 `Cache-Control` 是 `max-age=300`）。沒有這一段的話，就算 KV 已經換版，讀到的也可能是最多五分鐘前的副本。

要復原就把 `status` 改回 0，資料沒有被刪除。

### 2026-09-20 演練結果

資料庫裡放兩筆測試回報，一筆用 `wrangler d1 execute` 直接寫入，一筆從線上 API 送出（回 201 與一個 ULID）。

| 時間（UTC） | 動作 | 觀察 |
|---|---|---|
| 04:00:51 | cron 重建 | `rows=2`，`/api/snapshot` 兩筆都在 |
| 04:16 | `UPDATE … SET status = 1` | `changes` 為 1 |
| 04:15:51 | cron 重建 | Worker 日誌 `rows=1 chars=362` |
| 04:17:10 | 讀公開快照 | 只剩一筆，被隱藏的那筆消失 |

從 cron 寫完 KV 到公開端點讀得到新版，中間約 80 秒，這是 KV 的全球傳播延遲，不是邊緣快取。所以「最多 15 分鐘」的說法實務上要再加一到兩分鐘。

演練後兩筆測試資料都用 `DELETE` 清掉，`SELECT COUNT(*)` 回 0。

## 2. 把快照回滾到前一版

cron 每次重建都會多存一個 `snapshot:<generated_at>` 的歷史版本，保留最近 48 份，也就是 12 小時。回滾就是把其中一份的內容寫回 `snapshot:latest`。

會用到這一節的情況是快照本身壞了（例如某次匯入寫進了錯的資料），而不是要隱藏單一筆回報。隱藏單筆看第 1 節。

### 步驟

先看有哪些版本可以選：

```bash
npx wrangler kv key list --binding SNAPSHOTS --remote
```

輸出每個 key 都帶 `metadata.generated_at`。挑一個要回去的版本，取出它的內容：

```bash
npx wrangler kv key get "snapshot:<generated_at>" --binding SNAPSHOTS --remote --text > rollback.json
```

確認取出來的是預期的那一份，再寫回去：

```bash
npx wrangler kv key put "snapshot:latest" --binding SNAPSHOTS --remote --path rollback.json
```

確認公開端點已經換版：

```bash
curl -si "https://taipei-tree-watch.taipeitreewatch.workers.dev/api/snapshot?cb=$(date +%s)" | grep -i etag
```

手動寫入的值沒有 KV metadata，所以讀取路徑會退而從內容前 256 字元抓 `generated_at` 來組 ETag。ETag 仍然正確就代表這條退路有在運作。

**回滾只撐到下一次 cron。** cron 不看 `snapshot:latest` 現在是什麼，它每 15 分鐘就用資料庫的現況重新蓋過去。如果問題出在資料庫的資料，回滾只是爭取時間，真正要做的是修資料庫，否則下一次 cron 又會把壞資料寫回來。

12 小時以前的版本不在 KV 裡，要從 `data/snapshots/<date>.json` 的每日備份復原（見第 3 節）。

### 2026-09-20 演練結果

當時 `snapshot:latest` 是 04:45:51 的版本，回滾目標是前一版 04:30:51。

| 時間（UTC） | 動作 | 觀察 |
|---|---|---|
| 04:47:09 | 把 04:30:51 的內容寫回 `snapshot:latest` | 寫入成功 |
| 04:47:37 | 讀公開快照 | `generated_at` 變成 04:30:51，ETag 同值 |
| 04:47 到 04:50 | 持續讀 | 八次讀取都是回滾後的版本，穩定 |
| 05:00:51 | cron 重建 | Worker 日誌 `rows=1`，key 為 05:00:51 |
| 05:01:41 | 讀公開快照 | `generated_at` 回到 05:00:51 |

寫入到公開端點換版約 28 秒。ETag 在沒有 metadata 的情況下仍然正確，退路如設計運作。

## 3. 本機備份排程

兩支工作都在本機跑，不經 CI。

| 工作 | npm script | 頻率 | 產出 |
|---|---|---|---|
| `snapshot-backup` | `npm run backup:snapshot` | 每日 | `data/snapshots/latest.json` 與 `data/snapshots/<date>.json`，跑完要 commit |
| `d1-export` | `npm run backup:d1` | 每週 | `~/backups/taipei-tree-watch/taipei-tree-watch-<date>.sql`，不進 repo，保留 90 天 |

`d1-export` 的輸出含 `reporter_hash`，屬於個人資料，所以刻意寫在 repo 外面。備份目錄與保留天數可以用環境變數 `TTW_BACKUP_DIR` 與 `TTW_BACKUP_RETENTION_DAYS` 覆寫。腳本會在匯出結果為空檔時直接失敗，避免用一個空檔蓋掉上一份好的備份。

### 3.1 launchd plist 範例

plist 本身不進 repo，因為裡面會有這台機器的絕對路徑。把下面兩個檔案放到 `~/Library/LaunchAgents/`，並把 `<REPO>` 換成本機 repo 的絕對路徑、`<NODE_BIN>` 換成 `dirname $(which npm)` 的輸出。

`local.taipei-tree-watch.snapshot-backup.plist`，每日 03:20 執行：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>local.taipei-tree-watch.snapshot-backup</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-lc</string>
    <string>cd &lt;REPO&gt; &amp;&amp; npm run backup:snapshot</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>&lt;NODE_BIN&gt;:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>3</integer>
    <key>Minute</key><integer>20</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>&lt;REPO&gt;/workdocs/snapshot-backup.log</string>
  <key>StandardErrorPath</key>
  <string>&lt;REPO&gt;/workdocs/snapshot-backup.log</string>
</dict>
</plist>
```

`local.taipei-tree-watch.d1-export.plist`，每週日 03:40 執行（`Weekday` 0 是週日）：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>local.taipei-tree-watch.d1-export</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-lc</string>
    <string>cd &lt;REPO&gt; &amp;&amp; npm run backup:d1</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>&lt;NODE_BIN&gt;:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Weekday</key><integer>0</integer>
    <key>Hour</key><integer>3</integer>
    <key>Minute</key><integer>40</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>&lt;REPO&gt;/workdocs/d1-export.log</string>
  <key>StandardErrorPath</key>
  <string>&lt;REPO&gt;/workdocs/d1-export.log</string>
</dict>
</plist>
```

`workdocs/` 已被 git 忽略，日誌放在那裡不會被 commit。

### 3.2 安裝與驗證

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/local.taipei-tree-watch.snapshot-backup.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/local.taipei-tree-watch.d1-export.plist
```

確認兩個工作都被載入：

```bash
launchctl print gui/$(id -u)/local.taipei-tree-watch.snapshot-backup
```

不等排程、立刻跑一次來驗證：

```bash
launchctl kickstart -p gui/$(id -u)/local.taipei-tree-watch.snapshot-backup
```

改過 plist 之後要先 `launchctl bootout` 再 `bootstrap`，`launchd` 不會自己重讀檔案：

```bash
launchctl bootout gui/$(id -u)/local.taipei-tree-watch.snapshot-backup
```

兩件要注意的事：

- 兩支工作都需要密碼管理工具已經登入。`snapshot-backup` 只打公開 API，不需要憑證；`d1-export` 需要，登入逾時它會失敗並寫進日誌。
- `d1-export` 用的是登入 shell（`bash -lc`），才讀得到使用者 profile 裡的 `npx` 與密碼管理工具路徑。

## 4. 觀測

看即時請求與 cron：

```bash
npx wrangler tail --format json > tail.jsonl
```

輸出是一串 JSON 物件，每個物件是一次呼叫，`cpuTime` 與 `wallTime` 的單位是毫秒，`event.scheduledTime` 存在就代表那是 cron 而不是 HTTP 請求。cron 的那一筆會帶一行 `snapshot: key=… rows=… chars=… build_ms=… store_ms=…` 的日誌。

`tail` 只有在連線期間才收得到事件，離線期間的記錄要去 dashboard 的 Workers Logs 看。

## 5. 編輯連結上線與補發

### 5.1 上線（一次性）

先套 migration，再部署。順序反過來的話，新版 Worker 寫入 `edit_token_hash` 時欄位還不存在，所有新回報都會失敗：

```bash
npx wrangler d1 migrations apply taipei-tree-watch --remote
```

```bash
npm run deploy
```

部署後從線上送一筆測試回報，確認成功畫面有編輯連結，換一個瀏覽器打開它能看到修改表單，再用它撤回這筆測試回報。

### 5.2 補發給舊回報

migration 之前建立的回報沒有編輯密鑰。補發只處理 `status = 0` 且 `source = 1`（使用者回報）而 `edit_token_hash` 為 NULL 的列，官方紀錄與已隱藏的不發：

```bash
npm run issue:edit-links -- --remote
```

腳本先把連結寫進 `workdocs/edit-links_remote_<時間>.md`，再把雜湊寫進 D1，所以 D1 寫入失敗時留下的是一批無效連結，不會有「有效但沒人拿到」的連結。重跑只會補新出現的無密鑰列，已有密鑰的不會被覆蓋。

輸出檔最後一段是一段 JavaScript。用要存連結的瀏覽器打開線上網站，把它貼進開發者工具的 console 執行，頁面重新整理後，打開「回報」面板，標題列會出現「我的回報」。它會和瀏覽器裡原本的清單合併，不會蓋掉。

輸出檔裡的每一條都是可用的憑證。存進瀏覽器（或密碼管理工具）之後就刪掉，不要 commit、不要貼到任何地方。

