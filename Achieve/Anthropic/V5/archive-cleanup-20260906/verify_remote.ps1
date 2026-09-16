$ErrorActionPreference='Stop'
$repo='Openclaw-D/archive-legacy-projects-20260906'
$metadata=gh api "repos/$repo" | ConvertFrom-Json
if($LASTEXITCODE -ne 0 -or -not $metadata.private) {throw 'Repository privacy gate failed'}
$releases=gh api "repos/$repo/releases" | ConvertFrom-Json
if($LASTEXITCODE -ne 0) {throw 'Release read failed'}
$release=@($releases | Where-Object tag_name -eq 'snapshot-20260906')
if($release.Count -ne 1) {throw 'Release not uniquely found'}
$release=$release[0]
$parts=@(Get-Content -LiteralPath (Join-Path $PSScriptRoot 'release-parts.json') -Raw | ConvertFrom-Json)
if($release.assets.Count -ne $parts.Count) {throw 'Incomplete remote asset count'}
$verified=@()
foreach($part in $parts) {
    $asset=@($release.assets | Where-Object name -eq $part.name)
    if($asset.Count -ne 1) {throw "Missing asset: $($part.name)"}
    $asset=$asset[0]
    if($asset.state -ne 'uploaded' -or $asset.size -ne $part.size -or $asset.digest -ne ('sha256:'+$part.sha256)) {throw "Remote hash/size/state mismatch: $($part.name)"}
    $verified+=[pscustomobject]@{name=$part.name;size=$asset.size;sha256=$part.sha256;id=$asset.id}
}
$localCommit=git -C 'C:\Users\22673\Desktop\Archive-transfer-20260906\repo' rev-parse HEAD
if($LASTEXITCODE -ne 0) {throw 'Local commit unavailable'}
$remoteCommit=gh api "repos/$repo/commits/main" --jq .sha
if($LASTEXITCODE -ne 0 -or $remoteCommit -ne $localCommit) {throw 'Remote commit mismatch'}
gh release edit snapshot-20260906 --repo $repo --draft=false
if($LASTEXITCODE -ne 0) {throw 'Release finalize failed'}
$final=gh api "repos/$repo/releases/tags/snapshot-20260906" | ConvertFrom-Json
if($LASTEXITCODE -ne 0 -or $final.draft) {throw 'Release final state not verified'}
$receipt=[pscustomobject]@{verified=$true;private=$true;repo=$metadata.html_url;release=$final.html_url;commit=$remoteCommit;parts=$verified.Count;assets=$verified;checked_at=(Get-Date -Format o)}
$receipt | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'remote-verification.json') -Encoding utf8
$receipt | Select-Object verified,private,repo,release,commit,parts | ConvertTo-Json
