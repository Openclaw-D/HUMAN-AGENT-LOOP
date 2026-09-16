param(
    [Parameter(Mandatory = $true)]
    [string]$NpmPath,

    [Parameter(Mandatory = $true)]
    [string]$RuntimeRoot
)

$ErrorActionPreference = 'Stop'

try {
    $siteRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
    $RuntimeRoot = [System.IO.Path]::GetFullPath($RuntimeRoot)

    if (-not (Test-Path -LiteralPath $NpmPath -PathType Leaf)) {
        throw "npm.cmd was not found at the registered path: $NpmPath"
    }

    New-Item -ItemType Directory -Path $RuntimeRoot -Force | Out-Null
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $stdoutPath = Join-Path $RuntimeRoot ("server-$stamp.out.log")
    $stderrPath = Join-Path $RuntimeRoot ("server-$stamp.err.log")
    Set-Content -LiteralPath (Join-Path $RuntimeRoot 'current-log.txt') -Value $stdoutPath -Encoding UTF8

    Push-Location $siteRoot
    try {
        # V4 四域后端持久化（opt-in 接线）：为 v4life 事件账本提供稳定数据目录，
        # 托管服务重启后经 refold 自动恢复演示状态（见 lib/v4life/runtime.ts 与 docs/v4/CONTRACT.md §15）。
        $env:V4LIFE_DATA_DIR = Join-Path $RuntimeRoot 'v4life-data'
        & $NpmPath run dev:node -- --hostname localhost --port 3000 1>> $stdoutPath 2>> $stderrPath
        exit $LASTEXITCODE
    }
    finally {
        Pop-Location
    }
}
catch {
    New-Item -ItemType Directory -Path $RuntimeRoot -Force | Out-Null
    ($_ | Out-String) | Set-Content -LiteralPath (Join-Path $RuntimeRoot 'bootstrap-error.log') -Encoding UTF8
    throw
}
