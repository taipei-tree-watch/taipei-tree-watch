# Taipei Tree Watch 工作項目

依 `TECH-SPEC.md` 拆成 milestone 與 epic。每個 epic 列範圍與完成條件，不拆到 ticket 粒度；開工時再展開。標「人工」的項目需要帳號持有人操作，其餘可由開發者或 agent 執行。

依賴關係：M0 → M1 → M2 → M4；M3 只依賴 M0 與 `shared/`，可與 M2 平行。

---

## M0 帳號與 repo 骨架

目標：空專案可以從本機 `wrangler deploy` 出一個 hello world，`npm run check` 全數通過。

### E0.1 帳號建立（人工）
- 建 Cloudflare 帳號，workers.dev 子網域 `taipeitreewatch`
- 建 GitHub organization `taipei-tree-watch`，成員可見性 private，建 public repo `taipei-tree-watch`
- 建 Cloudflare API token（Workers Scripts、D1、KV、Static Assets 編輯權）與 Account ID，只放部署機器的 shell 環境變數 `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`，不進 repo 也不放 GitHub
- 建 Turnstile widget（hostname 為 workers.dev 網址），Site key 進 `wrangler.toml` vars、Secret key 用 `wrangler secret put`
- 開 Web Analytics，取 beacon token
- 完成條件：兩個帳號、API token、Turnstile widget、Web Analytics 皆就位，本機 `npx wrangler whoami` 看得到專案帳號

### E0.2 Repo 骨架
- 依 TECH-SPEC 第 2 節建目錄；`package.json`（Vite、TypeScript、ESLint、vitest、wrangler、zod、maplibre-gl）；`pipelines/pyproject.toml`（uv、ruff、pytest、pyproj、pypdf 或 pdfplumber、httpx）
- `wrangler.toml`：name、assets、D1 與 KV bindings、cron、observability
- `shared/tags.ts`、`domains.ts`、`snapshot.ts` 與 build script 產 `shared/generated/*.json`
- `LICENSE`（MIT）、`README.md`（只寫專案目的與授權）
- 完成條件：`npm run build` 產出 `web/dist`；`wrangler dev` 起得來；`uv run pytest` 跑空測試通過

### E0.3 檢查與部署腳本
- 狀態：2026-09-20 改為本機 npm script，不使用 GitHub Actions；原 `ci.yml`、`deploy.yml` 已移除
- `npm run check`：`shared/generated` 一致性、typecheck、eslint、vitest
- `npm run check:pipelines`：ruff、pytest
- `npm run deploy`：`check` 通過後 build 並 `wrangler deploy`
- 完成條件：push 一個 hello world 到 `main`，網址 `taipei-tree-watch.taipeitreewatch.workers.dev` 可開

---

## M1 回報寫入迴路加受保護樹木圖層

目標：一個真人可以在手機上選點、填表、送出，15 分鐘內在地圖上看到自己的點；地圖有受保護樹木底層並能關聯。

### E1.1 D1 schema 與 migration
- `migrations/0001_reports.sql` 依 TECH-SPEC 3.3
- 本機與 remote 各跑一次 `wrangler d1 migrations apply`
- 完成條件：`wrangler d1 execute --command "SELECT count(*) FROM reports"` 在 remote 回 0

### E1.2 寫入 API
- `POST /api/reports`：Turnstile 驗證、zod schema、TECH-SPEC 第 6 節 12 條檢查、ULID、INSERT
- vitest（workers pool）覆蓋每一條檢查的拒收與通過案例，包含 `source` 被強制為 1、`evidence` 為目擊時 `causes` 非空被拒、URL 剝除、白名單子網域比對
- 完成條件：測試全綠；用 curl 打 remote 成功寫入一筆並在 D1 查到

### E1.3 快照 cron 與讀取 API
- `scheduled`：查 `status = 0`、依 `shared/snapshot.ts` 組陣列、寫 `snapshot:latest`、`snapshot:<ts>`、維護 `snapshot:index` 保留 48 份
- `GET /api/snapshot`：KV 取值、`Cache-Control`、`ETag`、304 支援
- **CPU 實測**：塞一萬筆假資料，用 `wrangler dev` 與 remote 各觸發 cron 一次，記錄 CPU time；超過 8 ms 就在此 epic 內改為分批（多個 key 加 manifest）或決定升 Paid
- 完成條件：remote cron 跑過、`/api/snapshot` 回傳含剛寫入的那筆；CPU 實測數字寫進 `RESEARCH.md` 附錄或 TECH-SPEC 第 12 節

### E1.4 受保護樹木資產（第一版：一次性 dump）
- `pipelines protected-trees`：讀 CSV（`--input` 指定本機檔）、丟壞座標列、解析行政區、輸出 `data/protected-trees/trees.json`；與前版 diff 產 `changes/<date>.json`
- pytest：欄位對應、壞列處理、diff 邏輯
- build 時把 `trees.json` 複製進 `web/public/`
- 完成條件：`trees.json` 3,869 筆（3,874 減 5 壞列，見 TECH-SPEC 3.6）進 repo
- 狀態（2026-09-19）：**完成**。資料由 curl 手動下載後以 `--input` 產出；決定第一版不做自動更新，每週排程與 httpx 直連（data.taipei 憑證問題，TECH-SPEC 第 12 節）移到「後續版本」

### E1.5 前端地圖與圖層
- MapLibre 初始化、NLSC 底圖、都發局正射（預設關）、attribution
- 載入 `/api/snapshot` 與 `/trees.json`，兩層渲染，回報點依病因著色與 cluster
- 篩選面板：病因、處置、證據來源、資料來源、日期範圍
- 點擊回報顯示卡片：措辭依 SPEC 第 8 節，連結顯示網域、nofollow
- 說明區塊沿用 `web/src/content/` 六個片段（E1.7 已寫好），重排版面即可；attribution 的顯名年份改由 `trees.json` 的 `fetched_at` 帶入，不寫死
- 完成條件：手機與桌面各檢查一次；Lighthouse 行動版 FCP 低於 2 秒且 CLS 低於 0.1（performance 分數只記錄，理由見 TECH-SPEC 第 12 節）
- 狀態（2026-09-19）：**完成**。cluster 不顯示數字（需 glyphs 服務），改用圓圈大小分級加含褐根病即轉警示色；病因篩選多「未記載病因」選項（code 0，不儲存）
- 2026-09-20：正射切回 NLSC `PHOTO2`，都發局圖層保留在 `basemaps.ts` 但不啟用；切換要同時改 attribution 相關四個檔案（TECH-SPEC 第 7 節）。都發局授權確認列為 E1.8 的項目，上線前要閉環

### E1.6 選點與表單
- 準心選點：GPS flyTo、zoom 門檻 18、選點時自動開正射
- 20 公尺內受保護樹木偵測與一鍵關聯
- 底部 sheet 表單：欄位、預設值、病因區塊依證據來源收合、說明欄即時剝 URL、連結欄白名單提示、Turnstile widget；`web/src/content/safety.html` 常駐表單開頭；前端驗證直接呼叫 `shared/validation.ts`
- 送出、成功訊息、`localStorage` 暫存點
- 前端驗證與 `shared/` 共用同一份 tag 與白名單
- 完成條件：真機（iOS Safari、Android Chrome）完成一筆回報；錯誤訊息逐欄顯示
- 狀態（2026-09-19）：本機端到端完成（選點、關聯、送出、cron 後出現、暫存清空），真機待部署。實作差異：選點與填表分兩個模式（手機 sheet 會蓋住準心）；說明欄改「打字時提示、貼上與 blur 時剝除」（即時剝會讓 `www.` 打不出來）；Turnstile site key 先用 build 期 `VITE_TURNSTILE_SITE_KEY`，未設時用 Cloudflare 測試 key
- 待修：sheet 開啟時，桌面側欄與手機 sheet 都會蓋住右下角的縮放控制，選點時只能靠滾輪、雙指或 GPS 放大；zoom 門檻比較改用顯示值（一位小數），避免按鈕放大到 17.9999 時顯示 18.0 卻被擋

### E1.7 說明、免責、安全警語
- 安全警語常駐表單開頭（SPEC 第 8 節措辭，引臺東場與北市手冊原文）
- 說明頁：專案目的、「法規不要求移除前現場公告」、四類免責、褐根病科普（`RESEARCH.md` 6.11 草稿，不寫氰氮化鈣等三詞）、林試所診斷窗口、授權與 attribution
- 完成條件：說明內容經對照 `RESEARCH.md` 第 6 節逐句有來源

### E1.8 上線檢查
- 軟刪除 SOP 演練一次（隱藏一筆、觸發 cron、確認消失）
- 快照回滾演練一次
- `snapshot-backup`、`d1-export` 的本機排程（launchd 或 cron）啟用
- Web Analytics beacon 上線
- Turnstile 正式 widget 建好後，在 siteverify 回應加 `hostname` 比對（本機開發階段不比對）；決定 site key 注入方式並在 `npm run deploy` 帶入（見 TECH-SPEC 3.2）；真機確認 widget 挑戰 iframe 正常產生 token（自動化瀏覽器裡不會產生）
- 都發局正射授權確認（人工寄信）：
  - 找出都發局圖磚服務的聯絡窗口。介接說明 PDF 的文字是 CJK 子集編碼，需要 PDF 文字擷取工具才讀得出窗口；條款原文見 `RESEARCH.md` 5.2
  - 信中問一件事：公開網站把圖磚網址放在網頁中，由每位訪客的瀏覽器直接向都發局取圖、訪客為最終使用者，是否屬於介接說明第四點第三項的「對外流通發布予其他第三方使用」。一併問不允許時有無其他授權途徑、以及對公開網站的請求頻率期待
  - 同意則把 `web/src/basemaps.ts` 的 `ACTIVE_ORTHO` 改回 `ORTHO_UDD`，並同步 attribution 的四個檔案（TECH-SPEC 第 7 節）；不同意或未回覆則維持 `PHOTO2`，此項即為結案
  - 風險備註：圖磚由訪客瀏覽器直接取，違規時被終止服務的是訪客 IP，我方不會收到任何錯誤訊號，所以不能用「沒出事」當作可以用
- 完成條件：以上皆演練過並記在 `workdocs/`；都發局授權確認已有回覆，或已明確決定維持 `PHOTO2`

---

## M2 官方解列紀錄管線

目標：樹保會委員會議程與紀錄裡的解列案件，能對到座標的都以「資料來源＝樹保會解除列管紀錄」出現在地圖上。

### E2.1 爬取與下載
- 列表頁分頁爬取（`PageSize=200`），篩標題含「委員會」者，下載 PDF 到暫存（不進 repo），記錄 meeting-id、日期、標題、PDF URL 到 `data/delisting/index.json`
- 完成條件：2015-12 至今的委員會文件清單完整；重跑只抓新增

### E2.2 表格抽取
- 從 PDF 找「受保護樹木需解除列管案件」表，抽 項次／樹種／地點／編號／解列原因／說明／權管單位，處理跨頁與折行
- 民國日期解析（現勘日期）；病因關鍵字對應表放 `pipelines/` 並有測試
- 對每份文件輸出抽取信心（列數、缺欄數），低於門檻的文件列入 `review.json` 人工看
- 完成條件：抽樣 5 份不同年份文件人工比對，欄位正確率 95% 以上

### E2.3 座標對應與匯入
- 以編號查 `data/protected-trees/` 全部歷史版本取座標；找不到進 `pending.json`
- 產每份文件的回報列 JSON 與 `import.sql`（`INSERT OR IGNORE`，`external_ref` 去重）
- `pipeline-delisting.yml`：每週跑，commit JSON，`wrangler d1 execute --remote --file import.sql`
- 前端：資料來源篩選可切「只看官方紀錄」；卡片標示「來源：臺北市樹木保護委員會 第 N 屆第 M 次會議」並連到原 PDF
- 完成條件：remote D1 有官方紀錄列且快照含之；`pending.json` 數量與比例寫進 `RESEARCH.md`

### E2.4 待定位處理（視 E2.3 數量決定）
- 若 `pending.json` 佔比高：評估 NLSC 門牌定位 API 對「地址」欄的命中率，僅對門牌級地址做地理編碼，描述型地點不做
- 完成條件：決策與命中率記錄；做或不做都關閉

---

## M3 清冊消失偵測（離線實驗）

目標：判斷公園處清冊 diff 能否當可靠訊號。此 milestone 結束時只有數據與決策，不一定上線。

### E3.1 每日 diff 管線
- 下載 `TaipeiTree.csv`、`TaipeiParkTree.csv`，pyproj 轉 WGS84，以樹籤編號 diff 前一日，輸出消失、新增、座標異動清單到 `data/inventory/<date>.json`；原始 CSV 不進 repo
- `pipeline-inventory-diff.yml` 每日
- 完成條件：連續 30 天無中斷

### E3.2 誤判分析
- 統計：消失後 N 日內在 50 公尺內出現新編號的比例（重編號）、永久消失比例、與 M2 官方紀錄和使用者回報的空間重疊
- 決策：可接受則進 E3.3，否則關閉並記錄
- 完成條件：分析寫進 `RESEARCH.md` 新節

### E3.3 上線（條件成立才做）
- 消失且未被重編號吸收的樹籤編號匯入為「資料來源＝清冊消失偵測」，座標取消失前最後一版，`inventory_tree_id` 填編號
- 前端獨立圖層與篩選
- 完成條件：快照含此來源；說明頁寫明「只是訊號，原因不明」

---

## M4 熱點分析

目標：SPEC 第 7 節第一版之後的分析，在前端對快照計算，不加後端。

### E4.1 空間聚集
- 半徑 N 公尺內褐根病回報計數、同路段或同公園分組（路段從說明或清冊 `Region` 對應）
- 可依證據來源與資料來源切門檻

### E4.2 時間與風險層
- 依 `observed_at` 的時間軸播放
- 「殘根未清」（處置為僅剩根部、僅剩主幹、樹穴水泥填平）標為持續風險層
- 官方清冊消失但無回報層（依 M3 結果）
- 與受保護樹木疊合找高風險老樹群

完成條件：每一項在說明頁有一段「這張圖怎麼算的」。

---

## 後續版本

- **受保護樹木自動更新**：`pipeline-protected-trees.yml` 每週排程加手動觸發，commit 回 `main`。前提是先解 data.taipei 憑證問題（TECH-SPEC 第 12 節三個候選解法擇一）。第一版手動重跑：curl 下載 CSV 後 `uv run ttw-pipelines protected-trees --input <csv>`，commit `trees.json` 與 `changes/`。

## 橫向事項

- **tag 變更流程**：只在 `shared/tags.ts` 新增，不刪不重排；改完跑 build 產 JSON、前端與管線測試都要更新
- **文件同步**：任何影響 `SPEC.md`、`TECH-SPEC.md`、`CONTEXT.md` 的決策在同一個 commit 更新文件
