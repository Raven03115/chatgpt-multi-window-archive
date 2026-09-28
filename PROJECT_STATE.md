# PROJECT_STATE

## 目的與範圍

此 Repository 是 Windows 上的 ChatGPT Multi Pane Electron 工具，直接載入官方 `chatgpt.com`，提供共用官方側欄與多個獨立 ChatGPT 窗格。

2026-09-28 相容性修正已完成正式收尾，範圍包含：

- 新版「重新命名」compact dialog 可見性／shape 判定。
- 移除為診斷暫時加入的 pane network failure instrumentation。
- 處理 Electron 在頁面載入期間大量 `executeJavaScript()` 呼叫造成的 `MaxListenersExceededWarning`。

## 目前權威來源

- Repository：`Raven03115/chatgpt-multi-window-archive`
- 正式分支：`main`
- 本輪修正來源分支：`fix/chatgpt-nested-dialog-2026-09-28`
- 修正候選 HEAD：`c5e92cb1e6708f90a853ae4b8971cf446d589847`
- 正式狀態：已完成驗證並合併至 `main`；後續開發以 `main` 最新 HEAD 為準。

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
- 使用者已人工確認一般對話與 Project 的 Rename UI 正常。

### Temporary pane network diagnostics cleanup

- 使用者先前遇到部分 pane 顯示「無法載入此 ChatGPT 對話」，後續自行恢復且重試可正常使用。
- 因未取得可重現的 HTTP/network failure 證據，不把此事件視為已由程式修復。
- 為調查該事件暫時加入的 pane network diagnostics 已移除；Automations request diagnostics 已恢復既有行為。

### Electron listener accumulation

- Electron 的 `webContents.executeJavaScript()` 在 WebContents 尚未停止載入時會等待 `did-stop-loading`；大量同時呼叫會對同一 WebContents 累積 listeners。
- 現行修正加入 shared load gate：同一個 WebContents 在載入期間的多個 `executeJavaScript()` 呼叫共用一組 `did-stop-loading` / `destroyed` listener，停止載入後再執行原始呼叫。
- 未提高 EventEmitter max listener 上限，也未以 suppress warning 取代 root-cause 修正。

## 重要決策與被取代方案

- 失效：用極低 alpha 背景修改 ChatGPT dialog DOM，讓舊 detector 誤認為 opaque。
- 現行：直接修正 dialog classification policy，不修改官方 ChatGPT dialog DOM。
- 失效：因短暫 pane 載入異常長期保留廣泛 network diagnostics。
- 現行：pane 載入異常目前不做 speculative fix；若再次穩定重現，再用最小、去識別化診斷定位。
- 不採用：單純提高 `EventEmitter` max listeners 以隱藏 warning。
- 現行：在 Electron `executeJavaScript()` 進入其內部等待前先共用 load gate。

## 已知問題與剩餘風險

- 先前 pane「無法載入此 ChatGPT 對話」事件目前不可重現，因此沒有宣稱由程式修復。
- ChatGPT Web DOM / route 仍可能因官方改版再次變動。
- 其他未重現問題應先依 `npm run diagnostics` 與最小 regression test 定位，不沿用本輪已失效的 speculative workaround。

## 最近測試證據

- 使用者回報最終候選版 `npm run verify` 全部通過。
- 使用者實際啟動 Electron 後未再看到 `MaxListenersExceededWarning: ... did-stop-loading listeners ...`。
- 使用者人工驗收：一般對話與 Project 的「重新命名」正常；一般 pane 開啟、切換與載入正常。
- `webcontents-execute-javascript-load-gate` isolated unit tests：4/4 pass。

## 啟動與驗證方式

```powershell
cd D:\chatgpt-multi-window
git switch main
git pull --ff-only origin main
npm run verify
npm start
```

## 下一個驗收條件

目前本輪修正已完成。後續若 ChatGPT Web UI 再次改版，以 `main` 最新程式碼、可重現步驟、diagnostics 與對應 regression test 為新的驗收基準。
