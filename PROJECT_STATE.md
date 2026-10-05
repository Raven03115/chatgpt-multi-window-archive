# PROJECT_STATE

## 目的與範圍

此 Repository 是 Windows 上的 ChatGPT Multi Pane Electron 工具，直接載入官方 `chatgpt.com`，提供共用官方側欄與多個獨立 ChatGPT 窗格。

目前工作項目是 2026-10-05 側欄「探索」選單路由相容性修正：探索 popup 可正常開啟，但點選其中的地圖、圖像、GPT、網站等項目後沒有任何反應；一般 ChatGPT 網頁端可正常使用。

## 目前權威來源

- Repository：`Raven03115/chatgpt-multi-window-archive`
- 正式分支：`main`
- 正式基準 HEAD：`32f33976a98b2fa195f8a7e23a71b313617d518e`
- 工作分支：`fix/chatgpt-nested-dialog-2026-09-28`
- 工作分支已先 fast-forward 到上述 `main` 基準，再套用本次 Explore 修正。
- 本次修正尚未合併回 `main`。

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

### 2026-10-05 Explore menu routing diagnosis and candidate fix

- 使用者 diagnostics 可重複看到：
  - 探索 menu trigger 正常：`menu-trigger-detected`、`popup-detected`。
  - 點選探索 menu item 後發生 `native-route-ignored`。
  - routeKind 為 `unknown-workspace`。
  - reason 為 `native-route-without-intent`。
- 同一份 diagnostics 中，其他非 anchor 控制項建立 one-time intent 後，`unknown-workspace` route 可正常被 consume、`pane-load-url` 並 `route-forwarded`。
- Root cause：preload 原先把 `role=menuitem` 一律視為 native menu action，不建立短效 workspace navigation intent；主程序因此拒絕後續 native SPA workspace route。
- 已先建立 regression tests，再修改 production policy。
- 現行候選修正：
  - `menuitem` 可成為 pointerdown action candidate。
  - overlay control policy 將 `menu-action` 設為可建立短效 project/workspace intent，但不直接 route。
  - preload 保留 ChatGPT 原生 menu click，同時對 native menu action送出 candidate；真正是否 forward 仍由後續有效 ChatGPT workspace route、active pane、intent generation 與 1 秒 lifetime 驗證。
  - Settings、Search、dialog、anchor、backdrop、close、external control 仍不得建立 intent。
  - menu trigger 本身仍只負責開 popup，不建立 route intent。

## 重要決策與被取代方案

- 不採用：直接攔截探索項目 click 並自行硬編碼目的 URL。
- 現行：保留 ChatGPT 原生 click / SPA routing，只補齊短效 intent，讓既有 route-policy 決定是否轉送到 active pane。
- 不採用：放寬所有 native navigation，使無 intent 的 sidebar route 都能進 pane。
- 現行：仍要求有效 one-time intent，避免背景或非使用者操作的 native navigation 被誤轉送。
- 不採用：為此次 Explore 問題修改 Scheduled Tasks、Rename detector 或 pane loadURL 邏輯。

## 已知問題與剩餘風險

- 本次 Explore 候選版尚未在使用者 Windows / Electron 43.1.0 環境完成完整 `npm run verify`。
- 尚未人工驗收「探索 → 地圖／圖像／GPT／網站」是否可正常載入 active pane。
- native menu action 現在可建立最長 1 秒的 one-time intent；雖然只有後續有效 workspace route 才能 consume，仍需 UI 驗收確認一般 conversation / Project row context menu 沒有 regression。
- Rename dialog 功能已正常，但開啟 modal 時背景 pane 被暫時收成 0×0、呈現大片黑色；這是已知 UI polish 項目，尚未處理，不能與 Explore 修復混在同一修改中。
- ChatGPT Web API / DOM 仍可能因官方改版再次變動。

## 最近測試證據

- 2026-10-05 使用者 diagnostics：Explore 選單點擊後可重複重現 `unknown-workspace + native-route-without-intent`；其他有 one-time intent 的同類 route 可正常 forward。
- 已先提交 route-policy / overlay-policy regression tests，再修改 production 程式。
- 本環境無法連線 GitHub clone repository，無法代替使用者 Windows 環境執行完整 `npm run verify`；完整驗證仍待執行。

## 啟動與驗證方式

```powershell
cd D:\chatgpt-multi-window
git fetch origin
git switch --detach origin/fix/chatgpt-nested-dialog-2026-09-28
npm run verify
npm start
```

## 下一個驗收條件

1. `npm run verify` 全部通過。
2. 啟動 Electron 後打開側欄「探索」。
3. 至少點選一個先前失敗的探索項目，內容正確載入目前 active pane。
4. 再最小確認一個 conversation / Project row 的「…」選單仍正常，不發生非預期 pane 導航。
5. 既有 Rename、Scheduled Tasks、一般 pane routing 無 regression。
6. 驗收通過後，才合併本次修正至 `main`。
