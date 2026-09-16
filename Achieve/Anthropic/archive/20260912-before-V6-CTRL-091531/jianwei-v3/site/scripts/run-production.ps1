param(
    [Parameter(Mandatory = $true)]
    [string]$NpmPath,

    [Parameter(Mandatory = $true)]
    [string]$RuntimeRoot,

    [int]$Port = 4311
)

$ErrorActionPreference = 'Stop'

try {
    $siteRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
    $RuntimeRoot = [System.IO.Path]::GetFullPath($RuntimeRoot)

    if (-not (Test-Path -LiteralPath $NpmPath -PathType Leaf)) {
        throw "npm.cmd was not found at the requested path: $NpmPath"
    }

    New-Item -ItemType Directory -Path $RuntimeRoot -Force | Out-Null
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $stdoutPath = Join-Path $RuntimeRoot ("server-$stamp.out.log")
    $stderrPath = Join-Path $RuntimeRoot ("server-$stamp.err.log")
    Set-Content -LiteralPath (Join-Path $RuntimeRoot 'current-log.txt') -Value $stdoutPath -Encoding UTF8

    $env:PORT = [string]$Port
    Push-Location $siteRoot
    try {
        & $NpmPath run start 1>> $stdoutPath 2>> $stderrPath
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
