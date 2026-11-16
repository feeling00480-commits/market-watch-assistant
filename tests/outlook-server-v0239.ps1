$ErrorActionPreference='Stop'
$source=Join-Path (Get-Location) 'v0239/Start-Server.ps1'
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$errors)
if($errors.Count){throw ($errors|Out-String)}
$f=$ast.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'Get-CasMarketUri'},$false)[0]
. ([scriptblock]::Create($f.Extent.Text))
$routes=@{chart2=@('https://query2.finance.yahoo.com/v8/finance/chart/','chart')}
$now=[DateTimeOffset]::UtcNow.ToUnixTimeSeconds();$from=$now-30L*365L*86400L
$ok=Get-CasMarketUri "chart2/2884.TW?period1=$from&period2=$now&interval=1d"
if($ok -cne "https://query2.finance.yahoo.com/v8/finance/chart/2884.TW?period1=$from&period2=$now&interval=1d"){throw 'Bounded daily request rejected'}
Write-Output 'PASS bounded 30-year daily history uses fixed Yahoo host'
$bad=@(
 "chart2/2884.TW?period1=$from&period2=$now&interval=1m",
 "chart2/2884.TW?period1=$from&period2=$now&interval=1d&callback=evil",
 "chart2/https%3A%2F%2Fevil.com?period1=$from&period2=$now&interval=1d",
 "chart2/2884.TW?period1=0&period2=$now&interval=1d",
 "chart2/2884.TW?period1=$now&period2=$from&interval=1d",
 "chart2/2884.TW?period1=$from&period2=$($now+90000)&interval=1d"
)
foreach($path in $bad){if(Get-CasMarketUri $path){throw ('Unsafe request accepted '+$path)}}
Write-Output 'PASS rejects unbounded, reversed, future, injected and wrong-period requests'
if(!(Get-CasMarketUri 'chart2/2330.TW?range=1d&interval=5m')){throw 'Original quote route broken'}
Write-Output 'PASS existing intraday request remains permitted'
