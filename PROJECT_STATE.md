# PROJECT_STATE

## 目的與範圍

此 Repository 是 Windows 上的 ChatGPT Multi Pane Electron 工具，直接載入官方 `chatgpt.com`，提供共用官方側欄與多個獨立 ChatGPT 窗格。

目前工作項目是 2026-10-08 側欄「設定」完整頁面（/profile）被多窗格覆蓋的問題。已依新證據放棄前一個大型 dialog 偵測候選方案，改以官方 Settings route 管理獨立的 full-page overlay。前一項 Explore 修復已在 main 完成驗收。

## 目前權威來源

- Repository：`Raven03115/chatgpt-multi-window-archive`
- 正式分支：`main`
- 正式分支最新已驗收功能來源：`main`
- Explore 修正來源分支：`fix/chatgpt-nested-dialog-2026-09-28`
- Explore 修正程式 HEAD：`d9b23fad4392c392d2fb7409813a4fd65a15df34`
- 2026-10-05 使用者已人工驗收探索功能恢復正常，並已將修正 fast-forward 合併至 `main`。
- Settings 修復基準 main HEAD：`02198741f100243689e7270658590ae9b6a5831f`。
- 目前 Settings 工作分支：`fix/settings-overlay-visibility-2026-10-08`；**尚未合併到 main**。

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

### 2026-10-08 Settings /profile 路由架構重評估及新候選版

- 先前 diagnostics 多次證實 `overlay-intent-pending` 1.5 秒後 `dialog-surface-timeout`，但當時並無足夠證據說明 Settings 的 DOM 結構。
- 2026-10-08 使用者再次實測：前一候選版僅初始幾秒顯示 Settings，隨後 pane 覆蓋右側；截圖左側為具有「返回應用程式」的完整設定頁，程式實際記錄 `native sidebar window route ignored: https://chatgpt.com/profile`。返回流程亦曾將根網址載入 pane，應避免覆寫原對話。
- 新事實證明前一版本「Settings 為大型 dialog」的架構假設不適用，現已將先前新增的 Settings DOM 尺寸特例、CSS 覆寫與 oversized dialog fixture **自 fix branch 檔案內容撤回**；沒有修改已正式驗收的 main。
- 新方案：
  - `lib/route-policy.cjs` 集中辨識 `/profile` 及其子路由為 `settings-page`，永不作為 workspace pane 目的地，僅在正確 HTTPS / chatgpt.com 主機生效。
  - `lib/overlay-policy.cjs` 新增 `settings-page` 狀態，持續 suppress panes、顯示完整官方 workspace 內容、對整個 overlay window 設 full shape；不依賴 1.5 秒 dialog timer。
  - main process 處理既有 sidebar 同頁導航與 `window.open(/profile)`：後者在原 sidebar overlay 視窗開啟設定，不建立另一個視窗，也不轉送 pane。
  - 設定頁返回根網址時只解除 Settings 全頁 overlay，恢復既有 WebContentsView bounds，不把 `https://chatgpt.com/` 載入 active pane；同時處理返回要求透過 `window.open` 的情況。
  - Settings 全頁狀態不會被 generic Rename/Search popup 偵測、Escape 的 fullscreen close timer 或 pane focus 事件意外解除。Search、Rename、Explore、Upgrade 原本行為保留。
  - full-page 模式重用已存在的 fullscreen CSS 可見性處理；不再以 DOM dialog 形狀猜測 Settings 的存活。
- 已補 `tests/route-policy.test.cjs` / `tests/overlay-policy.test.cjs` 與 `tests/settings-overlay-visibility.test.cjs`，並新增 offline Electron fixture 中 Settings full-page 狀態與不變動 pane URL 的測試。
- 仍是**待驗收候選版**。正式 Electron Windows `npm run verify` 與真實 ChatGPT UI 尚未執行，不得稱已完成修復。

## 重要決策與被取代方案

- 不採用：直接攔截探索項目 click 並自行硬編碼目的 URL。
- 不採用：把所有 `role=menuitem` 納入既有 Project action intent；verify 已證實會造成 ordinary menu regression。
- 現行：保留 ChatGPT 原生 menu click，使用獨立短效 menu route candidate，只授權後續 `unknown-workspace` route。
- 不採用：放寬所有 native navigation，使無 intent 的 sidebar route 都能進 pane。
- 現行：仍要求有效 one-time intent，且 menuRouteIntent 的可 forward routeKind 比 Project intent 更窄。
- 不採用：為此次 Explore 問題修改 Scheduled Tasks、Rename detector 或 pane `loadURL()` 邏輯。
- Settings 目前明確不採用：把完整 `/profile` 頁面硬塞入 modal dialog 尺寸判定，或單純延長 1.5 秒 timeout。已以 route-based full-page state 取代。
- Settings 目前推薦：基於使用者實際觀察到的 `/profile` 進行受控的全頁 overlay，並於返回後還原原 pane，不重載。

## 已知問題與剩餘風險

- 新版 Settings 使用 `/profile` 已由使用者執行紀錄證實，但官方網站仍可能改變路徑或返回流程；正式頁面全部操作尚未人工驗收。
- 本次已避免將首頁返回誤送進 pane，但使用者截圖中其它非 Settings 導航與 renderer errors 可能是獨立問題；若仍重現，需以發生時 diagnostics 區分。
- Electron UI 與真實網頁狀態尚未實測，尤其 `window.open` 與 full-page 導航、視窗焦點、背景 pane bounds 的實際表現需驗收。
- Rename modal 的黑色背景屬另一個尚未解決的 UI polish，不能與 Settings 問題一起修改。
- 不應對正式 main 做修改直到此次 fix branch 完整測試與 UI 驗收。

### 2026-10-08 第二次實測後的根因補強

- 使用者 `HEAD 8d88e050adb13077d2906852a3afbaf9d4903d91` 的真實 `npm start`：設定未顯示，主程序執行了 `completing workspace selection: https://chatgpt.com/` 並把首頁載入 pane 1。
- 新 diagnostics（2026-10-08T00:20:35Z 至 00:21:13Z）確認：
  - `sidebar-route-handled route=overlay-only` 仍進入 `overlay-intent-pending`，1.5 秒後 `dialog-surface-timeout`。
  - 在 overlay pending 期間仍發出 `project-action-candidate → project-intent-created`；隨後可出現 `project-intent-consumed route=unknown-workspace` 與 `pane-load-url` / `route-forwarded`，造成不相關的首頁導航。
  - 診斷中未出現 `settings-page` 模式，說明上一版只辨識 `/profile` 的 full-page route 沒有被觸發。
- 確認的程式缺陷：
  - `classifyRoute` 雖把 `/settings` 辨識為 overlay-only，但 `isSettingsPageUrl` 先前只處理 `/profile`，使正式 Settings 網址仍走會逾時的舊 modal 流程。
  - main process 的 Project/Menu candidate 檢查只看 `overlayOnlyUiActive`、locked dialog 和 fullscreen，未將 `overlayRuntimeState.overlayOnlyModal`（尤其 `overlay-intent-pending`）視為正在開啟的 overlay，允許誤建立 workspace intent。
- 新候選修正只在修復分支：
  - 集中於 `lib/route-policy.cjs` 將 `/settings`（及下層網址）與 `/profile` 一起歸類為 `settings-page`，使之持續顯示，且不送入 pane；`/search` 仍維持 overlay-only。
  - main process 的兩種 native candidate handler 現在在 `overlayRuntimeState.overlayOnlyModal` 或 `settingsPageMode` 時禁止建立任何 workspace intent。
  - 先補新 regression tests，保留既有 Explore / Search / Rename 對照與窗格恢復驗收；不改 1.5 秒計時器，也不放寬 Electron fixture 安全斷言。
- 以隔離 V8 與 mocked Node 模組重跑 route/overlay/static tests：**67/67 PASS**（不是 Windows Electron `npm run verify`）。Windows full verify 與真實 Settings UI 仍未重測，不能宣稱完成。

### 2026-10-08「個人檔案」切換造成 Settings 提前退出（診斷中）

- 使用者確認設定主畫面已可正常顯示；但點擊設定內「個人檔案」後，應用程式提前回到聊天室，未完成完整設定流程驗收。
- 使用者提供的診斷重複顯示 `settings-page-navigation` 後，幾秒鐘出現 `settings-page-return`。證明主程序執行了設定退出，而非單純 z-order 遮蔽；但原始紀錄沒有記錄導致退出的目的地或事件來源，**尚未證實**「個人檔案」究竟觸發首頁導頁、未辨識的設定子路由、被攔截的新視窗、載入錯誤或 renderer failure。
- 已重新比對工作分支原始碼：`handleSidebarNavigation()` 會在 `settingsPageMode` 中對任何非 `/settings`／`/profile` 導頁呼叫 `closeSettingsPage()`；`isSettingsReturnRoute()` 只以 pathname `/` 判定，未要求明確的「返回應用程式」意圖，確實有過度寬鬆的退出條件。
- 因多輪失敗已達重新診斷停損條件，**目前不更動導航或退出行為**。只在 `poc-shaped-sidebar-v4.5.4.js` 的既有退出呼叫點加入隱私安全的診斷：
  - `settings-page-exit-navigation-observed`：以 `routeKind`、`did-navigate`／`did-navigate-in-page`、`home-route`／`unrecognized-settings-destination` 描述非 Settings 導頁；不記錄 URL。
  - `settings-page-close-source`：區分 `native-home-route`、`native-other-route`、`window-open-home-route`、`anchor-home-route`、`settings-load-failed`、`sidebar-renderer-gone`。
- 相關 JavaScript 語法檢查已通過；尚未在 Windows 執行完整 `npm run verify`。下一步由上述診斷辨識實際退出來源後，才設計最小、可驗證的正式修復。

## 最近測試證據

- 2026-10-08 使用者重現前一 candidate failure：畫面初始可見，幾秒後 pane 再次覆蓋；原生記錄出現 /profile 的 ignored window route。
- 2026-10-08 基於 GitHub 當前 fix branch source 的 V8 隔離檢查：相關 `main`、route policy、overlay policy、新增測試與 fixture 程式語法共 9/9 PASS；以 Node API mock 執行 policy 與 static tests 66/66 PASS。此類 mock 不包含 Electron 実際啟動、視窗合成或真實 DOM。
- 2026-10-08 使用者 Windows `npm run verify`：共 155 tests，154 pass、1 fail，唯一失敗為既有 offline Electron fixture 中 `Upgrade to Settings shape race at delay=0ms`；右側 backdrop 點擊穿透至 pane（`overlayShapeHit=false, paneClicks=1`），故完整 verify **未通過**，不可合併 main。
- 重新比對 main / fix：`tests/fixtures/sidebar-overlay-runner.cjs` 出錯的 `runUpgradeSettingsRace` 與其之前的測試執行順序並未變更；`sidebar-shape-preload-v4.5.4.js` 與 main 完全一致。新 `settings-page` 政策不直接參與該舊測試；目前無充分證據判定是新功能回歸或既有偶發競態。
- 基於尚不明確的 root cause，沒有改變測試等待、重試或放寬安全斷言，僅在原測試 failure message 補上 state、原生 modal 是否仍存在及最後 16 個 IPC event 類型（不含 URL 或使用者資料），供下一次失敗定位。該診斷修改已經 V8 JS 語法檢查通過。
- **以上隔離檢查無法取代 `npm run verify`**。本工具執行環境無法 DNS 解析 github.com 以取得完整可執行 repository，也不能替代 Windows Electron 43.1.0 的實測。
- 使用者應在 Windows 依下列步驟跑完整 npm run verify；下一輪特別注意 `settings-page` 是否持續，以及 `Upgrade to Settings shape race` 既有失敗是否重現。

## 啟動與驗證方式

```powershell
cd D:\chatgpt-multi-window
git fetch origin
git switch --detach origin/fix/settings-overlay-visibility-2026-10-08
git rev-parse HEAD
npm run verify
npm start
```

## 下一個驗收條件

1. Windows 上 `npm run verify` 全部通過，包括既有 overlay/route regression 及新增 full-page Settings fixture。
2. 重新開啟 Settings，等待至少 5 秒；確認設定左側導航和右側內容完整顯示且可操作。
3. 切換 Settings 分頁（例如外觀、通知）後依然完整顯示，不再被 pane 覆蓋。
4. 點「返回應用程式」後，原本 3 個 pane 的對話與滾動狀態維持，不應載入 `chatgpt.com/` 覆寫既有對話。
5. 對照最小回歸：Explore、Rename、一般 pane 切換仍正常。
6. 只有驗收通過，才另外徵求合併回 main 授權。
