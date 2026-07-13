# 測試與診斷基線

本專案使用 Node.js 內建測試工具與持久化 JSONL 診斷日誌，讓路由及整合問題能先以可重複的方式驗證。本基線不會自動操作真實 ChatGPT，也不代表具備完整 GUI 自動測試。

## 常用指令

- `npm run verify`：先執行原有 Repository 檢查，再執行全部自動測試。任何語法、Repository 檢查、路由回歸或診斷隱私測試失敗時會以非零狀態結束。
- `npm test`：使用 `node:test` 執行 `tests/*.test.cjs`。
- `npm run diagnostics`：顯示最近 100 筆整合事件。
- `npm run diagnostics -- --last 250`：調整顯示筆數，最大 5000 筆。
- `npm run diagnostics -- --errors-only`：只顯示失敗或錯誤事件。

目前完整測試合計 68 個。測試包含離線 Electron fixture，會驗證 production sidebar preload 與 overlay policy，但不連線 `chatgpt.com`，也不使用使用者的登入 Session、Cookie、對話或 Project 資料。`npm run verify` 會執行完整 Repository 檢查與全部 68 個自動測試。

## 日誌位置與輪替

預設日誌位於 Electron `app.getPath("userData")/logs/integration-events.jsonl`。在一般 Windows 安裝中，userData 通常位於 `%APPDATA%/chatgpt-multi-window`。目前檔案超過 2 MB 時會輪替為：

- `integration-events.jsonl`
- `integration-events.1.jsonl`

只有目前檔案與一份輪替檔會保留。日誌目錄無法建立或寫入時，logger 會安全失敗，不會中止主程式。

## 隱私規則

診斷事件只允許記錄時間、事件名稱、pane、路由種類、來源、動作、原因、階段、耗時與已清理的錯誤摘要。不得記錄完整 URL、conversation ID、Project ID、Project 名稱、對話內容、使用者輸入、email、token、cookie 或 authorization header。

共用 sanitizer 會遮罩 conversation／Project 路徑識別碼、email、Bearer token、UUID、長雜湊，以及 URL query 與 hash。新增事件時仍應優先只傳分類結果，不應把敏感資料交給 logger 後才依賴遮罩。

## 新增路由回歸測試

1. 先在 `tests/route-policy.test.cjs` 建立能重現問題且會失敗的案例。
2. 測試輸入只使用路由種類與明確狀態，不依賴 ChatGPT DOM class、Project 顯示名稱或 Electron 全域狀態。
3. 在 `lib/route-policy.cjs` 修改集中式純函式規則。
4. 確認案例名稱清楚描述情境與預期 action。
5. 執行 `npm run verify`，並檢查既有案例沒有退步。

## AI 標準修 bug 流程

1. 確認分支、HEAD 與工作目錄符合任務前置條件。
2. 執行 `npm run diagnostics`，先以安全的結構化事件取得實際證據。
3. 建立可失敗的回歸測試，並找出最小修改範圍。
4. 實作修正後執行 `npm run verify` 與 `git diff --check`。
5. 對完整 diff 進行 code review，修正有效 findings 後重新驗證。
6. 最後只提出無法自動化的最小 UI 驗收案例。

## 仍需人工驗收

Electron UI、Windows 全域快捷鍵、焦點切換、WebContentsView 合成與真實 ChatGPT 網頁互動仍需人工驗收。自動測試可驗證純路由政策、隱私清理、日誌輪替與 Repository 語法，但不能證明真實網站的 DOM、Router 或視覺行為完全正確。
