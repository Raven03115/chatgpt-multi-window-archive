# ChatGPT Multi Pane v4.5.3

非官方的 Windows 多窗格 ChatGPT 工作區。

本程式直接載入官方 `chatgpt.com`，使用你自己的 ChatGPT 帳號與既有訂閱，不使用 OpenAI API，也不會產生額外的 API 用量費用。

> 本專案不是 OpenAI 官方產品，也不隸屬於 OpenAI。這只是為了讓 ChatGPT 能以多窗格方式同時使用而製作的小工具。

## 功能

- 使用官方 ChatGPT 網站與官方左側欄
- 支援 `1 / 2 / 3 / 4 / 6` 個對話窗格
- 多個窗格共用同一個 ChatGPT 登入狀態
- 點擊窗格即可切換目前使用中的窗格
- 目前窗格會顯示淡灰色外框
- 從左側歷史對話將內容載入目前窗格
- 支援官方搜尋對話與設定視窗
- 支援資料庫、排程、圖像、GPT、網站等官方頁面
- 支援升級方案等全畫面頁面
- 自動保存窗格數量與各窗格最後開啟的 ChatGPT 網址
- 提供不顯示終端視窗的日常啟動檔
- 不使用第三方 ChatGPT 平台

## v4.5.3 更新

- 降低右側窗格對 ChatGPT DOM 的無效重複掃描
- 降低官方左側欄覆蓋視窗的形狀重算頻率
- 避免覆蓋視窗形狀與位置未變時重複呼叫更新
- 活動窗格切換時只更新前後兩個窗格的外框
- 4／6 窗格改為分批載入，降低同時初始化造成的瞬間卡頓
- 保留背景回答生成、完整多窗格功能與硬體加速
- 延續 v4.5.2 的灰色畫面、右側內部側邊欄與路由修復

## 預設窗格數量

全新使用者第一次啟動時，預設為 **1 個窗格**。

使用快捷鍵切換窗格數量後，程式會保存最後使用的布局，下次啟動時自動恢復。

已經使用過舊版本的人，會沿用自己電腦中原本保存的窗格數量，不會被強制改回 1 個。

設定檔位置：

```text
%APPDATA%\chatgpt-multi-window\multi-pane-layout-config.json
```

## 支援的布局

| 窗格數量 | 排列 |
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

`F5`～`F8` 是介面異常時的復原快捷鍵，一般使用時不需要操作。

## 系統需求

- Windows 10 或 Windows 11
- Node.js
- npm
- 可正常連線到 `chatgpt.com`
- 自己的 ChatGPT 帳號

## 下載與安裝

### 方法一：使用 Git

```powershell
git clone https://github.com/Raven03115/chatgpt-multi-window-archive.git
cd chatgpt-multi-window-archive
npm install
npm start
```

完成第一次安裝後，日常使用可直接雙擊：

```text
start-chatgpt-multi-hidden.vbs
```

此啟動方式不會顯示 CMD 或 PowerShell 視窗。

### 方法二：下載 ZIP

1. 點擊 GitHub 頁面上的 `Code`
2. 選擇 `Download ZIP`
3. 解壓縮檔案
4. 確認電腦已安裝 Node.js
5. 第一次使用時，雙擊：

```text
start-chatgpt-multi.bat
```

啟動檔會在第一次使用時自動執行 `npm install`。安裝完成後，日常使用建議改為雙擊：

```text
start-chatgpt-multi-hidden.vbs
```

此啟動方式會直接啟動 Electron，不會保留終端視窗。

也可以在專案資料夾開啟 PowerShell，手動執行：

```powershell
npm install
npm start
```

## 啟動方式說明

| 啟動檔 | 用途 |
|---|---|
| `start-chatgpt-multi-hidden.vbs` | 日常啟動，不顯示終端視窗 |
| `start-chatgpt-multi.bat` | 第一次安裝、更新依賴或查看錯誤訊息 |
| `npm start` | 開發、測試或從 PowerShell 手動啟動 |

若 `start-chatgpt-multi-hidden.vbs` 顯示找不到 Electron，請先執行一次：

```powershell
npm install
```

## 更新

使用 Git 下載者：

```powershell
git pull
npm install
npm start
```

更新完成後，仍可使用 `start-chatgpt-multi-hidden.vbs` 日常啟動。

使用 ZIP 下載者需要重新下載新版 ZIP。

## 登入、隱私與本機資料

登入 Session、Cookie、快取與布局設定保存在每位使用者自己的電腦：

```text
%APPDATA%\chatgpt-multi-window
```

每位下載者都有各自獨立的：

- ChatGPT 登入狀態
- Cookie 與快取
- 窗格數量
- 各窗格最後網址

下載這個專案不會取得作者的帳號、Cookie、對話或個人設定。本程式本身也不會把你的登入資料上傳到此 GitHub Repository。

## 移除

1. 關閉程式
2. 刪除下載的專案資料夾
3. 如需同時清除登入狀態與布局設定，再刪除：

```text
%APPDATA%\chatgpt-multi-window
```

刪除該資料夾後，下次啟動會視為全新使用者，並預設開啟 1 個窗格。

## 效能說明

多窗格模式會為每個窗格載入一個完整的 ChatGPT 頁面，因此記憶體使用量會隨窗格數量增加。

一般建議：

- 1～2 個窗格：主要使用模式
- 4 個窗格：適合需要同時比較多個對話時使用
- 6 個窗格：屬於高記憶體負載模式，建議在記憶體充足的電腦使用

v4.5.3 的優化重點是降低無效 DOM 掃描、覆蓋視窗重算與多窗格同時初始化的負載，不會凍結非目前窗格，也不會中斷背景回答生成。

## 已知限制

本程式依賴官方 ChatGPT 網頁的 DOM 結構、路由與介面行為。官方網站改版後，以下功能可能需要更新：

- 官方側欄裁切
- 搜尋與設定視窗範圍
- 特殊頁面路由轉送
- 右側窗格內部側邊欄隱藏

目前主要針對 Windows 與桌面版 ChatGPT 網頁測試，尚未提供 EXE 安裝程式。

## 版本

目前公開穩定版：`v4.5.3`
