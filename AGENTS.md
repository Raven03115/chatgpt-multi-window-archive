# Repository Development Safety Baseline

本 Repository 的所有開發工作必須遵守以下規則：

1. 每次只處理一個已經確認的任務。
2. 修改前必須實際檢查目前分支、HEAD 與工作目錄狀態。
3. 分支、HEAD 或工作目錄不符合任務前置條件時，立即停止，不得修改檔案。
4. 禁止自行執行 `git stash`、`git stash pop`、`git reset --hard`、`git clean` 或 force push。
5. 發現 Git merge conflict、衝突標記或未預期的檔案修改時，立即停止。
6. 未經使用者明確同意，不得執行 commit、push、tag 或 release。
7. 不得自行修改版本號、`README`、`CHANGELOG` 或發布資料。
8. 不得修改已驗證的 ChatGPT 側欄路由行為，除非任務明確要求。
9. 修改前必須先檢查相關函式、呼叫關係、資料流與既有行為。
10. 修改後必須執行統一驗證：`npm run verify`。
11. 不得用推測或預期結果取代實際指令輸出。
12. Electron UI、Windows 全域快捷鍵、焦點切換及 ChatGPT 網頁互動仍需人工驗收。
13. 驗證失敗時不得繼續擴大修改。
14. 不得為了讓驗證通過而刪除、略過或弱化既有檢查。
