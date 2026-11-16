$ErrorActionPreference='Stop'
$source=Join-Path (Get-Location) 'v0239/Update-Manager.ps1'
$ast=[Management.Automation.Language.Parser]::ParseFile($source,[ref]$null,[ref]$null)
$functions=$ast.FindAll({param($node)$node -is [Management.Automation.Language.FunctionDefinitionAst]},$false)
foreach($function in $functions){. ([scriptblock]::Create($function.Extent.Text))}
$testRoot=Join-Path ([IO.Path]::GetTempPath()) ('cas-update-test-'+[Guid]::NewGuid().ToString('N'))
$updates=Join-Path $testRoot 'Updates';$InstallRoot=Join-Path $testRoot 'Install';$utf8=New-Object Text.UTF8Encoding($false,$true)
[void][IO.Directory]::CreateDirectory($updates);[void][IO.Directory]::CreateDirectory($InstallRoot)
$allowedFiles=@('Start-One-Click.cmd','Start-Market-Watch.cmd','Start-Server.ps1','Update-Manager.ps1','app.html','README.txt')
$statePath=Join-Path $updates 'state.json';$journalPath=Join-Path $InstallRoot 'update-journal.json';$pendingPath=Join-Path $updates 'pending.json'
$script:count=0
function Assert-Check($condition,$name){if(!$condition){throw ('FAILED '+$name)};$script:count++;Write-Output ('PASS '+$name)}
function New-TestZip([string]$suffix='', [string]$extra='', [switch]$Missing,[switch]$Duplicate,[switch]$WrongFile,[switch]$Oversize,[switch]$Symlink){
 $version='0.2.40';$package='Market_Watch_Assistant_Windows_v'+$version+'.zip';$file=Join-Path $testRoot ($suffix+$package)
 if([IO.File]::Exists($file)){[IO.File]::Delete($file)}
 $hashes=@{};$zip=[IO.Compression.ZipFile]::Open($file,[IO.Compression.ZipArchiveMode]::Create)
 try{
  foreach($name in $allowedFiles){
   $content='new-'+$name
   if($name -ceq 'Update-Manager.ps1'){$content=$script:newManager}
   $bytes=$utf8.GetBytes($content);$sha=[Security.Cryptography.SHA256]::Create()
   try{$hashes[$name]=[BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
   if($Missing -and $name -ceq 'README.txt'){continue}
   $entry=$zip.CreateEntry(('Market_Watch_Assistant_Windows_v'+$version+'/'+$name));$stream=$entry.Open()
   try{
    if($WrongFile -and $name -ceq 'app.html'){$stream.WriteByte(70)}elseif($Oversize -and $name -ceq 'app.html'){$large=New-Object byte[] 8388609;$stream.Write($large,0,$large.Length)}else{$stream.Write($bytes,0,$bytes.Length)}
   }finally{$stream.Dispose()}
   if($Symlink -and $name -ceq 'app.html'){$entry.ExternalAttributes=[int]-1610612736}
  }
  if($extra){$entry=$zip.CreateEntry($extra);$stream=$entry.Open();$stream.WriteByte(70);$stream.Dispose()}
  if($Duplicate){$entry=$zip.CreateEntry('Market_Watch_Assistant_Windows_v0.2.40/app.html');$stream=$entry.Open();$stream.WriteByte(70);$stream.Dispose()}
 }finally{$zip.Dispose()}
 return @{file=$file;manifest=[pscustomobject]@{product='Market_Watch_Assistant_Windows';schemaVersion=1;version=$version;package=$package;sha256=(File-UpdateHash $file);files=[pscustomobject]$hashes}}
}
function Assert-Rejected($entry,[string]$name){$bad=$false;try{$stage=Expand-VerifiedUpdate $entry.file $entry.manifest;Remove-Item -LiteralPath $stage -Recurse -Force}catch{$bad=$true};Assert-Check $bad $name}
try{
 Add-Type -AssemblyName System.IO.Compression.FileSystem
 # The only test substitution isolates the shared data root; update logic is unchanged.
 $original=[IO.File]::ReadAllText($source)
 $assignment=$ast.FindAll({param($n)$n -is [Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -ceq '$dataRoot'},$false)[0].Extent.Text
 $testDataRoot=($testRoot.Replace("'","''"))
 $oldManager=$original.Replace($assignment,('$dataRoot='''+$testDataRoot+''''))
 $script:newManager=$oldManager.Replace("`$currentVersion='0.2.39'","`$currentVersion='0.2.40'")
 $entry=New-TestZip
 Test-UpdateManifest $entry.manifest '0.2.40'
 $stage=Expand-VerifiedUpdate $entry.file $entry.manifest
 Assert-Check ([IO.File]::ReadAllText((Join-Path $stage 'app.html')) -ceq 'new-app.html') 'valid ZIP is extracted only after package and per-file hash verification'
 Remove-Item -LiteralPath $stage -Recurse -Force
 $entry.manifest.sha256='0'*64
 Assert-Rejected $entry 'tampered ZIP hash is rejected'
 Assert-Rejected (New-TestZip -suffix 'missing-' -Missing) 'missing required file is rejected'
 Assert-Rejected (New-TestZip -suffix 'duplicate-' -Duplicate) 'duplicate file name is rejected'
 Assert-Rejected (New-TestZip -suffix 'traverse-' -extra '../escape.txt') 'path traversal is rejected before extraction'
 Assert-Rejected (New-TestZip -suffix 'personal-' -extra 'Market_Watch_Assistant_Windows_v0.2.40/AI-Analysis/private.txt') 'unexpected personal-data files cannot enter an update package'
 Assert-Rejected (New-TestZip -suffix 'wrong-' -WrongFile) 'per-file hash mismatch is rejected even with a matching ZIP hash'
 Assert-Rejected (New-TestZip -suffix 'huge-' -Oversize) 'oversized decompressed entries are rejected'
 Assert-Rejected (New-TestZip -suffix 'link-' -Symlink) 'symbolic links are rejected'
 $bad=New-TestZip -suffix 'badmanifest-';$bad.manifest.product='OtherProduct';$thrown=$false;try{Test-UpdateManifest $bad.manifest '0.2.40'}catch{$thrown=$true}
 Assert-Check $thrown 'manifest for another product is rejected'
 foreach($name in $allowedFiles){[IO.File]::WriteAllText((Join-Path $InstallRoot $name),('old-'+$name),$utf8)}
 [IO.File]::WriteAllText((Join-Path $InstallRoot 'Update-Manager.ps1'),$oldManager,$utf8)
 $entry=New-TestZip;[IO.File]::Copy($entry.file,(Join-Path $updates $entry.manifest.package),$true)
 Write-UpdateJson $statePath @{status='downloaded';message='fixture'}
 Write-UpdateJson $pendingPath @{manifest=$entry.manifest;installRoot=[IO.Path]::GetFullPath($InstallRoot)}
 $private=Join-Path $testRoot 'Settings';[void][IO.Directory]::CreateDirectory($private);[IO.File]::WriteAllText((Join-Path $private 'current.json'),'private-settings',$utf8)
 $runtime=[IO.File]::Open((Join-Path $InstallRoot 'runtime.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
 try{& (Join-Path $PSHOME 'pwsh') -NoLogo -NoProfile -File (Join-Path $InstallRoot 'Update-Manager.ps1') -Action ApplyPending -InstallRoot $InstallRoot|Out-Null}finally{$runtime.Dispose()}
 Assert-Check (([IO.File]::ReadAllText((Join-Path $InstallRoot 'app.html'))) -ceq 'old-app.html' -and [IO.File]::Exists($pendingPath)) 'running application lock prevents replacement'
 & (Join-Path $PSHOME 'pwsh') -NoLogo -NoProfile -File (Join-Path $InstallRoot 'Update-Manager.ps1') -Action ApplyPending -InstallRoot $InstallRoot|Out-Null
 Assert-Check (([IO.File]::ReadAllText((Join-Path $InstallRoot 'app.html'))) -ceq 'new-app.html' -and [IO.File]::Exists($journalPath) -and ![IO.File]::Exists($pendingPath)) 'pending update installs, archives previous program and leaves an unconfirmed-boot journal'
 Assert-Check (([IO.File]::ReadAllText((Join-Path $private 'current.json'))) -ceq 'private-settings') 'updating program files leaves user settings untouched'
 & (Join-Path $PSHOME 'pwsh') -NoLogo -NoProfile -File (Join-Path $InstallRoot 'Update-Manager.ps1') -Action ApplyPending -InstallRoot $InstallRoot|Out-Null
 Assert-Check (([IO.File]::ReadAllText((Join-Path $InstallRoot 'app.html'))) -ceq 'old-app.html' -and ![IO.File]::Exists($journalPath)) 'next launch rolls back a version that never completed startup'
 Assert-Check ((Read-UpdateJson $statePath).failedVersion -ceq '0.2.40') 'failed version is recorded to stop automatic retry loops'
 Write-UpdateJson $pendingPath @{manifest=$entry.manifest;installRoot=[IO.Path]::GetFullPath($InstallRoot)}
 & (Join-Path $PSHOME 'pwsh') -NoLogo -NoProfile -File (Join-Path $InstallRoot 'Update-Manager.ps1') -Action ApplyPending -InstallRoot $InstallRoot|Out-Null
 & (Join-Path $PSHOME 'pwsh') -NoLogo -NoProfile -File (Join-Path $InstallRoot 'Update-Manager.ps1') -Action MarkReady -InstallRoot $InstallRoot|Out-Null
 & (Join-Path $PSHOME 'pwsh') -NoLogo -NoProfile -File (Join-Path $InstallRoot 'Update-Manager.ps1') -Action ApplyPending -InstallRoot $InstallRoot|Out-Null
 Assert-Check (([IO.File]::ReadAllText((Join-Path $InstallRoot 'app.html'))) -ceq 'new-app.html' -and ![IO.File]::Exists($journalPath)) 'successful startup confirmation keeps the updated version'
 Write-Output ('Updater checks passed '+$count)
}finally{if(Test-Path -LiteralPath $testRoot){Remove-Item -LiteralPath $testRoot -Recurse -Force}}
