# 看盤小助手

Windows 免安裝看盤工具，提供台股、美股、期貨與興櫃觀察、條件警報及選配 AI 分析。

[下載最新正式版](https://github.com/feeling00480-commits/market-watch-assistant/releases/latest) · [所有版本與更新紀錄](https://github.com/feeling00480-commits/market-watch-assistant/releases) · [發版操作](docs/RELEASING.md)

## 使用方式

1. 下載 Release 附件中的 `Market_Watch_Assistant_Windows_v版本號.zip`，完整解壓。
2. 執行 `Start-One-Click.cmd`，保留啟動視窗與看盤頁面。
3. 設定追蹤商品、成本、進場價、停損與目標價。按「開始監控」才會定時檢查警報。

需要 Windows PowerShell 5.1 與新版 Edge／Chrome，電腦政策須允許本機服務及對應網路連線。

## 設定備份

v0.2.38 起，在「設定 → 備份與更新」可立即備份、匯出、匯入與還原最近備份。預設設定變更後自動儲存，並每 5 分鐘補查，保留最近 30 份。

共用位置為 `%LOCALAPPDATA%\MarketWatchAssistant\UserData\Settings`，新版先讀取這裡的資料，再載入行情。第一次移轉請使用原本的瀏覽器設定檔與本機網址，讓本版取得舊瀏覽器設定並建立第一份備份。跨電腦使用請匯出、匯入設定 JSON。

備份包含自選股、成本、張數、進場／目標／停損價、警報規則、釘選、排序與介面偏好，不包含 AI 或 Telegram 金鑰。個人設定不會上傳此倉庫。AI 分析紀錄仍在程式資料夾內的 `AI-Analysis`。

## 自動更新

每天檢查本倉庫的最新公開正式版。預設下載備用，驗證來源與 SHA-256 後，下次啟動套用，不會強制中斷監控。可關閉自動檢查、改為手動下載。

前一版程式保存在 `Previous-Version`。新版未回報完成啟動時，下次啟動嘗試驗證並退回前一版。更新不替換共用設定資料夾。

## 版本發布

每個正式 Release 同時附上程式 ZIP、`update.json` 與 `SHA256SUMS.txt`。請下載作者上傳的 Windows ZIP，GitHub 自動產生的 Source code 壓縮檔不是可直接啟動的程式包。

程式目前未做 Windows Authenticode 簽章。行情來源可能延遲、限流或缺漏，介面會標示資料時間與來源。條件提示用於研究與風險檢視，不保證交易結果。
