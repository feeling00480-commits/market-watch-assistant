[CmdletBinding()]
param([ValidateSet('Check','Download','ApplyPending','MarkReady')][string]$Action='Check',[string]$InstallRoot=$PSScriptRoot,[switch]$AutoDownload)
$ErrorActionPreference='Stop'
$repository='feeling00480-commits/market-watch-assistant'
$currentVersion='0.2.41'
$base=[Environment]::GetFolderPath('LocalApplicationData')
$dataRoot=if($base){Join-Path $base 'MarketWatchAssistant\UserData'}else{Join-Path $InstallRoot 'UserData'}
$updates=Join-Path $dataRoot 'Updates'
$utf8=New-Object System.Text.UTF8Encoding($false,$true)
$allowedFiles=@('Start-One-Click.cmd','Start-Market-Watch.cmd','Start-Server.ps1','Update-Manager.ps1','app.html','README.txt')
$statePath=Join-Path $updates 'state.json'
$pendingPath=Join-Path $updates 'pending.json'
$journalPath=Join-Path $InstallRoot 'update-journal.json'
$lock=$null;$http=$null
function Write-UpdateJson([string]$path,$value){
 $temporary=$path+'.'+[Guid]::NewGuid().ToString('N')+'.tmp'
 try{
  [IO.File]::WriteAllText($temporary,(ConvertTo-Json -InputObject $value -Depth 20 -Compress),$utf8)
  if([IO.File]::Exists($path)){[IO.File]::Replace($temporary,$path,[System.Management.Automation.Language.NullString]::Value)}else{[IO.File]::Move($temporary,$path)}
 }finally{if([IO.File]::Exists($temporary)){[IO.File]::Delete($temporary)}}
}
function Read-UpdateJson([string]$path){if([IO.File]::Exists($path)){return ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($path,$utf8))};return $null}
function File-UpdateHash([string]$path){return (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()}
function Read-UpdateBytes([string]$url,[int]$limit){
 $uri=[Uri]$url
 for($redirect=0;$redirect -lt 6;$redirect++){
  if($uri.Scheme -cne 'https' -or $uri.UserInfo -or $uri.Port -ne 443 -or $uri.Host -cnotin @('api.github.com','github.com','release-assets.githubusercontent.com','objects.githubusercontent.com','github-releases.githubusercontent.com')){throw '更新連結不在允許的 GitHub 來源。'}
  $response=$http.GetAsync($uri,[Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
  try{
   $code=[int]$response.StatusCode
   if($code -in 301,302,303,307,308){$uri=[Uri]::new($uri,$response.Headers.Location);continue}
   if($code -eq 404){throw '尚未找到公開正式版本，請先建立 GitHub 發版區。'}
   if($code -eq 403 -or $code -eq 429){throw 'GitHub 暫時限制請求，稍後會再檢查。'}
   if($code -ne 200){throw ('更新來源回應 HTTP '+$code)}
   if($response.Content.Headers.ContentLength -and $response.Content.Headers.ContentLength -gt $limit){throw '更新資料超過允許大小。'}
   $stream=$response.Content.ReadAsStreamAsync().GetAwaiter().GetResult();$memory=[IO.MemoryStream]::new()
   try{
    $buffer=New-Object byte[] 65536
    while(($read=$stream.Read($buffer,0,$buffer.Length)) -gt 0){if($memory.Length+$read -gt $limit){throw '更新資料超過允許大小。'};$memory.Write($buffer,0,$read)}
    return ,$memory.ToArray()
   }finally{$stream.Dispose();$memory.Dispose()}
  }finally{$response.Dispose()}
 }
 throw '更新連結重新導向次數過多。'
}
function Test-UpdateManifest($manifest,[string]$version){
 if($manifest.product -cne 'Market_Watch_Assistant_Windows' -or $manifest.schemaVersion -ne 1 -or $manifest.version -cne $version -or $version -cnotmatch '^\d{1,3}\.\d{1,3}\.\d{1,5}$' -or $manifest.package -cne ('Market_Watch_Assistant_Windows_v'+$version+'.zip') -or $manifest.sha256 -cnotmatch '^[0-9a-f]{64}$'){throw '更新資訊格式不正確。'}
 $names=@($manifest.files.PSObject.Properties.Name)
 if($names.Count -ne $allowedFiles.Count){throw '更新檔案清單不完整。'}
 foreach($name in $allowedFiles){if($name -cnotin $names -or $manifest.files.$name -cnotmatch '^[0-9a-f]{64}$'){throw '更新檔案驗證資訊不完整。'}}
}
function Expand-VerifiedUpdate([string]$zip,$manifest){
 if((File-UpdateHash $zip) -cne $manifest.sha256){throw '更新 ZIP 的 SHA-256 不符。'}
 Add-Type -AssemblyName System.IO.Compression.FileSystem
 $archive=[IO.Compression.ZipFile]::OpenRead($zip)
 $staging=Join-Path $updates ('stage-'+[Guid]::NewGuid().ToString('N'))
 [void][IO.Directory]::CreateDirectory($staging)
 try{
  $seen=@{};$total=0
  foreach($entry in $archive.Entries){
   $path=$entry.FullName.Replace('\','/')
   $parts=$path.Split('/')
   if($parts.Count -ne 2 -or $parts[0] -cne ('Market_Watch_Assistant_Windows_v'+$manifest.version) -or $parts[1] -cnotin $allowedFiles -or $seen.ContainsKey($parts[1]) -or $entry.Length -gt 8388608 -or (($entry.ExternalAttributes -shr 16) -band 61440) -eq 40960){throw '更新 ZIP 包含不允許的檔案或路徑。'}
   $total+=$entry.Length;if($total -gt 16777216){throw '更新解壓大小超過上限。'}
   $name=$parts[1];$seen[$name]=$true
   $target=Join-Path $staging $name
   [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$target,$false)
   if((File-UpdateHash $target) -cne $manifest.files.$name){throw ('檔案驗證失敗 '+$name)}
  }
  if($seen.Count -ne $allowedFiles.Count){throw '更新 ZIP 檔案不足。'}
  return $staging
 }catch{Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue;throw}
 finally{$archive.Dispose()}
}
function Restore-PreviousUpdate($journal){
 foreach($name in $allowedFiles){
  $source=Join-Path (Join-Path $InstallRoot 'Previous-Version') $name
  if(!(Test-Path -LiteralPath $source -PathType Leaf) -or (File-UpdateHash $source) -cne $journal.previousFiles.$name){throw '前一版備份驗證失敗，已停止還原。'}
 }
 foreach($name in $allowedFiles){[IO.File]::Copy((Join-Path (Join-Path $InstallRoot 'Previous-Version') $name),(Join-Path $InstallRoot $name),$true)}
 [IO.File]::Delete($journalPath)
 $status=Read-UpdateJson $statePath;if(!$status){$status=[pscustomobject]@{}}
 $status|Add-Member -Force NoteProperty status 'rolled-back'
 $status|Add-Member -Force NoteProperty message '前次更新未完成啟動，已退回前一版。'
 $status|Add-Member -Force NoteProperty failedVersion $journal.version
 Write-UpdateJson $statePath $status
}
try{
 [void][IO.Directory]::CreateDirectory($updates)
 if($Action -ceq 'MarkReady'){
  if([IO.File]::Exists($journalPath)){[IO.File]::Delete($journalPath)}
  exit 0
 }
 $lock=[IO.File]::Open((Join-Path $updates 'operation.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
 if($Action -ceq 'ApplyPending'){
  # The server holds this lock for its entire lifetime; a running instance is never replaced.
  $runtime=Join-Path $InstallRoot 'runtime.lock';$runtimeLock=$null
  try{$runtimeLock=[IO.File]::Open($runtime,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)}catch{Write-Host '程式仍在執行，這次不套用更新。';exit 0}
  try{
   $journal=Read-UpdateJson $journalPath
   if($journal){Restore-PreviousUpdate $journal;exit 0}
   $pending=Read-UpdateJson $pendingPath
   if(!$pending -or $pending.installRoot -cne [IO.Path]::GetFullPath($InstallRoot)){exit 0}
   Test-UpdateManifest $pending.manifest $pending.manifest.version
   if([version]$pending.manifest.version -le [version]$currentVersion){[IO.File]::Delete($pendingPath);exit 0}
   $zip=Join-Path $updates $pending.manifest.package
   $stage=Expand-VerifiedUpdate $zip $pending.manifest
   try{
    $previous=Join-Path $InstallRoot 'Previous-Version';[void][IO.Directory]::CreateDirectory($previous)
    $hashes=@{}
    foreach($name in $allowedFiles){
     $path=Join-Path $InstallRoot $name
     [IO.File]::Copy($path,(Join-Path $previous $name),$true);$hashes[$name]=File-UpdateHash $path
    }
    $journal=@{version=$pending.manifest.version;previousFiles=$hashes}
    Write-UpdateJson $journalPath $journal
    try{foreach($name in $allowedFiles){[IO.File]::Copy((Join-Path $stage $name),(Join-Path $InstallRoot $name),$true)}}catch{Restore-PreviousUpdate ([pscustomobject]$journal);throw}
    [IO.File]::Delete($pendingPath)
    $status=Read-UpdateJson $statePath;$status|Add-Member -Force NoteProperty status 'installed';$status|Add-Member -Force NoteProperty message ('已套用 v'+$pending.manifest.version+'，正在確認啟動。');Write-UpdateJson $statePath $status
    Write-Host ('已套用 v'+$pending.manifest.version)
   }finally{Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue}
  }finally{if($runtimeLock){$runtimeLock.Dispose()}}
  exit 0
 }
 $old=Read-UpdateJson $statePath
 $state=@{currentVersion=$currentVersion;status='checking';message='正在檢查 GitHub 更新';lastAttempt=[DateTime]::UtcNow.ToString('o')}
 if($old.lastChecked){$state.lastChecked=$old.lastChecked}
 if($old.failedVersion){$state.failedVersion=$old.failedVersion}
 Write-UpdateJson $statePath $state
 Add-Type -AssemblyName System.Net.Http
 [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
 $handler=[Net.Http.HttpClientHandler]::new();$handler.AllowAutoRedirect=$false;$handler.UseCookies=$false
 $http=[Net.Http.HttpClient]::new($handler);$http.Timeout=[TimeSpan]::FromSeconds(45);$http.DefaultRequestHeaders.UserAgent.ParseAdd('Market-Watch-Assistant/'+$currentVersion)
 $release=ConvertFrom-Json -InputObject ($utf8.GetString((Read-UpdateBytes ('https://api.github.com/repos/'+$repository+'/releases/latest') 1048576)))
 $version=([string]$release.tag_name).TrimStart('v')
 if($release.draft -eq $true -or $release.prerelease -eq $true -or $release.tag_name -cne ('v'+$version) -or $version -cnotmatch '^\d{1,3}\.\d{1,3}\.\d{1,5}$'){throw '發版區沒有可辨識的正式版本。'}
 $state.lastChecked=[DateTime]::UtcNow.ToString('o')
 if([version]$version -le [version]$currentVersion){$state.status='current';$state.message='目前已是最新版本';Write-UpdateJson $statePath $state;exit 0}
 $state.availableVersion=$version
 if($state.failedVersion -ceq $version -and $Action -cne 'Download'){$state.status='failed-version';$state.message='此版本曾啟動失敗，已停止自動重試。可手動下載再試。';Write-UpdateJson $statePath $state;exit 0}
 $prefix='https://github.com/'+$repository+'/releases/download/'+$release.tag_name+'/'
 $manifestAsset=@($release.assets|Where-Object{$_.name -ceq 'update.json'})
 if($manifestAsset.Count -ne 1 -or $manifestAsset[0].browser_download_url -cne ($prefix+'update.json')){throw '找不到這一版的更新資訊。'}
 $manifest=ConvertFrom-Json -InputObject ($utf8.GetString((Read-UpdateBytes $manifestAsset[0].browser_download_url 64000)))
 Test-UpdateManifest $manifest $version
 $asset=@($release.assets|Where-Object{$_.name -ceq $manifest.package})
 if($asset.Count -ne 1 -or $asset[0].browser_download_url -cne ($prefix+$manifest.package) -or $asset[0].size -gt 16777216){throw '找不到這一版的程式 ZIP。'}
 if($asset[0].digest -and $asset[0].digest -cne ('sha256:'+$manifest.sha256)){throw 'GitHub 與更新資訊的雜湊不一致。'}
 $state.status='available';$state.message='發現新版，可下載備用';Write-UpdateJson $statePath $state
 if($Action -ceq 'Download' -or $AutoDownload){
  $state.status='downloading';$state.message='正在下載並驗證新版';Write-UpdateJson $statePath $state
  $zip=Join-Path $updates $manifest.package
  $bytes=Read-UpdateBytes $asset[0].browser_download_url 16777216
  $temporary=$zip+'.part';[IO.File]::WriteAllBytes($temporary,$bytes)
  try{
   $stage=Expand-VerifiedUpdate $temporary $manifest
   Remove-Item -LiteralPath $stage -Recurse -Force
   if([IO.File]::Exists($zip)){[IO.File]::Replace($temporary,$zip,[System.Management.Automation.Language.NullString]::Value)}else{[IO.File]::Move($temporary,$zip)}
  }finally{if([IO.File]::Exists($temporary)){[IO.File]::Delete($temporary)}}
  Write-UpdateJson $pendingPath @{manifest=$manifest;installRoot=[IO.Path]::GetFullPath($InstallRoot)}
  $state.status='downloaded';$state.message='新版已下載並驗證，下次啟動自動套用';Write-UpdateJson $statePath $state
 }
}catch{
 $text=$_.Exception.Message
 if($Action -cin 'Check','Download' -and $lock){
  try{if(!$state){$state=@{currentVersion=$currentVersion}};$state.status='error';$state.message=$text;$state.lastAttempt=[DateTime]::UtcNow.ToString('o');Write-UpdateJson $statePath $state}catch{}
 }else{Write-Host ('更新未套用，保留目前版本。'+$text)}
 if($Action -cne 'ApplyPending'){exit 1}
}finally{if($http){$http.Dispose()};if($lock){$lock.Dispose()}}
