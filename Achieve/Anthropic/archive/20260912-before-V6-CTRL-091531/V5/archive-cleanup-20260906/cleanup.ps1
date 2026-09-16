param([switch]$Execute)
$ErrorActionPreference='Stop'
$sourceRoot='C:\Users\22673\Desktop\Archive'
$protectedRoots=@(
    'C:\Users\22673\Desktop\Archive\TAG-sources-20260821\JW\.codex-remote-attachments',
    'C:\Users\22673\Desktop\Archive\TAG-sources-20260821\Stars\.codex-remote-attachments'
)
function Assert-Target([string]$path) {
    $absolute=[IO.Path]::GetFullPath($path)
    if (-not $absolute.StartsWith($sourceRoot+'\',[StringComparison]::OrdinalIgnoreCase)) {throw "Out of source scope: $absolute"}
    foreach($protected in $protectedRoots) {
        if ($absolute.Equals($protected,[StringComparison]::OrdinalIgnoreCase) -or
            $protected.StartsWith($absolute+'\',[StringComparison]::OrdinalIgnoreCase) -or
            $absolute.StartsWith($protected+'\',[StringComparison]::OrdinalIgnoreCase)) {throw "Protected overlap: $absolute"}
    }
    return $absolute
}
$targets=@()
foreach($name in @('Compare-Material-Archive-20260814','git-verification','P5-Core-Scope-20260812')) {
    $targets+=Assert-Target (Join-Path $sourceRoot $name)
}
$tagRoot=Join-Path $sourceRoot 'TAG-sources-20260821'
foreach($item in Get-ChildItem -LiteralPath $tagRoot -Force) {
    if($item.Name -in @('JW','Stars')) {
        foreach($child in Get-ChildItem -LiteralPath $item.FullName -Force) {
            if($child.Name -ne '.codex-remote-attachments') {$targets+=Assert-Target $child.FullName}
        }
    } else {$targets+=Assert-Target $item.FullName}
}
if(-not $Execute) {
    $targets | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'deletion-targets.json') -Encoding utf8
    [pscustomobject]@{target_count=$targets.Count;source=$sourceRoot;protected=$protectedRoots} | ConvertTo-Json
    return
}
$planned=@(Get-Content -LiteralPath (Join-Path $PSScriptRoot 'deletion-targets.json') -Raw | ConvertFrom-Json)
if(Compare-Object ($planned | Sort-Object) ($targets | Sort-Object)) {throw 'Deletion targets changed'}
$remote=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'remote-verification.json') -Raw | ConvertFrom-Json
$verified=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'source-verification.json') -Raw | ConvertFrom-Json
if(-not $remote.verified -or -not $remote.private -or $remote.parts -ne 10) {throw 'Remote recovery gate failed'}
if(-not $verified.ready_for_remote_verified_cleanup) {throw 'Source gate failed'}
foreach($link in $verified.links) {
    $linkPath=Assert-Target (Join-Path $sourceRoot $link)
    $item=Get-Item -LiteralPath $linkPath -Force
    if(-not ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {throw 'Expected junction'}
    Remove-Item -LiteralPath $linkPath -Force
}
$completed=@()
foreach($target in $targets) {
    $safe=Assert-Target $target
    if (Test-Path -LiteralPath $safe) {
        Remove-Item -LiteralPath $safe -Recurse -Force
        if(Test-Path -LiteralPath $safe) {throw "Deletion incomplete: $safe"}
    }
    $completed+=$safe
    $completed | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'deleted-targets.json') -Encoding utf8
    Write-Output ('Removed: '+[IO.Path]::GetRelativePath($sourceRoot,$safe))
}
$remaining=@(Get-ChildItem -LiteralPath $sourceRoot -Recurse -File -Force)
if($remaining.Count -ne $verified.protected.Count) {throw 'Unexpected remaining files'}
foreach($row in $verified.protected) {
    $path=Join-Path $sourceRoot $row.path
    if((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $row.sha256) {throw 'Protected file changed'}
}
[pscustomobject]@{deleted_targets=$completed.Count;remaining_files=$remaining.Count;remaining_bytes=($remaining | Measure-Object Length -Sum).Sum} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'cleanup-receipt.json') -Encoding utf8
Get-Content -LiteralPath (Join-Path $PSScriptRoot 'cleanup-receipt.json')
