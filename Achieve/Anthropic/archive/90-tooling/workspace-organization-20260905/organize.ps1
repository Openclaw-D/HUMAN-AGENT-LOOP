param([Parameter(Mandatory)][ValidateSet('Prepare','PackDependencies','CleanCache','MoveLayout','VerifyMoves')][string]$Action)

$ErrorActionPreference = 'Stop'
$workspacePath = 'C:\Users\22673\Desktop\Anthropic'
$auditPath = Join-Path $workspacePath 'archive\90-tooling\workspace-organization-20260905'
$prefix = $workspacePath + '\'

function SafePath([string]$relative) {
    $resolved = [IO.Path]::GetFullPath((Join-Path $workspacePath $relative))
    if (-not $resolved.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw "Outside workspace: $relative" }
    return $resolved
}

function SaveJson([string]$name, $value) {
    $value | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $auditPath $name) -Encoding utf8
}

function TreeSignature([string]$path) {
    $base = [IO.Path]::GetFullPath($path)
    if (Test-Path -LiteralPath $base -PathType Leaf) {
        $file = Get-Item -LiteralPath $base
        return [pscustomobject]@{Files=1;Bytes=$file.Length;Links=0;Digest=(Get-FileHash -LiteralPath $base -Algorithm SHA256).Hash}
    }
    $pending = [Collections.Generic.Stack[IO.DirectoryInfo]]::new()
    $pending.Push([IO.DirectoryInfo]::new($base))
    $rows = [Collections.Generic.List[string]]::new()
    [long]$bytes=0; [int]$files=0; [int]$links=0
    while ($pending.Count -gt 0) {
        foreach ($entry in $pending.Pop().GetFileSystemInfos()) {
            $relative = $entry.FullName.Substring($base.Length + 1).Replace('\','/')
            if (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                $item = Get-Item -LiteralPath $entry.FullName -Force
                $rows.Add("L|$relative|$($item.Target -join ';')")
                $links++
            } elseif ($entry -is [IO.DirectoryInfo]) {
                $rows.Add("D|$relative")
                $pending.Push($entry)
            } else {
                $hash = (Get-FileHash -LiteralPath $entry.FullName -Algorithm SHA256).Hash
                $rows.Add("F|$relative|$($entry.Length)|$hash")
                $bytes += $entry.Length
                $files++
            }
        }
    }
    $rows.Sort([StringComparer]::Ordinal)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $digest = [Convert]::ToHexString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes(($rows -join "`n")))) } finally { $sha.Dispose() }
    return [pscustomobject]@{Files=$files;Bytes=$bytes;Links=$links;Digest=$digest}
}

$moves = @(
    @{From='archive\00-pre-financing-leasing-mvp';To='历史代码\早期平台快照'},
    @{From='archive\10-v2z-experiments';To='历史代码\V2Z实验'},
    @{From='archive\20-p2-discovery';To='V2\archive\P2探索'},
    @{From='archive\30-v3-materials\eye-unity';To='Unity'},
    @{From='archive\30-v3-materials\legacy-static-shell-20260828';To='历史代码\V3静态展示壳'},
    @{From='archive\30-v3-materials\prototype';To='历史代码\V3原型'},
    @{From='archive\30-v3-materials';To='V3\archive'},
    @{From='versions\V4';To='V4'},
    @{From='archive\40-v4-life-convergence';To='V4\archive\产品收敛记录'},
    @{From='materials\showcase\jianwei-v3-showcase';To='V3\materials\展示与PPT'},
    @{From='jianwei-v3\site\docs\v4\ZCODE_BACKEND_GOAL.md';To='V4\archive\执行任务书\ZCODE_BACKEND_GOAL.md'},
    @{From='jianwei-v3\site\docs\v4\ZCODE_CONCURRENCY_TRIAL.md';To='V4\archive\执行任务书\ZCODE_CONCURRENCY_TRIAL.md'},
    @{From='jianwei-v3\site\docs\v4\ZCODE_OVERNIGHT_MASTER_PROMPT.md';To='V4\archive\执行任务书\ZCODE_OVERNIGHT_MASTER_PROMPT.md'},
    @{From='jianwei-v3\site\docs\v4\ZCODE_OVERNIGHT_WORKSPACE_GOAL.md';To='V4\archive\执行任务书\ZCODE_OVERNIGHT_WORKSPACE_GOAL.md'},
    @{From='jianwei-v3\site\docs\v4\BACKEND_PROGRESS.md';To='V4\archive\工程验收\BACKEND_PROGRESS.md'},
    @{From='jianwei-v3\site\docs\v4\ACCEPTANCE.md';To='V4\archive\工程验收\ACCEPTANCE.md'},
    @{From='jianwei-v3\site\docs\v4\ZCODE_RUN_STATUS.md';To='V4\archive\工程验收\ZCODE_RUN_STATUS.md'}
)

if ($Action -eq 'Prepare') {
    $backupDir = Join-Path $auditPath 'before-edit'
    if (Test-Path -LiteralPath $backupDir) { throw 'Backup already exists; do not overwrite.' }
    New-Item -ItemType Directory -Path $backupDir | Out-Null
    $docs = @('AGENTS.md','README.md','NORTH_STAR.md','DECISIONS.md','CHALLENGE_LOG.md','ROADMAP.md','CHANGELOG.md','archive\README.md','materials\README.md','context\README.md')
    $docs += @(Get-ChildItem -LiteralPath (SafePath 'versions\V4') -File -Filter '*.md' | ForEach-Object { $_.FullName.Substring($prefix.Length) })
    $docs += @('jianwei-v3\site\AGENTS.md','jianwei-v3\site\README.md','jianwei-v3\site\STACK.md','jianwei-v3\site\CHANGELOG.md','archive\30-v3-materials\eye-unity\README.md')
    $docs += @(Get-ChildItem -LiteralPath (SafePath 'jianwei-v3\site\docs\v4') -File -Filter '*.md' | ForEach-Object { $_.FullName.Substring($prefix.Length) })
    $records = foreach ($relative in ($docs | Select-Object -Unique)) {
        $source = SafePath $relative
        $dest = Join-Path $backupDir $relative
        New-Item -ItemType Directory -Path (Split-Path $dest -Parent) -Force | Out-Null
        Copy-Item -LiteralPath $source -Destination $dest
        $sha = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
        if ($sha -ne (Get-FileHash -LiteralPath $dest -Algorithm SHA256).Hash) { throw "Backup mismatch: $relative" }
        [pscustomobject]@{Path=$relative;SHA256=$sha}
    }
    SaveJson 'backup-manifest.json' $records
    SaveJson 'move-plan.json' $moves
    Write-Output "Backup verified: $($records.Count) Markdown files. Planned relocations: $($moves.Count)."
}

if ($Action -eq 'PackDependencies') {
    $source = SafePath 'archive\00-pre-financing-leasing-mvp\sources\legacy\tag\lab\site\node_modules'
    $zipPath = SafePath 'archive\00-pre-financing-leasing-mvp\sources\legacy\tag\lab\site\node_modules.restore.zip'
    if (Test-Path -LiteralPath $zipPath) { throw 'Archive already exists; do not overwrite.' }
    if (Get-ChildItem -LiteralPath $source -Recurse -Force -Attributes ReparsePoint) { throw 'Dependency tree contains a link; manual handling required.' }
    $manifest = @{}
    [long]$sourceBytes = 0
    foreach ($file in Get-ChildItem -LiteralPath $source -File -Recurse -Force) {
        $key = 'node_modules/' + $file.FullName.Substring($source.Length + 1).Replace('\','/')
        $manifest[$key] = [pscustomobject]@{Size=$file.Length;SHA256=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash}
        $sourceBytes += $file.Length
    }
    Write-Output "Source hashed: $($manifest.Count) files / $sourceBytes bytes; creating lossless restore archive."
    [IO.Compression.ZipFile]::CreateFromDirectory($source,$zipPath,[IO.Compression.CompressionLevel]::Optimal,$true)
    $zip = [IO.Compression.ZipFile]::OpenRead($zipPath)
    $verified = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    try {
        foreach ($entry in $zip.Entries) {
            if ($entry.FullName.EndsWith('/')) { continue }
            if (-not $manifest.ContainsKey($entry.FullName)) { throw "Unexpected zip entry: $($entry.FullName)" }
            $stream = $entry.Open(); $sha = [Security.Cryptography.SHA256]::Create()
            try { $hash = [Convert]::ToHexString($sha.ComputeHash($stream)) } finally { $stream.Dispose(); $sha.Dispose() }
            if ($hash -ne $manifest[$entry.FullName].SHA256 -or $entry.Length -ne $manifest[$entry.FullName].Size) { throw "Zip mismatch: $($entry.FullName)" }
            if (-not $verified.Add($entry.FullName)) { throw 'Duplicate zip entry.' }
        }
    } finally { $zip.Dispose() }
    if ($verified.Count -ne $manifest.Count) { throw 'Archive is missing files.' }
    $report = [pscustomobject]@{OriginalPath=$source;ArchivePath=$zipPath;Files=$verified.Count;SourceBytes=$sourceBytes;ArchiveBytes=(Get-Item -LiteralPath $zipPath).Length;ArchiveSHA256=(Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash;VerifiedAt=(Get-Date -Format o);Recycled=$false}
    SaveJson 'dependency-archive.json' $report
    Add-Type -AssemblyName Microsoft.VisualBasic
    [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($source,[Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,[Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin,[Microsoft.VisualBasic.FileIO.UICancelOption]::ThrowException)
    if (Test-Path -LiteralPath $source) { throw 'Original dependency directory remains; do not report reclaimed space.' }
    $report.Recycled = $true
    SaveJson 'dependency-archive.json' $report
    Write-Output "Archive byte-for-byte verified: $($verified.Count) files. Original dependency directory moved to Windows Recycle Bin; archive retained."
}

if ($Action -eq 'CleanCache') {
    $cache = SafePath 'jianwei-v3\site\.next'
    $activeNext = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match '[\\/]next[\\/]dist[\\/]' })
    if ($activeNext.Count -gt 0) { throw 'A Next server is running; leave cache untouched.' }
    $cacheFiles = @(Get-ChildItem -LiteralPath $cache -File -Recurse -Force)
    $latest = ($cacheFiles | Sort-Object LastWriteTime -Descending | Select-Object -First 1).LastWriteTime
    if ($latest -gt (Get-Date).AddHours(-2)) { throw 'Build cache changed recently; leave it untouched.' }
    $tracked = @(& git -C (SafePath 'jianwei-v3\site') ls-files -- '.next')
    if ($LASTEXITCODE -ne 0 -or $tracked.Count -gt 0) { throw 'Cannot prove cache is untracked.' }
    $report = [pscustomobject]@{Path=$cache;Files=$cacheFiles.Count;Bytes=($cacheFiles | Measure-Object Length -Sum).Sum;LastWrite=$latest;RecycledAt=(Get-Date -Format o);Recovery='Windows Recycle Bin; or regenerate using the repository Next development/build command.'}
    Add-Type -AssemblyName Microsoft.VisualBasic
    [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($cache,[Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,[Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin,[Microsoft.VisualBasic.FileIO.UICancelOption]::ThrowException)
    if (Test-Path -LiteralPath $cache) { throw 'Cache remains; do not report reclaimed space.' }
    SaveJson 'recycled-cache.json' $report
    Write-Output "Unused .next output moved to Recycle Bin: $($report.Bytes) bytes. Active vinext dist and node_modules were not changed."
}

if ($Action -eq 'MoveLayout') {
    $results = [Collections.Generic.List[object]]::new()
    foreach ($move in $moves) {
        $source = SafePath $move.From; $dest = SafePath $move.To
        if (-not (Test-Path -LiteralPath $source)) { throw "Missing source: $source" }
        if (Test-Path -LiteralPath $dest) { throw "Destination already exists: $dest" }
        $before = TreeSignature $source
        New-Item -ItemType Directory -Path (Split-Path $dest -Parent) -Force | Out-Null
        Move-Item -LiteralPath $source -Destination $dest
        $after = TreeSignature $dest
        if ($before.Digest -ne $after.Digest -or $before.Files -ne $after.Files -or $before.Bytes -ne $after.Bytes -or $before.Links -ne $after.Links) { throw "Relocation mismatch: $($move.To)" }
        $results.Add([pscustomobject]@{From=$move.From;To=$move.To;Files=$after.Files;Bytes=$after.Bytes;Links=$after.Links;Digest=$after.Digest;VerifiedAt=(Get-Date -Format o)})
        SaveJson 'verified-moves.json' $results.ToArray()
        Write-Output "Verified: $($move.From) -> $($move.To) ($($after.Files) files)."
    }
}

if ($Action -eq 'VerifyMoves') {
    $records = Get-Content -LiteralPath (Join-Path $auditPath 'verified-moves.json') -Raw | ConvertFrom-Json
    foreach ($record in $records) {
        if (-not (Test-Path -LiteralPath (SafePath $record.To))) { throw "Missing relocated target: $($record.To)" }
    }
    Write-Output "All $($records.Count) relocated targets exist; byte-level signatures were checked immediately after each move."
}
