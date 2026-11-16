$ErrorActionPreference='Stop'
$source=Join-Path (Get-Location) 'v0241/Start-Server.ps1'
$ast=[Management.Automation.Language.Parser]::ParseFile($source,[ref]$null,[ref]$null)
$functions=$ast.FindAll({param($node)$node -is [Management.Automation.Language.FunctionDefinitionAst]},$false)
foreach($function in $functions){. ([scriptblock]::Create($function.Extent.Text))}
$testRoot=Join-Path ([IO.Path]::GetTempPath()) ('cas-settings-test-'+[Guid]::NewGuid().ToString('N'))
$settingsRoot=$testRoot;$settingsCurrent=Join-Path $testRoot 'current.json';$settingsBackupRoot=Join-Path $testRoot 'Backups'
$settingsBackupPattern='^\d{8}T\d{9}Z_[0-9a-f]{8}\.json$';$utf8=New-Object Text.UTF8Encoding($false,$true)
$script:reply=$null
function Send-CasResponse($response,[int]$status,[string]$type='text/plain',[byte[]]$bytes=@()){
 $script:reply=@{status=$status;body=if($bytes.Length){$utf8.GetString($bytes)}else{''}}
}
$script:count=0
function Assert-Check($condition,$name){if(!$condition){throw ('FAILED '+$name)};$script:count++;Write-Output ('PASS '+$name)}
function Pack-ForTest([double]$cost=206.5){
 $json=@{format='market-watch-settings';schemaVersion=1;appVersion='0.2.41';savedAt=[DateTime]::UtcNow.ToString('o');data=@{
 watch=@(@{id='3227';name='原相';market='櫃買中心 · 上櫃';type='個股';exchange='otc'});rules=@{'3227'=@{cost=$cost;target=250;stop=180;lots=3;targetNear=1;enabled=$true}};updatedAt=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();backup=@{enabled=$true;minutes=5};update=@{enabled=$true;autoDownload=$true}}}|ConvertTo-Json -Depth 12
 return ConvertFrom-Json -InputObject $json
}
try{
 $pack=Pack-ForTest
 Assert-Check (Test-CasSettingsPack $pack) 'actual PowerShell accepts supported settings pack'
 Save-CasSettings $null ([pscustomobject]@{pack=$pack;baseRevision='';snapshot=$true})
 Assert-Check ($reply.status -eq 200 -and [IO.File]::Exists($settingsCurrent)) 'first settings save creates the shared current file'
 $saved=Read-CasCurrentSettings
 Assert-Check ($saved.pack.data.rules.'3227'.cost -eq 206.5 -and $saved.revision.Length -eq 64) 'disk reload preserves costs and supplies a content revision'
 $pack2=Pack-ForTest 188
 Save-CasSettings $null ([pscustomobject]@{pack=$pack2;baseRevision='';snapshot=$false})
 Assert-Check ($reply.status -eq 409 -and (Read-CasCurrentSettings).pack.data.rules.'3227'.cost -eq 206.5) 'stale revision cannot overwrite a newer shared file'
 Save-CasSettings $null ([pscustomobject]@{pack=$pack2;baseRevision=$saved.revision;snapshot=$false})
 Assert-Check ($reply.status -eq 200 -and (Read-CasCurrentSettings).pack.data.rules.'3227'.cost -eq 188) 'correct revision atomically replaces current and archives previous settings'
 [IO.File]::WriteAllText($settingsCurrent,'corrupt',$utf8)
 $fallback=Read-CasCurrentSettings
 Assert-Check ($fallback.source -ceq 'backup' -and $fallback.pack.data.rules.'3227'.cost -eq 206.5) 'corrupt current file falls back to a valid previous backup'
 Save-CasSettings $null ([pscustomobject]@{pack=$pack2;baseRevision=$fallback.revision;snapshot=$false})
 Assert-Check ($reply.status -eq 200 -and (Read-CasCurrentSettings).pack.data.rules.'3227'.cost -eq 188) 'valid backup can repair a corrupt current file without losing the prior file'
 $secret=Pack-ForTest;$secret.data|Add-Member NoteProperty token 'do-not-store'
 Assert-Check (!(Test-CasSettingsPack $secret)) 'server rejects unexpected sensitive fields'
 $secret=Pack-ForTest;$secret.data.rules.'3227'|Add-Member NoteProperty apiKey 'do-not-store'
 Assert-Check (!(Test-CasSettingsPack $secret)) 'server rejects credentials hidden in stock rules'
 $bad=Pack-ForTest;$bad.data.rules.'3227'.cost=-1
 Assert-Check (!(Test-CasSettingsPack $bad)) 'server rejects negative position values'
 $empty=Pack-ForTest;$empty.data.watch=@();$empty.data.rules=[pscustomobject]@{}
 Assert-Check (Test-CasSettingsPack $empty) 'server preserves intentionally empty watchlists'
 for($i=0;$i -lt 34;$i++){
  $previous=Read-CasCurrentSettings
  Save-CasSettings $null ([pscustomobject]@{pack=(Pack-ForTest ($i+1));baseRevision=$previous.revision;snapshot=$true})
  if($reply.status -ne 200){throw ('Save failed at '+$i)}
 }
 Assert-Check (@(Get-ChildItem -LiteralPath $settingsBackupRoot -File).Count -eq 30) 'history retention is capped at thirty snapshots'
 $newer=Pack-ForTest;$newer.schemaVersion=2
 [IO.File]::WriteAllText($settingsCurrent,($newer|ConvertTo-Json -Depth 16),$utf8)
 $thrown=$false;try{Read-CasCurrentSettings|Out-Null}catch{$thrown=$true}
 Assert-Check $thrown 'newer schema blocks fallback writes instead of downgrading settings'
 Write-Output ('Server settings checks passed '+$count)
}finally{if(Test-Path -LiteralPath $testRoot){Remove-Item -LiteralPath $testRoot -Recurse -Force}}
