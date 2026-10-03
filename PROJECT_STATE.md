# PROJECT_STATE

## 目的與範圍

此 Repository 是 Windows 上的 ChatGPT Multi Pane Electron 工具，直接載入官方 `chatgpt.com`，提供共用官方側欄與多個獨立 ChatGPT 窗格。

目前工作項目是 2026-10-03 Scheduled Tasks 執行結果相容性修正：Electron 版可載入排程清單與任務詳細資料，但任務執行結果顯示「無法載入任務結果」，同一任務在一般網頁版可正常顯示。

## 目前權威來源

- Repository：`Raven03115/chatgpt-multi-window-archive`
- 正式分支：`main`
- 工作分支：`fix/chatgpt-nested-dialog-2026-09-28`
- 本次工作基準：`main` HEAD `116918f48655a23858ca4877569764933ec5b7a5`
- 工作分支已先 fast-forward 到上述 `main` 基準，再套用本次修正。
- 尚未合併本次 Scheduled Tasks 修正到 `main`。

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
- 使用者已驗收一般對話／Project Rename、pane 載入與切換正常；上一輪已合併到 `main`。

### 2026-10-03 Scheduled Tasks result diagnosis

- 使用者實際 diagnostics 顯示：
  - `GET automations-collection`：Electron UA 被移除，HTTP 200。
  - `GET automation-detail-item`：Electron UA 被移除，HTTP 200。
  - `POST automations-item`：Electron UA 被移除，HTTP 200。
  - `GET automation-detail-action`：Electron UA 未被移除、request 不匹配，HTTP 404，且可重複重現。
- 根據上述證據，問題定位在 Scheduled Task 執行結果使用的 `GET automation-detail-action` request policy，而非 sidebar routing、pane navigation 或整個 Scheduled Tasks 頁面載入。
- 已新增 regression test，要求 `GET /backend-api/automation/:id/<action>` 類型的 detail-action request 移除 Electron UA。
- 現行修正僅把 `GET automation-detail-action` 加入已觀察到的 supported request pairs；`POST automation-detail-action` 與 plural `automations-item-action` 仍維持不匹配。
- 不擴大到所有 `/backend-api/*`，不修改 URL、method、body、cookie 或其他 headers。

## 重要決策與被取代方案

- 不採用：對所有 ChatGPT request 全域移除 Electron UA。
- 現行：只針對已由 diagnostics 證實需要相容處理的 Automations method + routeKind 組合移除 Electron token。
- 不採用：把 Scheduled Tasks 結果錯誤當成 sidebar route 或 pane navigation 問題處理。
- 現行：依實際 request lifecycle diagnostics 定位到 `automation-detail-action`。

## 已知問題與剩餘風險

- 本次 Scheduled Tasks 修正尚未在使用者 Windows / Electron 43.1.0 環境完成 `npm run verify`。
- 尚未人工驗收「已排程 → 任務 → 執行結果」是否恢復正常。
- Diagnostics 只記錄去識別化 routeKind，沒有記錄 action 子路徑；目前修正因此以已觀察到的 `GET automation-detail-action` 類型為最小可驗證範圍。
- ChatGPT Web API / DOM 仍可能因官方改版再次變動。

## 最近測試證據

- 2026-10-03 使用者 diagnostics：多次 `GET automation-detail-action` 皆為 `electronRemoved=false`、`requestMatched=false`、HTTP 404；相鄰的 supported Automations requests 為 HTTP 200。
- 已先建立 regression test，再修改 production policy。
- 本次候選版完整 `npm run verify`：尚未執行。

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
2. 啟動 Electron 後進入「已排程」，打開先前失敗的任務。
3. 任務執行結果可正常顯示，不再出現「無法載入任務結果」。
4. 排程清單、任務詳細資料、一般 pane 與既有 Rename 功能沒有 regression。
5. 驗收通過後，才合併本次修正至 `main`。
