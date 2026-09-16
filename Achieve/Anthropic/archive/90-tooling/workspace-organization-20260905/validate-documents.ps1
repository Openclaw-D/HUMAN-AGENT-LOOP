$ErrorActionPreference = 'Stop'
$workspacePath = 'C:\Users\22673\Desktop\Anthropic'
$auditPath = Join-Path $workspacePath 'archive\90-tooling\workspace-organization-20260905'
$files = [Collections.Generic.List[string]]::new()
foreach ($dir in @($workspacePath, (Join-Path $workspacePath 'V4'), (Join-Path $workspacePath 'jianwei-v3\site\docs\v4'))) {
    foreach ($file in Get-ChildItem -LiteralPath $dir -Filter '*.md' -File) {
        if ($file.Name -notin @('CHANGELOG.md','CONTEXT_LOG.md')) { $files.Add($file.FullName) }
    }
}
foreach ($relative in @('V1/README.md','V2/README.md','V3/README.md','Unity/WORKSPACE_ENTRY.md','历史代码/README.md','V4/archive/README.md','archive/README.md','context/README.md','materials/README.md','versions/README.md','jianwei-v3/site/AGENTS.md','jianwei-v3/site/README.md','jianwei-v3/site/STACK.md','archive/90-tooling/workspace-organization-20260905/README.md')) {
    $files.Add((Join-Path $workspacePath $relative))
}
$failures = [Collections.Generic.List[string]]::new()
$links = 0
foreach ($file in $files) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { $failures.Add("Missing document: $file"); continue }
    $content = [IO.File]::ReadAllText($file)
    foreach ($match in [regex]::Matches($content, '\[[^\]]+\]\((?<target>[^)\r\n]+)\)')) {
        $target = $match.Groups['target'].Value.Trim().Trim('<','>')
        if ($target -match '^(https?:|mailto:|#)') { continue }
        $target = ($target -split '#',2)[0]
        if (-not $target) { continue }
        $links++
        $resolved = [IO.Path]::GetFullPath((Join-Path (Split-Path $file -Parent) ([Uri]::UnescapeDataString($target))))
        if (-not (Test-Path -LiteralPath $resolved)) { $failures.Add("Broken link: $file -> $target") }
    }
}
$backups = Get-Content -LiteralPath (Join-Path $auditPath 'backup-manifest.json') -Raw | ConvertFrom-Json
foreach ($backup in $backups) {
    $file = Join-Path (Join-Path $auditPath 'before-edit') $backup.Path
    if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $backup.SHA256) { $failures.Add("Backup mismatch: $($backup.Path)") }
}
$moves = Get-Content -LiteralPath (Join-Path $auditPath 'verified-moves.json') -Raw | ConvertFrom-Json
foreach ($move in $moves) {
    if (-not (Test-Path -LiteralPath (Join-Path $workspacePath $move.To))) { $failures.Add("Missing moved target: $($move.To)") }
}
$dependency = Get-Content -LiteralPath (Join-Path $auditPath 'dependency-archive.json') -Raw | ConvertFrom-Json
$zipPath = Join-Path $workspacePath '历史代码/早期平台快照/sources/legacy/tag/lab/site/node_modules.restore.zip'
if ((Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash -ne $dependency.ArchiveSHA256) { $failures.Add('Dependency ZIP hash changed.') }
if (Test-Path -LiteralPath (Join-Path $workspacePath 'V5')) { $failures.Add('Unexpected V5 directory.') }
if (Test-Path -LiteralPath (Join-Path $workspacePath 'versions/V4')) { $failures.Add('Duplicate versions/V4 directory.') }
[pscustomobject]@{
    Status = $(if ($failures.Count -eq 0) {'PASS'} else {'FAIL'})
    CheckedAt = (Get-Date -Format o)
    Documents = $files.Count
    LocalLinks = $links
    BackupHashesVerified = $backups.Count
    RelocatedTargetsPresent = $moves.Count
    DependencyArchiveSHA256Verified = $true
    CodeTestsRunThisCheckpoint = $false
    Scope = 'Current navigation links and backup integrity; history documents and legacy runtime links are not rewritten or asserted runnable.'
    Failures = $failures.ToArray()
} | ConvertTo-Json -Depth 5
if ($failures.Count -gt 0) { exit 1 }
