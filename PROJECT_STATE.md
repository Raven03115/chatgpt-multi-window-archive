# PROJECT_STATE

## 目的與範圍

此 Repository 是 Windows 上的 ChatGPT Multi Pane Electron 工具，直接載入官方 `chatgpt.com`，提供共用官方側欄與多個獨立 ChatGPT 窗格。

目前工作項目是 2026-09-28 的 ChatGPT Web UI 相容性修正與最終整理，包含：

- 新版「重新命名」compact dialog 可見性／shape 判定。
- 移除為診斷暫時加入的 pane network failure instrumentation。
- 處理 Electron 在頁面載入期間大量 `executeJavaScript()` 呼叫造成的 `MaxListenersExceededWarning`。

## 目前權威來源

- Repository：`Raven03115/chatgpt-multi-window-archive`
- 工作分支：`fix/chatgpt-nested-dialog-2026-09-28`
- 正式 `main` 基準（本輪開始時）：`011a4ce5f880b458a2c241b791532b280f45a9f6`
- 本文件建立時的候選 HEAD：以分支最新 HEAD 為準；尚未合併至 `main`。

## 技術棧與重要版本

- Electron `43.1.0`
- package version `4.6.2`
- Node.js test runner：`node --test`
- 啟動：`npm start`
- 統一驗證：`npm run verify`

## 已完成

### Rename compatibility

- 已確認新版 ChatGPT Rename surface 是明確的 compact dialog root，但 root 本身可為 transparent。
- dialog detector 已改為：明確 root semantic + compact geometry + interactive content 即可判定為 `compact-confirmation`，不再要求 root 必須 opaque。
- 已移除曾用來修改 ChatGPT DOM alpha 的 compatibility workaround。
- 已保留 synthetic Electron regression fixture，覆蓋 420×188 transparent `role=dialog` Rename surface。
- 使用者已人工確認 Rename UI 可以正常開啟。

### Temporary pane network diagnostics cleanup

- 使用者先前遇到部分 pane 顯示「無法載入此 ChatGPT 對話」，後續自行恢復且重試可正常使用。
- 因未取得可重現的 HTTP/network failure 證據，不把此事件視為已由程式修復。
- 為調查該事件暫時加入的 pane network diagnostics 已從候選版本移除；Automations request diagnostics 已恢復到既有行為。

### Electron listener accumulation

- Electron 的 `webContents.executeJavaScript()` 在 WebContents 尚未停止載入時，會等待 `did-stop-loading`；大量同時呼叫會各自等待同一事件，可能觸發 `MaxListenersExceededWarning`。
- 候選修正新增 shared load gate：同一個 WebContents 在載入期間的多個 `executeJavaScript()` 呼叫共用一組 `did-stop-loading` / `destroyed` listener，停止載入後再執行原始呼叫。
- 未提高 EventEmitter max listener 上限，也未以 suppress warning 取代 root-cause 修正。

## 重要決策與被取代方案

- 失效：用極低 alpha 背景修改 ChatGPT dialog DOM，讓舊 detector 誤認為 opaque。
- 現行：直接修正 dialog classification policy，不修改官方 ChatGPT dialog DOM。
- 失效：因短暫 pane 載入異常長期保留廣泛 network diagnostics。
- 現行：pane 載入異常目前不做 speculative fix；若再次穩定重現，再用最小、去識別化診斷定位。
- 不採用：單純提高 `EventEmitter` max listeners 以隱藏 warning。
- 現行：在 Electron `executeJavaScript()` 進入其內部等待前先共用 load gate。

## 已知問題與剩餘風險

- 目前候選 HEAD 尚需在使用者 Windows / Electron 43.1.0 環境執行完整 `npm run verify`。
- `MaxListenersExceededWarning` 的 load-gate 修正已有 isolated unit test，但仍需實際 Electron 啟動驗收，確認 warning 不再出現且 pane UI injection 行為未受影響。
- 先前 pane 「無法載入此 ChatGPT 對話」事件目前不可重現，因此沒有宣稱已修復。
- ChatGPT Web DOM / route 仍可能因官方改版再次變動。

## 最近測試證據

- 使用者人工驗收：Rename dialog 可以正常開啟。
- 前一個暫時 network-diagnostics 版本完整測試為 142 tests / 140 pass / 2 fail；兩個 failure 都屬於該暫時 diagnostics 對既有 automations privacy contract 的 regression。該 instrumentation 現已移除，不把 140/142 視為目前候選版結果。
- 新增 `webcontents-execute-javascript-load-gate` isolated test：4/4 pass（非完整 Repository verify）。
- 目前候選版完整 `npm run verify`：尚未由 Windows 環境執行。

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
2. 啟動後不再出現 `MaxListenersExceededWarning: ... did-stop-loading listeners ...`。
3. 普通對話與 Project 的「重新命名」dialog 可正常開啟、輸入、取消。
4. 一般 pane 導航／切換維持正常。
5. 上述條件成立後，才考慮把 fix branch 整理進 `main`；不得在此之前宣稱正式完成。
