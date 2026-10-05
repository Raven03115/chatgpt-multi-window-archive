# PROJECT_STATE

## 目的與範圍

此 Repository 是 Windows 上的 ChatGPT Multi Pane Electron 工具，直接載入官方 `chatgpt.com`，提供共用官方側欄與多個獨立 ChatGPT 窗格。

目前工作項目是 2026-10-05 側欄「探索」選單路由相容性修正：探索 popup 可正常開啟，但點選其中的地圖、圖像、GPT、網站等項目後沒有任何反應；一般 ChatGPT 網頁端可正常使用。

## 目前權威來源

- Repository：`Raven03115/chatgpt-multi-window-archive`
- 正式分支：`main`
- 正式分支最新已驗收功能來源：`main`
- Explore 修正來源分支：`fix/chatgpt-nested-dialog-2026-09-28`
- Explore 修正程式 HEAD：`d9b23fad4392c392d2fb7409813a4fd65a15df34`
- 2026-10-05 使用者已人工驗收探索功能恢復正常，並已將修正 fast-forward 合併至 `main`。

## 技術棧與重要版本

- Electron `43.1.0`
- package version `4.6.2`
- Node.js test runner：`node --test`
- 啟動：`npm start`
- 統一驗證：`npm run verify`

## 已完成

### 2026-09-28 ChatGPT UI compatibility

- 新版 Rename compact dialog 已改為依 explicit dialog semantic + compact geometry + interactive content 判定，不要求 root opaque。
- 已移除修改官方 ChatGPT dialog DOM alpha 的舊 workaround。
- `MaxListenersExceededWarning` 已以 shared `executeJavaScript()` load gate 修正，未提高 EventEmitter listener 上限。
- 使用者已驗收一般對話／Project Rename、pane 載入與切換正常；已合併到 `main`。

### 2026-10-03 Scheduled Tasks result compatibility

- 使用者 diagnostics 證實 `GET automation-detail-action` 原先未移除 Electron UA、request 不匹配且 HTTP 404；相鄰 supported Automations requests 為 HTTP 200。
- 已新增 regression test，並只把 `GET automation-detail-action` 加入已觀察到的 supported request pairs。
- 使用者已人工驗收 Scheduled Tasks 任務執行結果恢復正常；已合併到 `main`。

### 2026-10-05 Explore menu routing diagnosis

- 使用者 diagnostics 可重複看到：
  - 探索 menu trigger 正常：`menu-trigger-detected`、`popup-detected`。
  - 點選探索 menu item 後發生 `native-route-ignored`。
  - routeKind 為 `unknown-workspace`。
  - reason 為 `native-route-without-intent`。
- 同一份 diagnostics 中，其他已有 one-time intent 的 `unknown-workspace` route 可正常被 consume、`pane-load-url` 並 `route-forwarded`。
- Root cause：探索項目是 native `role=menuitem` SPA action；現行 preload 保留 native menu click，但沒有對後續 workspace navigation 提供可驗證的一次性路由授權。

### 2026-10-05 Explore routing compatibility

- 第一版候選修正曾把所有 `menuitem` 直接納入既有 Project action intent。
- 使用者執行完整 verify 後，offline Electron fixture 正確失敗：`ordinary menuitem emitted an intent`。
- 這證明第一版修正範圍過廣，會破壞既有「一般 native menu action 不應產生 Project intent」的隔離保證，因此該設計已被取代，不再採用。
- 已重新設計為獨立的 `menu route candidate` / `menuRouteIntent`：
  - 普通 `menuitem` 仍不是 Project action candidate。
  - overlay policy 的 `menu-action` 仍維持 `projectIntent=false`。
  - preload 只送出新的 `chatgpt-sidebar-menu-route-candidate`，保留 ChatGPT 原生 click。
  - main process 建立獨立、最多 1 秒、綁定 active pane + generation 的 `menuRouteIntent`。
  - 該 intent 只允許後續 `unknown-workspace` native route forward；conversation、project-workspace、project-conversation 不會因 menuRouteIntent 被轉送。
  - Settings、Search、dialog、close、upgrade/external、backdrop 不得建立 menu route candidate。
  - anchor、Project action、overlay/external route、dialog close、popup dismissal、workspace close 等情況會清除 stale menuRouteIntent。
- 已新增/更新 regression tests，明確要求 native menu navigation 與 Project intent 使用不同 IPC / policy 路徑。

## 重要決策與被取代方案

- 不採用：直接攔截探索項目 click 並自行硬編碼目的 URL。
- 不採用：把所有 `role=menuitem` 納入既有 Project action intent；verify 已證實會造成 ordinary menu regression。
- 現行：保留 ChatGPT 原生 menu click，使用獨立短效 menu route candidate，只授權後續 `unknown-workspace` route。
- 不採用：放寬所有 native navigation，使無 intent 的 sidebar route 都能進 pane。
- 現行：仍要求有效 one-time intent，且 menuRouteIntent 的可 forward routeKind 比 Project intent 更窄。
- 不採用：為此次 Explore 問題修改 Scheduled Tasks、Rename detector 或 pane `loadURL()` 邏輯。

## 已知問題與剩餘風險

- 使用者已人工驗收「探索」功能恢復正常，可正常開啟探索項目並使用。
- 使用者未另外貼出最終修正後完整 `148/148` 終端摘要，因此不可把完整 automated verify 記錄描述成已取得；已知上一輪 offline Electron fixture 已通過，後續兩個 CRLF static-test false failures亦已修正。
- 普通 native menu item 仍使用獨立短效 menu route candidate，只有後續 `unknown-workspace` navigation 可 consume；Project intent 隔離保留。
- Rename dialog 功能已正常，但開啟 modal 時背景 pane 被暫時收成 0×0、呈現大片黑色；這是已知 UI polish 項目，尚未處理，不能與 Explore 修復混在同一修改中。
- ChatGPT Web API / DOM 仍可能因官方改版再次變動。

## 最近測試證據

- 2026-10-05 使用者 diagnostics：Explore 選單點擊後可重複重現 `unknown-workspace + native-route-without-intent`；其他有 one-time intent 的同類 route 可正常 forward。
- 第一版 Explore 修正：使用者完整 verify 回報 offline Electron fixture failure `ordinary menuitem emitted an intent`，已據此撤銷「menuitem = Project intent」設計。
- 修訂版第二次 verify：offline Electron fixture 已通過，ordinary menu regression 已消失；148 個測試中 146 pass、2 fail。
- 剩餘 2 個 failure 都位於 `tests/route-policy.test.cjs` 的 static source slicing：測試用 LF-only 字串尋找 branch 邊界，但 Windows 讀取 source 時保留 CRLF，`indexOf(...\n...)` 找不到邊界而使 slice 延伸到後續 Project branch。Production code 與 Electron fixture 並未因此失敗。
- 已把這兩個 static assertions 改為 line-ending-agnostic regex，仍要求 native menu branch 內必須呼叫 `reportMenuRouteCandidate` 且不得呼叫 `reportProjectActionCandidate`；沒有刪除或弱化檢查。
- 使用者已完成最終 UI 驗收並回報探索功能可正常使用；最終完整 `npm run verify` 終端摘要未在對話中提供。

## 啟動與驗證方式

```powershell
cd D:\chatgpt-multi-window
git fetch origin
git switch --detach origin/fix/chatgpt-nested-dialog-2026-09-28
git rev-parse HEAD
npm run verify
npm start
```

## 下一個驗收條件

2026-10-05 Explore 功能性問題已由使用者人工驗收並合併至 `main`。下一個已知待處理項目是 Rename modal 開啟時背景 pane 被收成 0×0 而呈現大片黑色的 UI polish；該項目必須獨立處理，不得與已驗證的 Explore routing 邏輯混改。
