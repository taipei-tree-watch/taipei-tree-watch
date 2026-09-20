# 維運手冊

這份文件寫的是上線後會重複執行的操作：軟刪除一筆回報、把快照回滾到前一版、以及兩支本機備份工作的排程。每一節都是照著做就能完成的步驟，附上 2026-09-20 首次演練的實際觀察。

設計背景與決策理由在 `TECH-SPEC.md`，這裡不重複。

## 0. 前置

所有 wrangler 指令都需要 Cloudflare 帳號 id 與 API token。兩者放在密碼管理工具，取用時逐條帶進單一指令的環境，不要寫進檔案、不要 export 到 shell：

```bash
CLOUDFLARE_ACCOUNT_ID=$(lpass show --username taipei-tree-watch/cloudflare-api) CLOUDFLARE_API_TOKEN=$(lpass show --password taipei-tree-watch/cloudflare-api) npx wrangler <子命令>
```

以下各節為了好讀，只寫 `npx wrangler …` 的部分，實際執行時前面都要補上這一段。

線上位址是 `https://taipei-tree-watch.taipeitreewatch.workers.dev`。cron 每 15 分鐘重建一次快照，所以任何對資料庫的修改最多 15 分鐘後才會反映到 `/api/snapshot`。

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

