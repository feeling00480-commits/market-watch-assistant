# 看盤小助手發版區

發版專案 `feeling00480-commits/market-watch-assistant`，使用公開 GitHub Releases 發送更新。這份工具不含帳號金鑰或使用者持股設定。

## 第一次建立

在 GitHub 建立公開倉庫 `market-watch-assistant`，勾選建立 README。將本 README 放在倉庫首頁，版本附件放在 Releases。

有 GitHub CLI 且已登入時，也可執行 `gh repo create feeling00480-commits/market-watch-assistant --public --add-readme --description "看盤小助手 Windows 免安裝版與更新發版區"`。

## 發布新版本

1. 使用全新的正式 ZIP，不要壓縮正在使用的程式資料夾。
2. 執行 `Prepare-Release.ps1 -Package "完整ZIP路徑"`，會驗證內容並建立 `update.json`、`SHA256SUMS.txt`。
3. 建立 GitHub Release，標籤例如 `v0.2.38`，貼上 `release-notes.md`，將三個檔案一起上傳。
4. 發布為正式版並標示為最新版本。草稿與預覽版本不會自動提供給使用者。
5. 已有 GitHub CLI 登入時，可加 `-Publish` 直接完成 Release 建立與附件上傳。工具會讀取同一資料夾的 release-notes.md。

## 使用者端

使用 v0.2.38 以上，設定 → 備份與更新可開關每日檢查、自動下載。預設下載備用，下次啟動 Start-One-Click.cmd 時套用。須先發布比現用版本新的正式 Release，才會出現升級。

更新資訊與程式檔使用 HTTPS 固定倉庫來源及 SHA-256 驗證。這不是 Windows Authenticode 程式碼簽章，GitHub 倉庫與帳號應由作者妥善管理。

個人設定存在各使用者的 `%LOCALAPPDATA%\MarketWatchAssistant\UserData\Settings`，不會上傳 GitHub。AI 分析文字仍留在程式資料夾內的 AI-Analysis。

## 發版前檢查

新版載入舊設定、還原備份、搜尋股票、圖表與 Windows 桌面警報都應先在 Windows 實測。自動更新機制不代表新版功能已通過所有情境驗證。

## 倉庫自動發版工作流程

倉庫已設置 `.github/workflows/publish-release.yml`。每版將 ZIP、update.json、release-notes.md 放在 `publish/v版本號/`，最後更新 `publish/current.json` 的 version。GitHub Actions 會先檢查 ZIP 與逐檔雜湊，再建立草稿、上傳附件，全部確認後發布正式 Release。

也可進入 Actions → Publish verified Windows release → Run workflow，重試同一版。已發布且驗證資訊一致時會直接結束，不覆蓋既有正式版。更新發版只需要倉庫的內建 GITHUB_TOKEN，不需要把個人 Token 寫入倉庫。
