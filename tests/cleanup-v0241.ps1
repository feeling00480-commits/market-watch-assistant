$ErrorActionPreference='Stop'
$t=$null;$e=$null;$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path (Get-Location) 'v0241/Start-Server.ps1'),[ref]$t,[ref]$e)
if($e.Count){throw ($e|Out-String)}
$f=$ast.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Stop-CasUpdate'},$false)[0]
. ([scriptblock]::Create($f.Extent.Text))
$exe=Join-Path $PSHOME 'pwsh'
$a=Start-Process $exe -ArgumentList '-NoProfile','-Command','[Threading.Thread]::Sleep(30000)' -WorkingDirectory ([IO.Path]::GetTempPath()) -PassThru
$b=Start-Process $exe -ArgumentList '-NoProfile','-Command','[Threading.Thread]::Sleep(30000)' -WorkingDirectory ([IO.Path]::GetTempPath()) -PassThru
$idA=$a.Id
try{
 $script:updateProcess=$a;$script:updateJob=$null
 Stop-CasUpdate
 if(Get-Process -Id $idA -ErrorAction SilentlyContinue){throw 'Owned child still running'}
 if($b.HasExited){throw 'Unrelated sibling was killed'}
 if($script:updateProcess){throw 'Owned process handle retained'}
 Write-Output 'PASS exit cleanup ends owned child and leaves unrelated process running'
}finally{if(!$b.HasExited){$b.Kill();$b.WaitForExit()};$b.Dispose()}
