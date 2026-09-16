param(
    [ValidateSet('Start', 'Status', 'Stop')]
    [string]$Action = 'Status'
)

$ErrorActionPreference = 'Stop'

$taskName = 'CodexLocalhost-JianweiV3-Site'
$siteRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$workerPath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'run-localhost.ps1'))
$hiddenLauncherPath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'run-localhost-hidden.vbs'))
$runtimeRoot = Join-Path $env:LOCALAPPDATA 'CodexLocalServers\jianwei-v3-site'
$healthUrl = 'http://localhost:3000/'

function Get-LocalListener {
    Get-NetTCPConnection -State Listen -LocalPort 3000 -ErrorAction SilentlyContinue |
        Select-Object -First 1
}

function Test-LocalHealth {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $healthUrl -TimeoutSec 2
        return $response.StatusCode -eq 200
    }
    catch {
        return $false
    }
}

function Get-TaskOrNull {
    Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
}

function Show-Status {
    $task = Get-TaskOrNull
    $listener = Get-LocalListener
    $healthy = Test-LocalHealth

    [PSCustomObject]@{
        Task = if ($task) { $task.State } else { 'NotRegistered' }
        Healthy = $healthy
        Url = $healthUrl
        ListenerPid = if ($listener) { $listener.OwningProcess } else { $null }
        Logs = $runtimeRoot
    } | Format-List
}

if ($Action -eq 'Status') {
    Show-Status
    exit 0
}

if ($Action -eq 'Stop') {
    $task = Get-TaskOrNull
    if ($task -and $task.State -eq 'Running') {
        Stop-ScheduledTask -TaskName $taskName
    }

    $deadline = (Get-Date).AddSeconds(15)
    while ((Get-LocalListener) -and (Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 250
    }

    if (Get-LocalListener) {
        throw 'Port 3000 is still owned by another process. It was not force-terminated.'
    }

    Show-Status
    exit 0
}

$existingTask = Get-TaskOrNull
if ($existingTask -and $existingTask.State -eq 'Running' -and (Test-LocalHealth)) {
    Show-Status
    exit 0
}

$existingListener = Get-LocalListener
if ($existingListener) {
    throw "Port 3000 is already occupied by PID $($existingListener.OwningProcess). Refusing to replace or terminate it."
}

if (-not (Test-Path -LiteralPath (Join-Path $siteRoot 'node_modules') -PathType Container)) {
    throw 'node_modules is missing. Dependency installation requires a separate explicit authorization.'
}

$windowsPowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$windowsWscript = Join-Path $env:SystemRoot 'System32\wscript.exe'
$npmPath = (Get-Command npm.cmd -ErrorAction Stop).Source
New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
$taskAction = New-ScheduledTaskAction `
    -Execute $windowsWscript `
    -Argument "`"$hiddenLauncherPath`" `"$windowsPowerShell`" `"$workerPath`" `"$npmPath`" `"$runtimeRoot`"" `
    -WorkingDirectory $siteRoot
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = New-ScheduledTaskPrincipal `
    -UserId $identity `
    -LogonType Interactive `
    -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -MultipleInstances IgnoreNew `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask `
    -TaskName $taskName `
    -Action $taskAction `
    -Principal $principal `
    -Settings $settings `
    -Description 'On-demand localhost server for Jianwei V3. No boot or login trigger.' `
    -Force | Out-Null

Start-ScheduledTask -TaskName $taskName

$deadline = (Get-Date).AddSeconds(60)
while ((Get-Date) -lt $deadline) {
    if (Test-LocalHealth) {
        Show-Status
        exit 0
    }

    $task = Get-TaskOrNull
    if ($task.State -ne 'Running') {
        break
    }
    Start-Sleep -Milliseconds 500
}

$recentLogs = if (Test-Path -LiteralPath $runtimeRoot) {
    Get-ChildItem -LiteralPath $runtimeRoot -File -Filter 'server-*.log' |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 2
} else {
    @()
}

foreach ($log in $recentLogs) {
    Write-Host "--- $($log.Name) ---"
    Get-Content -LiteralPath $log.FullName -Tail 40
}

throw 'The localhost task did not become healthy within 60 seconds.'
