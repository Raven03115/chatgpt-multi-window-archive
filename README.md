# ChatGPT Multi Pane v4.5.1

Windows 專用的 Electron 多窗格 ChatGPT 工作區。

本程式直接載入官方 ChatGPT 網站，使用既有的 ChatGPT 帳號與訂閱，不使用 OpenAI API，也不會產生額外的 API 用量費用。

## 主要功能

- 使用官方 ChatGPT 網站與官方左側欄
- 支援 1、2、3、4、6 個對話窗格
- 多個窗格共用同一個 ChatGPT 登入狀態
- 點擊窗格即可切換目前使用中的窗格
- 目前窗格會顯示淡灰色外框
- 從左側歷史對話載入內容到目前窗格
- 支援官方搜尋對話
- 支援官方設定視窗
- 支援資料庫、排程、圖像、GPT、網站等官方頁面
- 支援升級方案等全畫面頁面
- 自動保存窗格數量與各窗格最後開啟的 ChatGPT 網址
- 不使用第三方 ChatGPT 平台

## 預設窗格數量

全新安裝、且電腦中沒有舊設定檔時，預設會開啟 **2 個窗格**，不是單一窗格。

程式會把窗格數量保存在：

```text
%APPDATA%\chatgpt-multi-window\multi-pane-layout-config.json
```

因此：

- 第一次下載並使用：預設 2 個窗格
- 使用快捷鍵切換窗格數量後：下次啟動會恢復最後使用的數量
- 已使用過舊版本者：會沿用原本保存在電腦中的設定

## 支援的布局

| 窗格數量 | 預設排列 |
|---:|---|
| 1 | 單一窗格 |
| 2 | 左右兩欄 |
| 3 | 三欄 |
| 4 | 2 × 2 |
| 6 | 3 × 2 |

目前不支援 5 個窗格。

## 快捷鍵

| 快捷鍵 | 功能 |
|---|---|
| `Ctrl + Alt + 1` | 切換為 1 個窗格 |
| `Ctrl + Alt + 2` | 切換為 2 個窗格 |
| `Ctrl + Alt + 3` | 切換為 3 個窗格 |
| `Ctrl + Alt + 4` | 切換為 4 個窗格 |
| `Ctrl + Alt + 6` | 切換為 6 個窗格 |
| `Ctrl + Alt + ←` | 選擇前一個窗格 |
| `Ctrl + Alt + →` | 選擇下一個窗格 |
| `Ctrl + Alt + Q` | 關閉程式 |
| `F8` | 強制展開官方側欄覆蓋區域 |
| `F7` | 恢復自動側欄形狀 |
| `F6` | 強制解除設定／搜尋對話框鎖定 |
| `F5` | 強制關閉全畫面覆蓋模式 |

`F5`～`F8` 主要用於介面異常時的復原，一般使用時不需要操作。

## 系統需求

- Windows 10 或 Windows 11
- Node.js
- npm
- 可正常連線到 `chatgpt.com`

## 下載方式

### 方法一：使用 Git 下載

```powershell
git clone --branch release/v4.5.1-complete --single-branch https://github.com/Raven03115/chatgpt-multi-window-archive.git
cd chatgpt-multi-window-archive
npm install
npm start
```

### 方法二：下載 ZIP

1. 在 GitHub 切換到 `release/v4.5.1-complete` 分支。
2. 點擊 `Code`。
3. 選擇 `Download ZIP`。
4. 解壓縮檔案。
5. 在解壓後的資料夾開啟 PowerShell。
6. 執行：

```powershell
npm install
npm start
```

完成第一次 `npm install` 後，之後也可以直接雙擊：

```text
start-chatgpt-multi.bat
```

## 更新方式

使用 Git 下載者可執行：

```powershell
git pull
npm install
npm start
```

下載 ZIP 者需要重新下載新版 ZIP，再執行 `npm install`。

## 登入與設定資料

登入 Session、快取及布局設定保存在：

```text
%APPDATA%\chatgpt-multi-window
```

這些資料只存在每位使用者自己的電腦，不會包含在 GitHub 下載內容中。

每位下載者都會有各自獨立的：

- ChatGPT 登入狀態
- Cookie 與快取
- 窗格數量
- 各窗格最後網址

下載專案不會取得作者的帳號、Cookie、對話或個人設定。

## 啟動方式

```powershell
npm start
```

或雙擊：

```text
start-chatgpt-multi.bat
```

## 移除方式

1. 關閉程式。
2. 刪除下載的專案資料夾。
3. 如需同時清除登入狀態與布局設定，再刪除：

```text
%APPDATA%\chatgpt-multi-window
```

刪除該資料夾後，下次啟動會視為全新使用者，並恢復預設 2 個窗格。

## 版本與封存

目前完整可用版本：

```text
v4.5.1
```

完整版本分支：

```text
release/v4.5.1-complete
```

浮動獨立視窗的 v5 實驗版本已封存，不是目前建議下載的版本。

## 注意事項

本程式依賴官方 ChatGPT 網頁的 DOM 結構、路由與介面行為。官方網站改版後，以下功能可能需要更新：

- 官方側欄裁切
- 搜尋與設定視窗範圍
- 特殊頁面路由轉送
- 右側窗格內部側欄隱藏

本專案不是 OpenAI 官方產品，也不隸屬於 OpenAI。
