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

## 最近測試證據

- 2026-10-08 使用者重現前一 candidate failure：畫面初始可見，幾秒後 pane 再次覆蓋；原生記錄出現 /profile 的 ignored window route。
- 2026-10-08 基於 GitHub 當前 fix branch source 的 V8 隔離檢查：相關 `main`、route policy、overlay policy、新增測試與 fixture 程式語法通過；以 Node API mock 執行 policy 與 static tests 65/65 PASS（後續新增一項 return-window contract 測試仍需重新跑）。
- **以上並非 `npm run verify`**。本工具執行環境無法 DNS 解析 github.com 以取得完整可執行 repository，也不能替代 Windows Electron 43.1.0 的實測。
- 使用者應在 Windows 依下列步驟跑完整 npm run verify；新 fixture 若失敗需先分析 root cause。

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
