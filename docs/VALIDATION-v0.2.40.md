# v0.2.40 驗證紀錄

日期：2026-11-16。基於完整打包的 app.html 與實際 PowerShell 原始碼。

| 範圍 | 結果 |
| --- | --- |
| 完整 DOM、12 個商品／市場案例、期貨夜盤、新聞、AI 送出／儲存／取消、顏色、XSS、原圖表與警報 | 61 項通過 |
| 歷史類比引擎與盤中參數、缺值、無未來資訊 | 32 項通過 |
| 設定備份與還原 | 22 項通過 |
| 股票搜尋、市場分類、舊報價競態 | 27 項通過 |
| PowerShell 實際設定檔 I/O | 13 項通過 |
| 更新套用、執行鎖、失敗回復、雜湊與不安全 ZIP | 16 項通過 |
| 固定主來源的長期日線路由與舊路由 | 3 項通過 |

另驗證六檔 ZIP、CSP 腳本雜湊、啟動器雜湊、逐檔 manifest、PowerShell UTF-8 BOM。market-alerts.js、technical.js、profile.js、settings-ui.js 與 v0.2.39 完全相同。Start-Server.ps1、Update-Manager.ps1 只更新版號。期貨研究 view 新增模組，但不更動原警報引擎。

特殊案例：現價 160／成本 206.5 不觸發目標；台股、興櫃、美股與期貨夜盤時段可判讀；期貨報價改變會更新同契約條件，現貨休市時不推動現貨類比比例。TE／TF／XIF 不使用加權指數機率。各現貨市場資料不足仍顯示三張卡且比例為缺值。

AI 測試使用模擬新聞與服務回覆，未使用使用者 API 金鑰或呼叫真實付費服務。驗證新聞在送出前載入、並行請求合併、標題與摘要時間、使用者成本資料需勾選、關閉準備中視窗不送出、新聞失敗保留舊資料與錯誤標示、回覆儲存並顯示色彩粗體。這些結果不保證外部模型一定遵守格式或其推估準確。

統計限制：資料只有價格衍生歷史類比，不是已校準勝率；期貨比例是標的參考。三段條件解讀與 AI 推估各自標示範圍，不轉成未經驗證的機率。新聞只有來源提供的標題／摘要，不代表讀過全文。

環境為 Node 24、JSDOM 26.1.0、Linux PowerShell 7.7.0。尚未完成 Windows PowerShell 5.1、桌面小窗及完整瀏覽器視覺實機驗收。首次啟動請測試桌面警報。既有 GitHub 正式版與 publish/current.json 保持 v0.2.38，不將此預覽自動推送。

重現：安裝 JSDOM 至 /tmp/cas-dom，執行 tests/settings-v0240.cjs、search-v0240.cjs、outlook-v0240.cjs、markets-ai-v0240.cjs。PowerShell 7 執行 tests/settings-server-v0240.ps1、updater-v0240.ps1、outlook-server-v0240.ps1。統計測試最後一個實際來源檢查在缺少外部暫存檔時略過。打包：python3 tests/build-v0240.py。
