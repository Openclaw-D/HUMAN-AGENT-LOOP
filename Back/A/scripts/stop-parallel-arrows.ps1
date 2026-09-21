$ErrorActionPreference='Stop'
$repoRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$reportDir=Join-Path $repoRoot 'docs/v0.4/results/parallel-arrows-back'
$owner=Get-Content -LiteralPath (Join-Path $reportDir 'OWNERSHIP.json') -Raw | ConvertFrom-Json
if($owner.owner -ne 'parallel-arrows-back'){throw 'Runtime ownership mismatch'}
$process=Get-CimInstance Win32_Process -Filter "ProcessId=$($owner.pid)"
if($process){
  if($process.CommandLine -notlike '*parallel-arrows-runtime.mjs*'){throw 'PID reused by another process; refusing stop'}
  # No credentials or service configuration are changed. Interrupted jobs recover as unknown, never auto-resend.
  Stop-Process -Id $owner.pid
}
$container=(docker inspect $owner.container | ConvertFrom-Json)[0]
if($container.Id -ne $owner.containerId -or $container.Config.Labels.'jw.owner' -ne 'parallel-arrows-back'){throw 'Database ownership mismatch'}
docker stop $owner.container
Write-Output 'Owned runtime stopped; database and fixtures retained.'
