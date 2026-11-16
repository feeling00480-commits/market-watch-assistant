[CmdletBinding()]
param([switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
$listener = $null
$client = $null
$tickClient = $null
$pending = New-Object System.Collections.ArrayList
$telegram = $null
$running = $true
$desktopAvailable = $false
$noticeWindow = $null
$noticeText = $null
$noticeHeadline = $null
$noticeUntil = [DateTime]::MinValue
$noticeQueue = [System.Collections.Generic.Queue[object]]::new()
$defaultNoticeColors = @{background='#202124'; foreground='#E4E6E9'; accent='#A8B8CE'; border='#3A3D43'}
$utf8 = New-Object System.Text.UTF8Encoding($false, $true)
$historyRoot = Join-Path $PSScriptRoot 'AI-Analysis'
$historyStockPattern = '(?:TAIEX|(?:TX|MTX|TMF|TE|TF|XIF)-(?:NEAR|NEXT)|\d{4,6}[A-Z]?|US-[A-Z][A-Z0-9]{0,5}(?:-[A-Z])?)'
$historyIdPattern = '\d{8}T\d{9}Z_[0-9a-f]{16}'
$historyModelPattern = '[A-Za-z0-9_.-]{1,64}'
# User settings live outside release directories. No provider tokens are stored here.
$userDataBase = [Environment]::GetFolderPath('LocalApplicationData')
$userDataRoot = if ($userDataBase) { Join-Path $userDataBase 'MarketWatchAssistant\UserData' } else { Join-Path $PSScriptRoot 'UserData' }
$settingsRoot = Join-Path $userDataRoot 'Settings'
$settingsCurrent = Join-Path $settingsRoot 'current.json'
$settingsBackupRoot = Join-Path $settingsRoot 'Backups'
$settingsBackupPattern = '^\d{8}T\d{9}Z_[0-9a-f]{8}\.json$'
$updateRoot = Join-Path $userDataRoot 'Updates'
$updateProcess = $null
$appReady = $false
$updatePolicy = @{enabled=$true;autoDownload=$true}
$nextUpdateSchedule = [DateTime]::MinValue
$settingsFutureFormat = $false

function Get-CasSha256([byte[]]$bytes) {
    $hash = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($hash.ComputeHash($bytes)).Replace('-', '').ToLowerInvariant() }
    finally { $hash.Dispose() }
}
function Test-CasSettingsPack($pack) {
    foreach($name in $pack.PSObject.Properties.Name){if($name -cnotin @('format','schemaVersion','appVersion','savedAt','data')){return $false}}
    if ($pack.format -cne 'market-watch-settings' -or $pack.schemaVersion -ne 1 -or !$pack.data -or !$pack.savedAt) { return $false }
    $data = $pack.data
    if ($data.watch -isnot [array] -or $data.watch.Count -gt 20 -or $data.rules -isnot [pscustomobject]) { return $false }
    $allowed = @('watch','rules','watchSort','watchOrder','watchPins','seconds','notify','snapshot','snapshotFields','appearance','chartPeriod','chartMonths','profileDays','backup','update','updatedAt')
    foreach ($prop in $data.PSObject.Properties.Name) { if ($prop -cnotin $allowed) { return $false } }
    if ($data.updatedAt -isnot [long] -and $data.updatedAt -isnot [int] -and $data.updatedAt -isnot [double]) { return $false }
    if ($data.updatedAt -le 0 -or $data.updatedAt -gt [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + 300000) { return $false }
    $seen = @{}
    foreach ($m in $data.watch) {
        if ($m.id -isnot [string] -or $m.id -cnotmatch '^(?:TAIEX|TX|MTX|TMF|TE|TF|XIF|\d{4,6}[A-Z]?|US:[A-Z][A-Z0-9]{0,5}(?:-[A-Z])?)$' -or $seen.ContainsKey($m.id)) { return $false }
        $seen[$m.id] = $true
        foreach ($name in $m.PSObject.Properties.Name) { if ($name -cnotin @('id','name','market','type','exchange','contract')) { return $false } }
        if ($m.name -isnot [string] -or !$m.name.Trim() -or $m.name.Length -gt 100 -or $m.market -isnot [string] -or $m.market.Length -gt 120) { return $false }
        if ($m.id -cmatch '^(TX|MTX|TMF|TE|TF|XIF)$') { if ($m.contract -cnotin @('近月','次月')) { return $false } }
        elseif ($m.exchange -cnotin @('tse','otc','esb','us') -or ($m.id.StartsWith('US:') -ne ($m.exchange -ceq 'us'))) { return $false }
    }
    $numbers = @('move','stop','warn','volume','cost','lots','entry','target','riskBudget','relative','cooldown','burst','sidePct','spread','targetNear')
    foreach ($rule in $data.rules.PSObject.Properties) {
        if (!$seen.ContainsKey($rule.Name)) { return $false }
        foreach ($v in $rule.Value.PSObject.Properties) {
            if ($v.Name -cin $numbers) {
                if ($v.Value -isnot [ValueType] -or $v.Value -is [bool]) { return $false }
                $n = [double]$v.Value
                if ([double]::IsNaN($n) -or [double]::IsInfinity($n) -or $n -lt 0 -or $n -gt 1e12 -or ($v.Name -ceq 'targetNear' -and $n -gt 100) -or ($v.Name -ceq 'sidePct' -and $n -ne 0 -and ($n -lt 51 -or $n -gt 100))) { return $false }
            } elseif ($v.Name -cnotin @('enabled','tech','band','profileAlert') -or $v.Value -isnot [bool]) { return $false }
        }
    }
    $groups = @{appearance=@('theme','font','contrast','background','foreground','accent');snapshotFields=@('time','range','volume');backup=@('enabled','minutes');update=@('enabled','autoDownload')}
    foreach ($group in $groups.Keys) {
        foreach ($name in $data.$group.PSObject.Properties.Name) { if ($name -cnotin $groups[$group]) { return $false } }
    }
    return $true
}
function Read-CasSettingsFile([string]$file) {
    if (![IO.File]::Exists($file)) { return $null }
    $info = [IO.FileInfo]::new($file)
    if ($info.Length -gt 200000) { throw 'Settings file is too large' }
    $bytes = [IO.File]::ReadAllBytes($file)
    $pack = ConvertFrom-Json -InputObject ($utf8.GetString($bytes).TrimStart([char]0xfeff)) -ErrorAction Stop
    if ($pack.format -ceq 'market-watch-settings' -and $pack.schemaVersion -gt 1) { $script:settingsFutureFormat=$true; throw 'Newer settings format' }
    if (!(Test-CasSettingsPack $pack)) { throw 'Invalid settings file' }
    return @{pack=$pack;revision=(Get-CasSha256 $bytes);file=$info.Name}
}
function Read-CasCurrentSettings {
    $script:settingsFutureFormat=$false
    try { $item=Read-CasSettingsFile $settingsCurrent; if ($item) { $item.source='current'; return $item } } catch {
        if ($script:settingsFutureFormat) { throw 'The settings file requires a newer app version' }
    }
    if ([IO.Directory]::Exists($settingsBackupRoot)) {
        foreach ($file in @(Get-ChildItem -LiteralPath $settingsBackupRoot -File | Where-Object { $_.Name -cmatch $settingsBackupPattern } | Sort-Object Name -Descending)) {
            try { $item=Read-CasSettingsFile $file.FullName; if ($item) { $item.source='backup'; return $item } } catch {}
        }
    }
    if ([IO.File]::Exists($settingsCurrent)) { throw 'No valid settings backup is available' }
    return $null
}
function Send-CasJson($response, $data, [int]$status=200) {
    Send-CasResponse $response $status 'application/json; charset=utf-8' ($utf8.GetBytes((ConvertTo-Json -InputObject $data -Depth 20 -Compress)))
}
function Get-CasSettings($response) {
    try {
        $item=Read-CasCurrentSettings
        Send-CasJson $response @{current=$item;path=$settingsRoot}
    } catch { Send-CasJson $response @{error=$_.Exception.Message;path=$settingsRoot} 500 }
}
function Get-CasSettingsBackups($response) {
    $items=@()
    if ([IO.Directory]::Exists($settingsBackupRoot)) {
        foreach ($file in @(Get-ChildItem -LiteralPath $settingsBackupRoot -File | Where-Object { $_.Name -cmatch $settingsBackupPattern } | Sort-Object Name -Descending | Select-Object -First 30)) {
            try { $item=Read-CasSettingsFile $file.FullName; $items+=@{id=$file.Name;savedAt=$item.pack.savedAt;updatedAt=$item.pack.data.updatedAt;count=@($item.pack.data.watch).Count} } catch {}
        }
    }
    Send-CasJson $response @{items=@($items)}
}
function Save-CasSettings($response, $requestData) {
    if (!(Test-CasSettingsPack $requestData.pack) -or $requestData.baseRevision -isnot [string] -or $requestData.baseRevision -cnotmatch '^(?:[0-9a-f]{64})?$') { Send-CasResponse $response 400; return }
    $lock=$null;$temporary=$null
    try {
        [void][IO.Directory]::CreateDirectory($settingsRoot)
        [void][IO.Directory]::CreateDirectory($settingsBackupRoot)
        $lock=[IO.File]::Open((Join-Path $settingsRoot 'write.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
        $existing=Read-CasCurrentSettings
        $revision=if($existing){$existing.revision}else{''}
        if ($requestData.baseRevision -cne $revision) { Send-CasResponse $response 409; return }
        $bytes=$utf8.GetBytes((ConvertTo-Json -InputObject $requestData.pack -Depth 20 -Compress))
        if ($bytes.Length -gt 200000) { Send-CasResponse $response 400; return }
        $temporary=Join-Path $settingsRoot ([Guid]::NewGuid().ToString('N')+'.tmp')
        [IO.File]::WriteAllBytes($temporary,$bytes)
        $backupName=[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')+'_'+[Guid]::NewGuid().ToString('N').Substring(0,8)+'.json'
        $backupPath=Join-Path $settingsBackupRoot $backupName
        if ([IO.File]::Exists($settingsCurrent)) { [IO.File]::Replace($temporary,$settingsCurrent,$backupPath) }
        else { [IO.File]::Move($temporary,$settingsCurrent) }
        if ($requestData.snapshot -eq $true) {
            $snapshotName=[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')+'_'+[Guid]::NewGuid().ToString('N').Substring(0,8)+'.json'
            [IO.File]::WriteAllBytes((Join-Path $settingsBackupRoot $snapshotName),$bytes)
        }
        Get-ChildItem -LiteralPath $settingsBackupRoot -File | Where-Object { $_.Name -cmatch $settingsBackupPattern } | Sort-Object Name -Descending | Select-Object -Skip 30 | ForEach-Object { try { [IO.File]::Delete($_.FullName) } catch {} }
        if($requestData.pack.data.update){$script:updatePolicy=$requestData.pack.data.update}
        Send-CasJson $response @{revision=(Get-CasSha256 $bytes);savedAt=$requestData.pack.savedAt;path=$settingsRoot}
    } catch { Send-CasResponse $response 500 }
    finally { if($lock){$lock.Dispose()};if($temporary -and [IO.File]::Exists($temporary)){try{[IO.File]::Delete($temporary)}catch{}} }
}
function Read-CasUpdateState {
    $file=Join-Path $updateRoot 'state.json'
    try { if([IO.File]::Exists($file)){return ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($file,$utf8))} } catch {}
    return @{status='idle';message='尚未檢查更新';currentVersion='0.2.40'}
}
function Start-CasUpdate([string]$action='Check') {
    if ($script:updateProcess -and !$script:updateProcess.HasExited) { return $false }
    if ($script:updateProcess) { $script:updateProcess.Dispose();$script:updateProcess=$null }
    $scriptPath=Join-Path $PSScriptRoot 'Update-Manager.ps1'
    $auto=$script:updatePolicy.autoDownload -ne $false
    $arguments=@('-NoLogo','-NoProfile','-File',('"'+$scriptPath+'"'),'-Action',$action,'-InstallRoot',('"'+$PSScriptRoot+'"'))
    if($auto){$arguments+='-AutoDownload'}
    $script:updateProcess=Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList $arguments -WindowStyle Hidden -PassThru
    return $true
}
function Update-CasReleaseSchedule {
    if(!$script:appReady -or [DateTime]::UtcNow -lt $script:nextUpdateSchedule){return}
    $script:nextUpdateSchedule=[DateTime]::UtcNow.AddSeconds(30)
    if($script:updateProcess -and !$script:updateProcess.HasExited){return}
    try {
        if($script:updatePolicy.enabled -eq $false){return}
        $status=Read-CasUpdateState
        if($status.lastChecked -and ([DateTimeOffset]::Parse($status.lastChecked).ToLocalTime().Date -eq [DateTime]::Now.Date)){return}
        if($status.lastAttempt -and [DateTimeOffset]::UtcNow.Subtract([DateTimeOffset]::Parse($status.lastAttempt)).TotalMinutes -lt 60){return}
        [void](Start-CasUpdate 'Check')
    }catch{}
}

$runtimeLock=$null
$routes = @{
    mis       = @('https://mis.twse.com.tw/stock/api/getStockInfo.jsp?', 'query')
    yquote    = @('https://tw.finance.yahoo.com/quote/', 'symbol')
    chart2    = @('https://query2.finance.yahoo.com/v8/finance/chart/', 'chart')
    'future-quote' = @('https://tw.finance.yahoo.com/future/', 'symbol')
    future    = @('https://tw.finance.yahoo.com/future', 'none')
    'tf-positions' = @('https://www.taifex.com.tw/cht/3/futContractsDate?queryDate=', 'position-date')
    'tf-put-call' = @('https://www.taifex.com.tw/cht/3/pcRatio', 'none')
    'tf-large-traders' = @('https://www.taifex.com.tw/cht/3/largeTraderFutQryTbl', 'none')
    'market-summary' = @('https://www.twse.com.tw/exchangeReport/MI_INDEX?response=html&date=', 'position-date')
    'cash-positions' = @('https://www.twse.com.tw/rwd/zh/fund/BFI82U?response=json&type=day&dayDate=', 'position-date')
    'tf-report' = @('https://www.taifex.com.tw/cht/3/futDailyMarketReport?', 'query')
    'tf-ticks-index' = @('https://www.taifex.com.tw/cht/3/futPrevious30DaysSalesData', 'none')
    'tf-ticks' = @('https://www.taifex.com.tw/file/taifex/Dailydownload/DailydownloadCSV/Daily_', 'tick-date')
    index     = @('https://www.twse.com.tw/rwd/zh/TAIEX/MI_5MINS_HIST?', 'query')
    'otc-day' = @('https://www.tpex.org.tw/www/zh-tw/afterTrading/tradingStock?', 'query')
    daily     = @('https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY?', 'query')
    'inst-tse' = @('https://www.twse.com.tw/rwd/zh/fund/T86?', 'query')
    'inst-otc' = @('https://www.tpex.org.tw/www/zh-tw/insti/dailyTrade?', 'query')
    'revenue-history' = @('https://mopsov.twse.com.tw/nas/t21/', 'revenue-file')
    'listed-names-csv' = @('https://mopsfin.twse.com.tw/opendata/t187ap03_L.csv', 'none')
    'otc-names-csv' = @('https://mopsfin.twse.com.tw/opendata/t187ap03_O.csv', 'none')
    'esb-names-csv' = @('https://mopsfin.twse.com.tw/opendata/t187ap03_R.csv', 'none')
    'listed-names' = @('https://openapi.twse.com.tw/v1/opendata/t187ap03_L', 'none')
    'otc-names' = @('https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O', 'none')
    'esb-names' = @('https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_R', 'none')
    names     = @('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL', 'none')
    otc       = @('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes', 'none')
    esb       = @('https://www.tpex.org.tw/openapi/v1/tpex_esb_latest_statistics', 'none')
    valuation = @('https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL', 'none')
    revenue   = @('https://openapi.twse.com.tw/v1/opendata/t187ap05_L', 'none')
    'revenue-otc' = @('https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap05_O', 'none')
    'revenue-esb' = @('https://mopsfin.twse.com.tw/opendata/t187ap05_R.csv', 'none')
    news      = @('https://news.google.com/rss/search?', 'query')
    ynews     = @('https://tw.stock.yahoo.com/rss?s=', 'symbol')
}

function Get-CasNoticeColors($inputColors) {
    $colors = @{}
    foreach ($key in $script:defaultNoticeColors.Keys) {
        $value = if ($null -ne $inputColors) { $inputColors.$key }
        if ($value -isnot [string] -or $value -cnotmatch '^#[0-9A-Fa-f]{6}$') { return $script:defaultNoticeColors }
        $colors[$key] = $value
    }
    return $colors
}

function Show-CasDesktopNotice([string]$text, [hashtable]$colors) {
    if (!$script:noticeWindow) {
        $window = [System.Windows.Window]::new()
        $window.WindowStyle = 'None'
        $window.ResizeMode = 'NoResize'
        $window.ShowInTaskbar = $false
        $window.ShowActivated = $false
        $window.Topmost = $true
        $window.WindowStartupLocation = 'Manual'
        $window.Height = 148
        $window.AllowsTransparency = $true
        $window.Background = [System.Windows.Media.Brushes]::Transparent
        $frame = [System.Windows.Controls.Border]::new()
        $frame.BorderThickness = [System.Windows.Thickness]::new(1)
        $frame.CornerRadius = [System.Windows.CornerRadius]::new(13)
        $frame.Padding = [System.Windows.Thickness]::new(15, 11, 15, 11)

        $stack = [System.Windows.Controls.StackPanel]::new()
        $label = [System.Windows.Controls.TextBlock]::new()
        $label.Text = '●  看盤小助手　｜　桌面警報'
        $label.FontWeight = [System.Windows.FontWeights]::SemiBold
        $label.FontSize = 12
        [void]$stack.Children.Add($label)

        $headline = [System.Windows.Controls.TextBlock]::new()
        $headline.Margin = [System.Windows.Thickness]::new(0, 7, 0, 0)
        $headline.FontWeight = [System.Windows.FontWeights]::SemiBold
        $headline.FontSize = 18
        $headline.TextTrimming = 'CharacterEllipsis'
        [void]$stack.Children.Add($headline)

        $message = [System.Windows.Controls.TextBlock]::new()
        $message.Margin = [System.Windows.Thickness]::new(0, 6, 0, 0)
        $message.TextWrapping = 'Wrap'
        $message.TextTrimming = 'CharacterEllipsis'
        $message.MaxHeight = 60
        $message.FontSize = 14
        [void]$stack.Children.Add($message)

        $frame.Child = $stack
        $window.Content = $frame
        $script:noticeWindow = $window
        $script:noticeText = $message
        $script:noticeHeadline = $headline
    }

    $theme = $colors.background + $colors.foreground + $colors.accent + $colors.border
    if ($script:noticeWindow.Tag -cne $theme) {
        $frame = $script:noticeWindow.Content
        $frame.Background = [System.Windows.Media.SolidColorBrush]::new([System.Windows.Media.ColorConverter]::ConvertFromString($colors.background))
        $frame.BorderBrush = [System.Windows.Media.SolidColorBrush]::new([System.Windows.Media.ColorConverter]::ConvertFromString($colors.border))
        $frame.Child.Children[0].Foreground = [System.Windows.Media.SolidColorBrush]::new([System.Windows.Media.ColorConverter]::ConvertFromString($colors.accent))
        $foreground = [System.Windows.Media.SolidColorBrush]::new([System.Windows.Media.ColorConverter]::ConvertFromString($colors.foreground))
        $script:noticeHeadline.Foreground = $foreground
        $script:noticeText.Foreground = $foreground
        $script:noticeWindow.Tag = $theme
    }
    $workArea = [System.Windows.SystemParameters]::WorkArea
    $script:noticeWindow.Width = [Math]::Min(368, [Math]::Max(180, $workArea.Width - 24))
    $script:noticeWindow.Left = [Math]::Max($workArea.Left, $workArea.Right - $script:noticeWindow.Width - 12)
    $script:noticeWindow.Top = [Math]::Max($workArea.Top, $workArea.Bottom - $script:noticeWindow.Height - 12)
    $separator = $text.IndexOf('｜')
    if ($separator -gt 0 -and $separator -lt ($text.Length - 1)) {
        $script:noticeHeadline.Text = $text.Substring(0, $separator)
        $script:noticeText.Text = $text.Substring($separator + 1)
    } else {
        $script:noticeHeadline.Text = '桌面警報預覽'
        $script:noticeText.Text = $text
    }
    if (!$script:noticeWindow.IsVisible) { $script:noticeWindow.Show() }
    [void]$script:noticeWindow.Dispatcher.Invoke([Action]{}, [System.Windows.Threading.DispatcherPriority]::Background)
    if (!$script:noticeWindow.IsVisible) { throw 'Desktop window did not become visible.' }
    $script:noticeUntil = [DateTime]::UtcNow.AddSeconds(8)
}

function Reset-CasPopup {
    if ($script:noticeWindow) {
        try { $script:noticeWindow.Close() } catch {}
    }
    $script:noticeWindow = $null
    $script:noticeText = $null
    $script:noticeHeadline = $null
}

function Send-CasDesktopAlert([string]$text, [hashtable]$colors) {
    if (!$script:desktopAvailable) { throw 'Windows desktop window components are unavailable.' }
    if ($script:noticeWindow -and $script:noticeWindow.IsVisible) {
        if ($script:noticeQueue.Count -ge 4) { return 'full' }
        $script:noticeQueue.Enqueue(@{Text=$text; Colors=$colors})
        return 'queued'
    }
    try {
        Show-CasDesktopNotice $text $colors
        return 'popup'
    } catch {
        Reset-CasPopup
        throw
    }
}

function Update-CasDesktopNotice {
    if ($script:noticeWindow) {
        try {
            if ($script:noticeWindow.IsVisible) {
                if ([DateTime]::UtcNow -ge $script:noticeUntil) { $script:noticeWindow.Hide() }
                else { [void]$script:noticeWindow.Dispatcher.Invoke([Action]{}, [System.Windows.Threading.DispatcherPriority]::Background) }
            }
        } catch {
            Write-Host ('桌面小窗更新失敗：' + $_.Exception.Message)
            Reset-CasPopup
        }
    }
    if ($script:noticeQueue.Count -gt 0 -and (!$script:noticeWindow -or !$script:noticeWindow.IsVisible)) {
        $entry = $script:noticeQueue.Dequeue()
        try { [void](Send-CasDesktopAlert $entry.Text $entry.Colors) }
        catch { Write-Host ('Queued desktop alert failed: ' + $_.Exception.Message) }
    }
}

function Send-CasResponse($response, [int]$status, [string]$type = 'text/plain; charset=utf-8', [byte[]]$bytes = @()) {
    try {
        $response.StatusCode = $status
        $response.ContentType = $type
        $response.Headers['Cache-Control'] = 'no-store'
        $response.Headers['X-Content-Type-Options'] = 'nosniff'
        $response.Headers['X-Frame-Options'] = 'DENY'
        $response.Headers['Referrer-Policy'] = 'no-referrer'
        $response.Headers['Content-Security-Policy'] = "frame-ancestors 'none'"
        $response.ContentLength64 = $bytes.Length
        if ($bytes.Length) { $response.OutputStream.Write($bytes, 0, $bytes.Length) }
    } catch [System.IO.IOException] {
        # A closed browser tab or timed out request needs no retry.
    } catch [System.Net.HttpListenerException] {
        # The client disconnected.
    } finally {
        $response.Close()
    }
}

function Get-CasMarketUri([string]$path) {
    $separator = $path.IndexOf('/')
    $name = if ($separator -lt 0) { $path } else { $path.Substring(0, $separator) }
    $route = $routes[$name]
    if (!$route) { return $null }
    $tail = if ($separator -ge 0) { $path.Substring($separator + 1) } else { '' }
    switch ($route[1]) {
        'none' { if ($tail -or $separator -ge 0) { return $null } }
        'query' { if ($tail -cnotmatch '^[A-Za-z0-9_%.,=+&~-]{1,2000}$') { return $null } }
        'revenue-file' { if ($tail -cnotmatch '^(?:sii|otc|rotc)/t21sc03_\d{3}_(?:[1-9]|1[0-2])_[01]\.html$') { return $null } }
        'symbol' { if ($tail -cnotmatch '^(?:[A-Za-z0-9._-]|%[0-9A-Fa-f]{2}){1,32}$' -or [Uri]::UnescapeDataString($tail) -cnotmatch '^[A-Za-z0-9^][A-Za-z0-9._^@&-]{0,31}$') { return $null } }
        'position-date' {
            if ($tail -cnotmatch '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') { return $null }
            $day = [DateTime]::MinValue
            if (![DateTime]::TryParseExact($tail, 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture,
                [Globalization.DateTimeStyles]::None, [ref]$day)) { return $null }
            $today = [DateTime]::UtcNow.AddHours(8).Date
            if ($day -gt $today -or $day -lt $today.AddDays(-30)) { return $null }
            if ($name -in 'cash-positions', 'market-summary') { return $route[0] + $tail.Replace('-', '') }
            return $route[0] + $tail.Replace('-', '%2F')
        }
        'tick-date' {
            if ($tail -cnotmatch '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') { return $null }
            $day = [DateTime]::MinValue
            if (![DateTime]::TryParseExact($tail, 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture,
                [Globalization.DateTimeStyles]::None, [ref]$day)) { return $null }
            $today = [DateTime]::UtcNow.AddHours(8).Date
            if ($day -gt $today -or $day -lt $today.AddDays(-65)) { return $null }
            return $route[0] + $tail.Replace('-', '_') + '.zip'
        }
        'chart' {
            if ($tail -cnotmatch '^((?:[A-Za-z0-9._-]|%[0-9A-Fa-f]{2}){1,32})\?(?:range=1d&interval=5m|range=1mo&interval=15m|range=60d&interval=15m|range=2y&interval=1d|period1=[0-9]{1,10}&period2=[0-9]{10}&interval=1d)$' -or
                [Uri]::UnescapeDataString($Matches[1]) -cnotmatch '^[A-Za-z0-9^][A-Za-z0-9._^@&-]{0,31}$') { return $null }
            if ($tail -match '\?period1=([0-9]+)&period2=([0-9]+)&interval=1d$') {
                $from = [long]$Matches[1]; $to = [long]$Matches[2]
                $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
                if ($from -ge $to -or $to -gt $now + 86400 -or $to -lt $now - 86400 -or $to - $from -gt 31L * 366L * 86400L) { return $null }
            }
        }
    }
    return $route[0] + $tail
}

function Read-CasJson($request, [int]$limit) {
    if ($request.Headers['Transfer-Encoding'] -or $request.ContentType -notmatch '^application/json(?:\s*;.*)?$' -or
        $request.ContentLength64 -lt 2 -or $request.ContentLength64 -gt $limit) { throw 'Invalid request body' }
    $bytes = New-Object byte[] ([int]$request.ContentLength64)
    try {
        $read = 0
        while ($read -lt $bytes.Length) {
            $n = $request.InputStream.Read($bytes, $read, $bytes.Length - $read)
            if ($n -le 0) { throw 'Incomplete request body' }
            $read += $n
        }
        return ConvertFrom-Json -InputObject ($utf8.GetString($bytes)) -ErrorAction Stop
    } finally { [Array]::Clear($bytes, 0, $bytes.Length) }
}

function Get-CasHistoryDirectory([string]$stock) {
    $directory = Join-Path $historyRoot $stock
    foreach ($folder in @($historyRoot, $directory)) {
        if ([IO.Directory]::Exists($folder) -and ([IO.File]::GetAttributes($folder) -band [IO.FileAttributes]::ReparsePoint)) {
            throw 'Analysis history folder is redirected'
        }
    }
    return $directory
}

function Send-CasHistoryJson($response, $data) {
    Send-CasResponse $response 200 'application/json; charset=utf-8' ($utf8.GetBytes((ConvertTo-Json -InputObject $data -Compress -Depth 4)))
}

function Get-CasHistory($response, [string]$stock, [string]$cursor) {
    try {
        $directory = Get-CasHistoryDirectory $stock
        $ids = @()
        if ([IO.Directory]::Exists($directory)) {
            $ids = @([IO.Directory]::EnumerateFiles($directory, '*.txt') | ForEach-Object {
                $id = [IO.Path]::GetFileNameWithoutExtension($_)
                if ($id -cmatch ('\A' + $historyIdPattern + '\z') -and
                    (!$cursor -or [String]::CompareOrdinal($id, $cursor) -lt 0)) { $id }
            } | Sort-Object -Descending | Select-Object -First 41)
        }
        $next = if ($ids.Count -gt 40) { $ids[39] } else { $null }
        Send-CasHistoryJson $response @{ ids = @($ids | Select-Object -First 40); next = $next }
    } catch { Send-CasResponse $response 500 }
}

function Get-CasAnalysisRecord($response, [string]$stock, [string]$id) {
    try {
        $file = [IO.FileInfo]::new((Join-Path (Get-CasHistoryDirectory $stock) ($id + '.txt')))
        if (!$file.Exists) { Send-CasResponse $response 404; return }
        if ($file.Length -gt 405000 -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            Send-CasResponse $response 422; return
        }
        $parts = [IO.File]::ReadAllText($file.FullName, $utf8) -split '\r?\n\r?\n', 2
        $fields = $parts[0] -split '\r?\n'
        if ($parts.Count -ne 2 -or $fields.Count -ne 3 -or $fields[1] -cnotmatch ('^Model: (' + $historyModelPattern + ')$')) {
            Send-CasResponse $response 422; return
        }
        Send-CasHistoryJson $response @{ id = $id; provider = $fields[1].Substring(7); text = $parts[1] }
    } catch { Send-CasResponse $response 500 }
}

function Save-CasAnalysisRecord($response, $data) {
    if ($data.stock -isnot [string] -or $data.stock -cnotmatch ('\A' + $historyStockPattern + '\z') -or
        $data.id -isnot [string] -or $data.id -cnotmatch ('\A' + $historyIdPattern + '\z') -or
        $data.provider -isnot [string] -or $data.provider -cnotmatch ('\A' + $historyModelPattern + '\z') -or
        $data.text -isnot [string] -or !$data.text.Trim() -or $data.text.Length -gt 100000) {
        Send-CasResponse $response 400; return
    }
    $pendingFile = $null
    try {
        $directory = Get-CasHistoryDirectory $data.stock
        $file = Join-Path $directory ($data.id + '.txt')
        $timestamp = [DateTime]::ParseExact($data.id.Split('_')[0], "yyyyMMdd'T'HHmmssfff'Z'", [Globalization.CultureInfo]::InvariantCulture)
        $stamp = $timestamp.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", [Globalization.CultureInfo]::InvariantCulture)
        $content = "Stock: $($data.stock)`r`nModel: $($data.provider)`r`nTime (UTC): $stamp`r`n`r`n$($data.text)"
        [void][IO.Directory]::CreateDirectory($directory)
        $pendingFile = Join-Path $directory ([Guid]::NewGuid().ToString('N') + '.tmp')
        if (![IO.File]::Exists($file)) {
            [IO.File]::WriteAllText($pendingFile, $content, [Text.UTF8Encoding]::new($true, $true))
            try { [IO.File]::Move($pendingFile, $file) }
            catch [IO.IOException] { if (![IO.File]::Exists($file)) { throw } }
        }
        if (([IO.File]::GetAttributes($file) -band [IO.FileAttributes]::ReparsePoint) -or
            ([IO.FileInfo]::new($file)).Length -gt 405000 -or
            ![String]::Equals([IO.File]::ReadAllText($file, $utf8), $content, [StringComparison]::Ordinal)) {
            Send-CasResponse $response 409; return
        }
        Send-CasResponse $response 200
    } catch {
        Send-CasResponse $response 500
    } finally {
        if ($pendingFile -and [IO.File]::Exists($pendingFile)) {
            try { [IO.File]::Delete($pendingFile) } catch {}
        }
    }
}

function Add-CasUpstream($response, [string]$uri, [string]$kind, $payload = $null, [string]$key = '') {
    if ($pending.Count -ge 24) { Send-CasResponse $response 503; return }
    $method = if ($null -ne $payload) { [Net.Http.HttpMethod]::Post } else { [Net.Http.HttpMethod]::Get }
    $message = [System.Net.Http.HttpRequestMessage]::new($method, [Uri]$uri)
    try {
        if ($null -ne $payload) {
            $json = ConvertTo-Json -InputObject $payload -Compress -Depth 16
            $message.Content = [System.Net.Http.StringContent]::new($json, $utf8, 'application/json')
        }
        if ($kind -in 'openai', 'groq') { $message.Headers.Authorization = [System.Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer', $key) }
        if ($kind -in 'gemini', 'gemini-models') { $message.Headers.Add('x-goog-api-key', $key) }
        if ($kind -eq 'market' -and $uri.StartsWith($routes.mis[0], [StringComparison]::Ordinal)) {
            $message.Headers.Referrer = [Uri]'https://mis.twse.com.tw/stock/index.jsp'
        }
        if ($kind -eq 'taifex-zip') {
            $message.Headers.Referrer = [Uri]($routes['tf-ticks-index'][0])
            $message.Headers.CacheControl = [System.Net.Http.Headers.CacheControlHeaderValue]::new()
            $message.Headers.CacheControl.NoCache = $true
            $task = $tickClient.SendAsync($message)
        } else {
            $task = $client.SendAsync($message)
        }
        [void]$pending.Add(@{ response = $response; message = $message; task = $task; kind = $kind })
    } catch {
        $message.Dispose()
        Send-CasResponse $response 502
    }
}

function Complete-CasUpstreams {
    for ($i = $pending.Count - 1; $i -ge 0; $i--) {
        $job = $pending[$i]
        if (!$job.task.IsCompleted) { continue }
        $pending.RemoveAt($i)
        $upstream = $null
        try {
            $upstream = $job.task.GetAwaiter().GetResult()
            $code = [int]$upstream.StatusCode
            if ($code -ge 300 -and $code -lt 400) { $code = 502 }
            if ($code -lt 200 -or $code -ge 300) {
                Send-CasResponse $job.response $code
            } elseif ($job.kind -eq 'telegram') {
                $body = $upstream.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json
                if ($body.ok -eq $true) { Send-CasResponse $job.response 200 }
                else { Send-CasResponse $job.response 502 }
            } else {
                $bytes = $upstream.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
                if ($job.kind -eq 'taifex-zip') {
                    if ($bytes.Length -lt 22 -or $bytes[0] -ne 80 -or $bytes[1] -ne 75) {
                        Send-CasResponse $job.response 502
                    } else {
                        Send-CasResponse $job.response 200 'application/zip' $bytes
                    }
                } else {
                    Send-CasResponse $job.response 200 'text/plain; charset=utf-8' $bytes
                }
            }
        } catch {
            Send-CasResponse $job.response 502
        } finally {
            if ($upstream) { $upstream.Dispose() }
            $job.message.Dispose()
        }
    }
}

try {
    $runtimeLock=[IO.File]::Open((Join-Path $PSScriptRoot 'runtime.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
    $page = [IO.File]::ReadAllBytes((Join-Path $PSScriptRoot 'app.html'))
    Add-Type -AssemblyName System.Net.Http
    if ([Threading.Thread]::CurrentThread.GetApartmentState() -eq [Threading.ApartmentState]::STA) {
        try {
            Add-Type -AssemblyName WindowsBase, PresentationCore, PresentationFramework
            $desktopAvailable = $true
        } catch {
            Write-Host ('無法載入 Windows 桌面小窗：' + $_.Exception.Message)
        }
    }
    if ($PSVersionTable.PSVersion.Major -lt 6) { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 }
    $handler = [System.Net.Http.HttpClientHandler]::new()
    $handler.AllowAutoRedirect = $false
    $handler.UseCookies = $false
    $handler.AutomaticDecompression = [Net.DecompressionMethods]::GZip -bor [Net.DecompressionMethods]::Deflate
    $client = [System.Net.Http.HttpClient]::new($handler)
    $client.Timeout = [TimeSpan]::FromSeconds(18)
    $client.MaxResponseContentBufferSize = 4400000
    $client.DefaultRequestHeaders.UserAgent.ParseAdd('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36')

    $tickClient = [System.Net.Http.HttpClient]::new($handler, $false)
    $tickClient.Timeout = [TimeSpan]::FromSeconds(34)
    $tickClient.MaxResponseContentBufferSize = 41943040
    $tickClient.DefaultRequestHeaders.UserAgent.ParseAdd($client.DefaultRequestHeaders.UserAgent.ToString())

    $random = New-Object byte[] 16
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($random) } finally { $rng.Dispose() }
    $session = [BitConverter]::ToString($random).Replace('-', '').ToLowerInvariant()
    [Array]::Clear($random, 0, $random.Length)
    foreach ($port in 18888..18907) {
        $origin = 'http://localhost:' + $port
        $candidate = [System.Net.HttpListener]::new()
        $candidate.Prefixes.Add($origin + '/')
        try { $candidate.Start(); $listener = $candidate; break }
        catch [Net.HttpListenerException] { $candidate.Close() }
    }
    if (!$listener) { throw '無法開啟 localhost。請檢查連接埠及公司電腦的本機服務政策。' }

    $url = $origin + '/#' + $session
    Write-Host '看盤小助手 v0.2.40 已啟動。請保留本視窗。'
    Write-Host ('本次啟動網址（請勿轉傳）：' + $url)
    if (!$NoBrowser) { try { Start-Process $url } catch { Write-Host '請複製上方網址到瀏覽器開啟。' } }
    $nextRequest = $listener.GetContextAsync()
    while ($running) {
        Complete-CasUpstreams
        Update-CasDesktopNotice
        Update-CasReleaseSchedule
        if (!$nextRequest.IsCompleted) { Start-Sleep -Milliseconds 35; continue }
        $context = $nextRequest.GetAwaiter().GetResult()
        $nextRequest = $listener.GetContextAsync()
        $request = $context.Request
        $response = $context.Response
        try {
            if (![Net.IPAddress]::IsLoopback($request.RemoteEndPoint.Address) -or
                $request.Headers['Host'] -cne ('localhost:' + $port)) { Send-CasResponse $response 403; continue }
            $verb = $request.HttpMethod
            $path = $request.RawUrl
            if ($verb -eq 'GET' -and $path -eq '/') {
                Send-CasResponse $response 200 'text/html; charset=utf-8' $page
                continue
            }
            if ($request.Headers['X-CAS-Session'] -cne $session -or $request.Headers['Sec-Fetch-Site'] -cne 'same-origin' -or
                ($verb -eq 'POST' -and $request.Headers['Origin'] -cne $origin)) { Send-CasResponse $response 403; continue }
            if ($verb -eq 'GET') {
                if ($path -cmatch ('^/ai-history/(' + $historyStockPattern + ')(?:/(' + $historyIdPattern + '))?$')) {
                    Get-CasHistory $response $Matches[1] $Matches[2]
                    continue
                }
                if ($path -cmatch ('^/ai-record/(' + $historyStockPattern + ')/(' + $historyIdPattern + ')$')) {
                    Get-CasAnalysisRecord $response $Matches[1] $Matches[2]
                    continue
                }
                if ($path -ceq '/settings-current') { Get-CasSettings $response; continue }
                if ($path -ceq '/settings-backups') { Get-CasSettingsBackups $response; continue }
                if ($path -cmatch '^/settings-backup/(\d{8}T\d{9}Z_[0-9a-f]{8}\.json)$') {
                    try { $item=Read-CasSettingsFile (Join-Path $settingsBackupRoot $Matches[1]);if($item){Send-CasJson $response $item}else{Send-CasResponse $response 404} } catch { Send-CasResponse $response 400 };continue
                }
                if ($path -ceq '/update-status') {
                    $busy=$script:updateProcess -and !$script:updateProcess.HasExited
                    Send-CasJson $response @{state=(Read-CasUpdateState);busy=[bool]$busy};continue
                }
                if ($path -eq '/telegram-status') {
                    $body = if ($telegram) { @{enabled=$true;chat=$telegram.chat} } else { @{enabled=$false;chat=''} }
                    Send-CasResponse $response 200 'application/json; charset=utf-8' ($utf8.GetBytes((ConvertTo-Json -InputObject $body -Compress)))
                    continue
                }
                $uri = Get-CasMarketUri ($path.TrimStart('/'))
                if (!$uri) { Send-CasResponse $response 404 }
                elseif ($path.StartsWith('/tf-ticks/', [StringComparison]::Ordinal)) {
                    if (@($pending | Where-Object { $_.kind -eq 'taifex-zip' }).Count -ge 2) { Send-CasResponse $response 503 }
                    else { Add-CasUpstream $response $uri 'taifex-zip' }
                } else { Add-CasUpstream $response $uri 'market' }
                continue
            }
            if ($verb -ne 'POST') { Send-CasResponse $response 405; continue }
            switch -CaseSensitive ($path) {
                '/settings-save' { Save-CasSettings $response (Read-CasJson $request 220000) }
                '/app-ready' {
                    $readyData=Read-CasJson $request 2048
                    if($readyData.update.enabled -is [bool] -and $readyData.update.autoDownload -is [bool]){$script:updatePolicy=$readyData.update}
                    $script:appReady=$true
                    $journal=Join-Path $PSScriptRoot 'update-journal.json'
                    if([IO.File]::Exists($journal)){try{[IO.File]::Delete($journal)}catch{}}
                    Send-CasResponse $response 200
                }
                '/update-check' { if(Start-CasUpdate 'Check'){Send-CasResponse $response 200}else{Send-CasResponse $response 409} }
                '/update-download' { if(Start-CasUpdate 'Download'){Send-CasResponse $response 200}else{Send-CasResponse $response 409} }

                '/ai-record' {
                    Save-CasAnalysisRecord $response (Read-CasJson $request 700000)
                }
                '/desktop-notice' {
                    try { $data = Read-CasJson $request 4096 }
                    catch {
                        Write-Host ('桌面警報請求讀取失敗：' + $_.Exception.Message)
                        Send-CasResponse $response 400
                        break
                    }
                    if ($data.text -isnot [string] -or !$data.text.Trim() -or $data.text.Length -gt 280) {
                        Send-CasResponse $response 400
                        break
                    }
                    try {
                        $colors = Get-CasNoticeColors $data.colors
                        $channel = Send-CasDesktopAlert $data.text $colors
                        if ($channel -eq 'full') { Send-CasResponse $response 429; break }
                        $body = ConvertTo-Json -InputObject @{channel=$channel} -Compress
                        Send-CasResponse $response 200 'application/json; charset=utf-8' ($utf8.GetBytes($body))
                    } catch {
                        Write-Host ('Windows 通知無法送出：' + $_.Exception.Message)
                        Send-CasResponse $response 503
                    }
                }
                '/exit' { $telegram = $null; Send-CasResponse $response 200; $running = $false }
                '/telegram-clear' { $telegram = $null; Send-CasResponse $response 200 }
                '/telegram-setup' {
                    $data = Read-CasJson $request 2048
                    if ($data.token -isnot [string] -or $data.token -cnotmatch '^\d{5,18}:[A-Za-z0-9_-]{20,128}$' -or
                        $data.chat -isnot [string] -or $data.chat -cnotmatch '^(?:-?\d{1,22}|@[A-Za-z0-9_]{5,32})$') { Send-CasResponse $response 400; break }
                    $telegram = @{token=$data.token;chat=$data.chat}
                    $data = $null
                    Send-CasResponse $response 200
                }
                '/telegram' {
                    if (!$telegram) { Send-CasResponse $response 409; break }
                    $data = Read-CasJson $request 20000
                    if ($data.text -isnot [string] -or !$data.text.Length -or $data.text.Length -gt 3900) { Send-CasResponse $response 400; break }
                    $target = 'https://api.telegram.org/bot' + $telegram.token + '/sendMessage'
                    Add-CasUpstream $response $target 'telegram' @{chat_id=$telegram.chat;text=$data.text;disable_notification=($data.disable_notification -eq $true)}
                    $target = $null
                }
                { $_ -cin '/openai', '/gemini', '/gemini-models', '/groq' } {
                    $key = $request.Headers['X-CAS-Provider-Key']
                    try {
                        $pattern = if ($path -cin '/gemini', '/gemini-models') { '^[A-Za-z0-9_.-]{16,255}$' } else { '^[A-Za-z0-9_-]{16,255}$' }
                        if ($key -cnotmatch $pattern) { Send-CasResponse $response 400; break }
                        if ($path -ceq '/gemini-models') {
                            Add-CasUpstream $response 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000' 'gemini-models' $null $key
                            break
                        }
                        $data = Read-CasJson $request 96000
                        if ($path -ceq '/openai') {
                            Add-CasUpstream $response 'https://api.openai.com/v1/responses' 'openai' $data $key
                        } elseif ($path -ceq '/groq') {
                            Add-CasUpstream $response 'https://api.groq.com/openai/v1/chat/completions' 'groq' $data $key
                        } else {
                            $model = $request.Headers['X-CAS-Gemini-Model']
                            if ($model -cnotmatch '^gemini-\d{1,2}\.\d{1,2}-flash-lite(?:-\d{3})?$') { Send-CasResponse $response 400; break }
                            $url = 'https://generativelanguage.googleapis.com/v1beta/models/' + $model + ':generateContent'
                            Add-CasUpstream $response $url 'gemini' $data $key
                        }
                    } finally { $key = $null }
                }
                default { Send-CasResponse $response 404 }
            }
        } catch {
            Send-CasResponse $response 400
        }
    }
} finally {
    $telegram = $null
    Reset-CasPopup
    if ($tickClient) { $tickClient.Dispose() }
    if ($client) { $client.Dispose() }
    if ($listener) { $listener.Close() }
    if ($runtimeLock) { $runtimeLock.Dispose() }
    if ($script:updateProcess) { $script:updateProcess.Dispose() }
    foreach ($job in $pending) { $job.message.Dispose() }
}
