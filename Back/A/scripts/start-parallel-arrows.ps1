param([int]$Port = 0, [ValidatePattern('^([a-zA-Z0-9-]+)?$')][string]$SeedSuffix = '')
$ErrorActionPreference='Stop'
$repoRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$reportDir=Join-Path $repoRoot 'docs/v0.4/results/parallel-arrows-back'
New-Item -ItemType Directory -Force -Path $reportDir | Out-Null
if(-not $SeedSuffix){
  $lastOwnership=Join-Path $reportDir 'OWNERSHIP.json'
  if(Test-Path -LiteralPath $lastOwnership){$SeedSuffix=(Get-Content -LiteralPath $lastOwnership -Raw | ConvertFrom-Json).seedSuffix}
  if(-not $SeedSuffix){$SeedSuffix='v1'}
}
$containerName='jw-parallel-arrows-back'
$containerId=docker ps -aq --filter "name=^/$containerName`$"
if($containerId){
  $containerInfo=(docker inspect $containerName | ConvertFrom-Json)[0]
  if($containerInfo.Config.Labels.'jw.owner' -ne 'parallel-arrows-back'){throw 'Container ownership mismatch'}
  if(-not $containerInfo.State.Running){docker start $containerName | Out-Null}
}else{
  docker run --detach --name $containerName --label jw.owner=parallel-arrows-back --publish 127.0.0.1::5432 --env POSTGRES_USER=arrow_test --env POSTGRES_PASSWORD=arrow_test_only --env POSTGRES_DB=arrow_test postgres:16-alpine | Out-Null
  if($LASTEXITCODE -ne 0){throw 'Dedicated database startup failed'}
}
$containerInfo=(docker inspect $containerName | ConvertFrom-Json)[0]
$dbPort=$containerInfo.NetworkSettings.Ports.'5432/tcp'[0].HostPort
$dbUrl="postgres://arrow_test:arrow_test_only@127.0.0.1:$dbPort/arrow_test"
for($try=0;$try -lt 30;$try++){
  docker exec $containerName pg_isready -U arrow_test -d arrow_test 2>$null | Out-Null
  if($LASTEXITCODE -eq 0){break}
  Start-Sleep -Milliseconds 300
}
if($LASTEXITCODE -ne 0){throw 'Dedicated database not ready'}
$runtimeFile=Join-Path $reportDir 'RUNTIME.json'
if(Test-Path -LiteralPath $runtimeFile){
  $previous=Get-Content -LiteralPath $runtimeFile -Raw | ConvertFrom-Json
  $existing=Get-CimInstance Win32_Process -Filter "ProcessId=$($previous.pid)"
  if($existing -and $existing.CommandLine -like '*parallel-arrows-runtime.mjs*'){throw "Owned runtime already active: $($previous.baseUrl)"}
}
$nodePath=(Get-Command node).Source
$runtimeScript=Join-Path $PSScriptRoot 'parallel-arrows-runtime.mjs'
$argsList=@(('"'+$runtimeScript+'"'),'--db',$dbUrl,'--port',"$Port",'--seed-suffix',$SeedSuffix)
$process=Start-Process -FilePath $nodePath -ArgumentList $argsList -WorkingDirectory $repoRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $reportDir 'runtime.stdout.log') -RedirectStandardError (Join-Path $reportDir 'runtime.stderr.log')
[pscustomobject]@{owner='parallel-arrows-back';pid=$process.Id;container=$containerName;containerId=$containerInfo.Id;dbPort=$dbPort;seedSuffix=$SeedSuffix;runtimeFile=$runtimeFile} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $reportDir 'OWNERSHIP.json')
Write-Output "Started owned runtime PID $($process.Id); see $runtimeFile"
