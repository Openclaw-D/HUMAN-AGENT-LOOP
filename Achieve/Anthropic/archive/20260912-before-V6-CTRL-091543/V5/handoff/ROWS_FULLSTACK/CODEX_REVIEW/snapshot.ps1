$ErrorActionPreference = 'Stop'
$rootPath = 'C:\Users\22673\Desktop\Anthropic'
$snapshotPath = Join-Path $rootPath ('archive\20260912-before-V6-CTRL-' + (Get-Date -Format 'HHmmss'))
New-Item -ItemType Directory -Path $snapshotPath | Out-Null
$sources = @()
foreach ($name in @('AGENTS.md','README.md','NORTH_STAR.md','DECISIONS.md','ROADMAP.md','CHALLENGE_LOG.md','CHANGELOG.md')) { $sources += Get-Item -LiteralPath (Join-Path $rootPath $name) }
foreach ($dir in @('V5','jianwei-v3\site\app','jianwei-v3\site\lib','jianwei-v3\site\test','jianwei-v3\site\scripts')) {
  $sources += Get-ChildItem -LiteralPath (Join-Path $rootPath $dir) -File -Recurse | Where-Object { $_.Extension -ne '.log' }
}
$sources += Get-ChildItem -LiteralPath (Join-Path $rootPath 'jianwei-v3\site') -File | Where-Object { $_.Name -notmatch '^\.env|^\.dev\.vars|tsbuildinfo|\.log$|\.pem$' }
$runtimeFile = Join-Path $rootPath 'jianwei-v3\site\.v5-preview-data\rows-store.json'
if (Test-Path -LiteralPath $runtimeFile) { $sources += Get-Item -LiteralPath $runtimeFile }
$manifest = foreach ($file in ($sources | Sort-Object FullName -Unique)) {
  $relative = $file.FullName.Substring($rootPath.Length + 1)
  $dest = Join-Path $snapshotPath $relative
  New-Item -ItemType Directory -Path (Split-Path $dest) -Force | Out-Null
  Copy-Item -LiteralPath $file.FullName -Destination $dest
  $fromHash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
  $toHash = (Get-FileHash -LiteralPath $dest -Algorithm SHA256).Hash
  if ($fromHash -ne $toHash) { throw "Snapshot mismatch: $relative" }
  [pscustomobject]@{path=$relative;sha256=$toHash;bytes=$file.Length}
}
$manifest | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath (Join-Path $snapshotPath 'MANIFEST.json') -Encoding utf8
git -C (Join-Path $rootPath 'jianwei-v3\site') status --short | Set-Content -LiteralPath (Join-Path $snapshotPath 'git-status.txt')
git -C (Join-Path $rootPath 'jianwei-v3\site') rev-parse HEAD | Set-Content -LiteralPath (Join-Path $snapshotPath 'HEAD.txt')
[pscustomobject]@{snapshot=$snapshotPath;files=$manifest.Count;verified=$true} | ConvertTo-Json
