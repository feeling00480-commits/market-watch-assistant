[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$Package,[switch]$Publish)
$ErrorActionPreference='Stop'
$repository='feeling00480-commits/market-watch-assistant'
$files=@('Start-One-Click.cmd','Start-Market-Watch.cmd','Start-Server.ps1','Update-Manager.ps1','app.html','README.txt')
$full=(Resolve-Path -LiteralPath $Package).Path
if([IO.Path]::GetFileName($full) -cnotmatch '^Market_Watch_Assistant_Windows_v(\d+\.\d+\.\d+)\.zip$'){throw '請選擇正式命名的 Windows ZIP。'}
$version=$Matches[1]
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive=[IO.Compression.ZipFile]::OpenRead($full)
$hashes=@{}
try{
 foreach($entry in $archive.Entries){
  $parts=$entry.FullName.Replace('\','/').Split('/')
  if($parts.Count -ne 2 -or $parts[0] -cne ('Market_Watch_Assistant_Windows_v'+$version) -or $parts[1] -cnotin $files -or $hashes.ContainsKey($parts[1])){throw 'ZIP 檔案內容不符，請勿發布含有個人資料的 ZIP。'}
  $stream=$entry.Open();$sha=[Security.Cryptography.SHA256]::Create()
  try{$hashes[$parts[1]]=[BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-','').ToLowerInvariant()}finally{$stream.Dispose();$sha.Dispose()}
 }
 if($hashes.Count -ne $files.Count){throw 'ZIP 缺少必要程式檔。'}
}finally{$archive.Dispose()}
$folder=Split-Path -Parent $full
$manifest=@{product='Market_Watch_Assistant_Windows';schemaVersion=1;version=$version;package=[IO.Path]::GetFileName($full);sha256=(Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash.ToLowerInvariant();files=$hashes}
$encoding=New-Object Text.UTF8Encoding($false)
[IO.File]::WriteAllText((Join-Path $folder 'update.json'),(ConvertTo-Json -InputObject $manifest -Depth 10),$encoding)
[IO.File]::WriteAllText((Join-Path $folder 'SHA256SUMS.txt'),($manifest.sha256+'  '+$manifest.package+[Environment]::NewLine),$encoding)
Write-Host ('已產生 v'+$version+' 更新資訊。')
if($Publish){
 if(!(Get-Command gh -ErrorAction SilentlyContinue)){throw '發版需 GitHub CLI，或改用網頁上傳 ZIP、update.json 與更新說明。'}
 & gh auth status;if($LASTEXITCODE -ne 0){throw '請先用 gh auth login 登入你自己的 GitHub 帳號。'}
 $notes=Join-Path $folder 'release-notes.md'
 if(!(Test-Path -LiteralPath $notes)){throw '請先在同一資料夾準備 release-notes.md。'}
 & gh release create ('v'+$version) $full (Join-Path $folder 'update.json') (Join-Path $folder 'SHA256SUMS.txt') --repo $repository --title ('看盤小助手 v'+$version) --notes-file $notes --latest
 if($LASTEXITCODE -ne 0){throw 'GitHub 發布未完成，請檢查上方訊息。'}
}else{Write-Host '將 ZIP、update.json、SHA256SUMS.txt 上傳到相同 GitHub Release，標籤使用 v版本號，發布為正式版。'}
