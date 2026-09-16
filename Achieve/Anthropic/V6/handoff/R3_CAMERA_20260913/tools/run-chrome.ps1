# R3 Chrome headless driver (called by tools/headless-shots.mjs). ASCII only.
param(
  [Parameter(Mandatory=$true)][string]$Chrome,
  [Parameter(Mandatory=$true)][string]$ProfileDir,
  [Parameter(Mandatory=$true)][string]$WindowSize,
  [Parameter(Mandatory=$true)][string]$Scale,
  [Parameter(Mandatory=$true)][string]$Url,
  [string]$Screenshot = '',
  [string]$DumpOut = '',
  [int]$Budget = 12000
)
New-Item -ItemType Directory -Force -Path $ProfileDir | Out-Null
$cargs = @(
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--hide-scrollbars',
  ('--user-data-dir=' + $ProfileDir),
  ('--window-size=' + $WindowSize),
  ('--force-device-scale-factor=' + $Scale),
  ('--virtual-time-budget=' + $Budget)
)
if ($Screenshot) { $cargs += ('--screenshot=' + $Screenshot) }
if ($DumpOut) { $cargs += '--dump-dom' }
$cargs += $Url
$errFile = Join-Path $ProfileDir 'chrome-stderr.log'
$outFile = Join-Path $ProfileDir 'chrome-stdout.log'
$p = Start-Process -FilePath $Chrome -ArgumentList $cargs -Wait -PassThru -RedirectStandardError $errFile -RedirectStandardOutput $outFile
if ($DumpOut) { Copy-Item $outFile $DumpOut -Force }
Write-Host ("exit=" + $p.ExitCode)
