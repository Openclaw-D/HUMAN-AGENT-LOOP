$ErrorActionPreference = 'Stop'
$sourceRoot = 'C:\Users\22673\Desktop\Archive'
$targetRoot = 'C:\Users\22673\Desktop\Anthropic\materials\reusable-assets\20260906-archive'
$planPath = Join-Path $PSScriptRoot 'plan.json'
function Assert-Within([string]$path, [string]$root) {
    $absolute = [IO.Path]::GetFullPath($path)
    $prefix = [IO.Path]::GetFullPath($root).TrimEnd('\') + '\'
    if (-not $absolute.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw "Out of scope: $absolute" }
    return $absolute
}
$rows = Get-Content -LiteralPath $planPath -Raw | ConvertFrom-Json
$selected = @($rows | Where-Object action -eq 'retain')
$receipt = @()
foreach ($row in $selected) {
    $source = Assert-Within (Join-Path $sourceRoot $row.path) $sourceRoot
    $target = Assert-Within (Join-Path $targetRoot $row.destination) $targetRoot
    if ((Get-Item -LiteralPath $source).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Unexpected link: $source" }
    if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant() -ne $row.sha256) { throw "Source mismatch: $source" }
    if (Test-Path -LiteralPath $target) { throw "Destination exists: $target" }
    New-Item -ItemType Directory -Path (Split-Path $target -Parent) -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $target
    if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -ne $row.sha256) { throw "Target mismatch: $target" }
    $receipt += [pscustomobject]@{ source=$row.path; destination=$row.destination; sha256=$row.sha256; size=$row.size }
}
$receipt | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'retained-receipt.json') -Encoding utf8
foreach ($row in $selected) {
    $source = Assert-Within (Join-Path $sourceRoot $row.path) $sourceRoot
    Remove-Item -LiteralPath $source -Force
}
[pscustomobject]@{moved=$receipt.Count; bytes=($receipt | Measure-Object size -Sum).Sum; target=$targetRoot} | ConvertTo-Json
