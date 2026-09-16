$ErrorActionPreference = 'Stop'
$taskRoot = 'C:\Users\22673\Desktop\Anthropic'
$taskSnapshot = Join-Path $taskRoot 'V4\archive\工程基线\20260905-ENG01'
if (Test-Path -LiteralPath $taskSnapshot) { throw 'Snapshot already exists; do not overwrite.' }
$repoRoot = Join-Path $taskRoot 'jianwei-v3\site'
$sources = @()
$sources += Get-ChildItem -LiteralPath $taskRoot -File -Filter '*.md'
$sources += Get-ChildItem -LiteralPath (Join-Path $taskRoot 'V4') -File -Filter '*.md'
$sources += Get-ChildItem -LiteralPath $repoRoot -File | Where-Object { $_.Name -match '\.(md|json|mjs|cjs|ts|js|yaml|yml)$' -and $_.Name -notmatch 'tsbuildinfo|secret|credential' }
foreach ($folder in @('app','lib','test','scripts','docs\v4')) {
  $sources += Get-ChildItem -LiteralPath (Join-Path $repoRoot $folder) -File -Recurse | Where-Object { $_.Extension -in @('.ts','.tsx','.js','.mjs','.cjs','.css','.json','.md','.ps1') }
}
$rows = foreach ($source in ($sources | Sort-Object FullName -Unique)) {
  $relative = $source.FullName.Substring($taskRoot.Length + 1)
  $destination = Join-Path $taskSnapshot $relative
  New-Item -ItemType Directory -Path (Split-Path $destination) -Force | Out-Null
  Copy-Item -LiteralPath $source.FullName -Destination $destination
  $hash = (Get-FileHash -LiteralPath $source.FullName -Algorithm SHA256).Hash
  if ((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash -ne $hash) { throw "Hash mismatch: $relative" }
  [pscustomobject]@{ path=$relative; bytes=$source.Length; sha256=$hash }
}
$rows | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath (Join-Path $taskSnapshot 'manifest.json') -Encoding utf8
[pscustomobject]@{snapshot=$taskSnapshot; files=@($rows).Count; bytes=($rows | Measure-Object bytes -Sum).Sum; verified=$true} | ConvertTo-Json
