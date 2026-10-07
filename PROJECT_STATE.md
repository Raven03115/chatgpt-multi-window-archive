# PROJECT_STATE

## 目的與範圍

此 Repository 是 Windows 上的 ChatGPT Multi Pane Electron 工具，直接載入官方 `chatgpt.com`，提供共用官方側欄與多個獨立 ChatGPT 窗格。

目前工作項目是 2026-10-08 側欄「設定」面板顯示修復。使用者開啟 Settings 時只看到設定左側選單，右側內容被多個 pane 覆蓋；前一項 Explore 修復已合併至 main 並完成使用者驗收。

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

### 2026-10-08 Settings overlay visibility candidate（待 UI 驗收）

- 使用者 diagnostics 三次重現：點擊 Settings 進入 `overlay-intent-pending`，1.5 秒後 `dialog-surface-timeout`、`no-valid-dialog-surface`，程式回到 `sidebar-only`；右側 pane 繼續覆蓋設定內容。
- 原先 generic dialog detector 會排除接近全畫面的 root / backdrop，main process 亦拒絕 oversized `dialogRect`；但官方 Settings 可能有可見的 semantic `role=dialog` 根節點而沒有符合舊尺寸限制的內部矩形。此 DOM 形狀尚未在使用者真實頁面驗證。
- 先建立 oversized Settings 的 offline Electron fixture 測試：native dialog root 占滿 viewport、沒有可用內部 `dialogRect`、內容位於 `main`，要求設定保持可見超過 1.5 秒且關閉後還原 overlay/sidebar。
- 候選實作只在**使用者明確開啟 Settings** 後辨識可見的 native modal semantic root，並將 `settingsSurfacePresent` 布林值傳給主程序；不放寬 generic Rename/dialog 的 size heuristic。
- Settings intent 的 pending 階段立即 suppress panes；存在 Settings semantic surface 時，在沒有合格矩形的情況下仍可切換至 `shaped-dialog`，取消 1.5 秒 pending timeout。
- 只有 Settings 模式會暫時解除側欄 overlay 上 `main` / `[role=main]` 的 CSS 隱藏，避免官方設定內容放在其中時不可見。
- 關閉官方 Settings semantic root 後，短暫等待約 180ms 以避開分頁 DOM replacement，再恢復 pane bounds 與 sidebar-only；正式 Settings 關閉按鈕與 Escape 仍保留既有 native close flow。
- 使用者尚未在真實 ChatGPT Settings DOM 完成 UI 驗收；不應將候選版稱為已修復完成。

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
- **Settings 候選版尚未實測使用者真實 UI**；如 ChatGPT 新版 Settings 沒有可見 semantic dialog root，須先補無敏感內容的 DOM/diagnostics 證據再修，不能盲目增加 fallback。
- Rename dialog 功能已正常，但開啟 modal 時背景 pane 被暫時收成 0×0、呈現大片黑色；這是獨立的 UI polish，尚未處理。
- Settings 模式暫時顯示官方 overlay 的 `main`，因此需人工確認沒有多餘底層 workspace、錯誤遮罩或點擊穿透。
- ChatGPT Web API / DOM 仍可能因官方改版再次變動。

## 最近測試證據

- 2026-10-05 使用者 diagnostics：Explore 選單點擊後可重複重現 `unknown-workspace + native-route-without-intent`；其他有 one-time intent 的同類 route 可正常 forward。
- 第一版 Explore 修正：使用者完整 verify 回報 offline Electron fixture failure `ordinary menuitem emitted an intent`，已據此撤銷「menuitem = Project intent」設計。
- 修訂版第二次 verify：offline Electron fixture 已通過，ordinary menu regression 已消失；148 個測試中 146 pass、2 fail。
- 剩餘 2 個 failure 都位於 `tests/route-policy.test.cjs` 的 static source slicing：測試用 LF-only 字串尋找 branch 邊界，但 Windows 讀取 source 時保留 CRLF，`indexOf(...\n...)` 找不到邊界而使 slice 延伸到後續 Project branch。Production code 與 Electron fixture 並未因此失敗。
- 已把這兩個 static assertions 改為 line-ending-agnostic regex，仍要求 native menu branch 內必須呼叫 `reportMenuRouteCandidate` 且不得呼叫 `reportProjectActionCandidate`；沒有刪除或弱化檢查。
- 使用者已完成 Explore UI 驗收並回報可正常使用；Explore 的最終完整 `npm run verify` 終端摘要未在對話中提供。
- 2026-10-08 新 Settings 候選版：在工具隔離環境以 V8 JS parser 驗證 production main/preload、overlay-policy、Electron fixture runner 與新 test file **語法皆 PASS**；離線執行 4 個與 Settings 顯示/關閉相關的 source/policy contract tests **4/4 PASS**（mocked Node `fs/path/test` 模組）。此證據不是 Electron fixture 或完整 npm verify 通過。
- 無法在此環境執行完整 `npm run verify`：GitHub 網域無法解析，缺完整 repo 與 Electron Windows UI；修正後 Electron fixture 與使用者 UI 仍待正式驗證。

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

1. 在 Windows 上執行 `npm run verify` 並提供總摘要；特別確認新的 oversized Settings Electron fixture pass，及既有 Rename、Search、Upgrade、Explore fixture 不回歸。
2. 啟動候選分支，打開 Settings，確認左側導航與右側內容均能完整顯示，且切換 Settings 分頁不會被 pane 覆蓋或自動退出。
3. 關閉 Settings，確認原有 pane 數量、內容與交互立即恢復。
4. 如 Settings 實測失敗，先收集現場 diagnostics、無敏感 DOM 概況並重新定位問題，不進行不明原因的 patch 累加。
5. 本候選修復通過驗收後另行取得合併至 `main` 授權。
