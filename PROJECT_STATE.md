# PROJECT_STATE

## 目的與範圍

此 Repository 是 Windows 上的 ChatGPT Multi Pane Electron 工具，直接載入官方 `chatgpt.com`，提供共用官方側欄與多個獨立 ChatGPT 窗格。

2026-10-03 Scheduled Tasks 執行結果相容性問題已完成修復並合併至 `main`：Electron 版原本可載入排程清單與任務詳細資料，但任務執行結果顯示「無法載入任務結果」，同一任務在一般網頁版可正常顯示。

## 目前權威來源

- Repository：`Raven03115/chatgpt-multi-window-archive`
- 正式分支：`main`
- 本次修正來源分支：`fix/chatgpt-nested-dialog-2026-09-28`
- 本次修正候選 HEAD：`1a58e75c681762434bdf3695e427be65460efe23`
- 正式狀態：Scheduled Tasks 執行結果修正已由使用者人工驗收並合併至 `main`；後續開發以 `main` 最新 HEAD 為準。

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

- 使用者 diagnostics 證實：
  - `GET automations-collection`：Electron UA 被移除，HTTP 200。
  - `GET automation-detail-item`：Electron UA 被移除，HTTP 200。
  - `POST automations-item`：Electron UA 被移除，HTTP 200。
  - `GET automation-detail-action`：Electron UA 原先未被移除、request 不匹配，HTTP 404，且可重複重現。
- Root cause 定位在 Scheduled Task 執行結果使用的 `GET automation-detail-action` request policy，而非 sidebar routing、pane navigation 或整個 Scheduled Tasks 頁面載入。
- 已新增 regression test，要求 `GET /backend-api/automation/:id/<action>` 類型的 detail-action request 移除 Electron UA。
- Production policy 只新增 `GET automation-detail-action`；`POST automation-detail-action` 與 plural `automations-item-action` 仍維持不匹配。
- 不擴大到所有 `/backend-api/*`，不修改 URL、method、body、cookie 或其他 headers。
- 使用者已人工驗收「已排程 → 任務 → 執行結果」恢復正常，不再出現「無法載入任務結果」。

## 重要決策與被取代方案

- 不採用：對所有 ChatGPT request 全域移除 Electron UA。
- 現行：只針對已由 diagnostics 證實需要相容處理的 Automations method + routeKind 組合移除 Electron token。
- 不採用：把 Scheduled Tasks 結果錯誤當成 sidebar route 或 pane navigation 問題處理。
- 現行：依實際 request lifecycle diagnostics 定位到 `automation-detail-action`。

## 已知問題與剩餘風險

- ChatGPT Web API / DOM 仍可能因官方改版再次變動。
- Diagnostics 只記錄去識別化 routeKind，不記 action 子路徑；若未來 action 類型再分化，需重新以 diagnostics + regression test 定位。
- 本次對話未取得完整 `npm run verify` 終端輸出作為可引用證據；若後續需要重新發布或做高風險變更，應重新執行完整 `npm run verify`。

## 最近測試證據

- 2026-10-03 使用者 diagnostics：多次 `GET automation-detail-action` 皆為 `electronRemoved=false`、`requestMatched=false`、HTTP 404；相鄰 supported Automations requests 為 HTTP 200。
- 已先建立 regression test，再修改 production policy。
- 使用者人工驗收：Scheduled Tasks 任務執行結果已恢復正常。

## 啟動與驗證方式

```powershell
cd D:\chatgpt-multi-window
git switch main
git pull --ff-only origin main
npm run verify
npm start
```

## 下一個驗收條件

目前 2026-10-03 Scheduled Tasks 執行結果問題已完成修復並進入 `main`。後續若 ChatGPT Web API 或 UI 再次改版，以 `main` 最新程式碼、可重現步驟、diagnostics 與對應 regression test 為新的驗收基準。
