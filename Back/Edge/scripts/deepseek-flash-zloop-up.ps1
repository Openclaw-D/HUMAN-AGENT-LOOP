param([int]$Port = 48334)
$ErrorActionPreference = 'Stop'
$edgeRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$repoRoot = (Resolve-Path (Join-Path $edgeRoot '../..')).Path
$source = Join-Path $edgeRoot '.run/zloop/assistant-config.json'
$auth = Join-Path $edgeRoot '.run/zloop/edge-auth.json'
$connectorToken = Join-Path $edgeRoot '.run/zloop/connectors-token.txt'
$runDir = Join-Path $edgeRoot '.run/flash-zloop'
$secretDir = Join-Path $env:LOCALAPPDATA 'JW/secrets'
$keyFile = Get-ChildItem -LiteralPath $secretDir -Filter 'deepseek-api-key-*.dpapi' |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $keyFile) { throw 'DeepSeek DPAPI key unavailable' }
foreach ($path in @($source, $auth, $connectorToken, (Join-Path $repoRoot 'Front/dist/index.html'))) {
  if (-not (Test-Path -LiteralPath $path)) { throw "Required local file unavailable: $path" }
}
foreach ($portToCheck in @(48304, 48284, 15474)) {
  if (-not (Get-NetTCPConnection -LocalPort $portToCheck -State Listen -ErrorAction SilentlyContinue)) {
    throw "zloop dependency port $portToCheck unavailable"
  }
}
New-Item -ItemType Directory -Force -Path $runDir | Out-Null
$sourceConfig = Get-Content -LiteralPath $source -Raw | ConvertFrom-Json
if (@($sourceConfig.evidencePolicy.allowedHashes).Count -lt 3) { throw 'Synthetic evidence allowlist unavailable' }
$modelConfig = @{
  transport = @{ mode = 'real'; real = @{
    endpoint = 'https://api.deepseek.com/chat/completions'
    model = 'deepseek-flash'
    apiKeyEnv = 'JW_DEEPSEEK_API_KEY'
    outboundAllow = @('https://api.deepseek.com')
    maxOutputTokens = 300
    timeoutMs = 30000
    routing = @{ strategy = 'deepseek-flash-only-v1'; flashModel = 'deepseek-flash'; flashMaxOutputTokens = 300 }
  } }
  maxContextChars = 12000
  evidencePolicy = @{ allowedHashes = @($sourceConfig.evidencePolicy.allowedHashes) }
  budget = @{ maxTotalCost = 3; perCallEstimate = 0.03; maxCalls = 100; currency = 'USD' }
}
$modelPath = Join-Path $runDir 'assistant-config.json'
$modelConfig | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $modelPath -Encoding utf8
$secret = ConvertTo-SecureString ([System.IO.File]::ReadAllText($keyFile.FullName))
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
try {
  $env:JW_DEEPSEEK_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  & node (Join-Path $edgeRoot 'scripts/edge-start.mjs') --run-dir $runDir --port $Port `
    --kernel-port 48304 --db-port 15474 --live --auth-file $auth `
    --connectors-url 'http://127.0.0.1:48284' --connectors-token-file $connectorToken `
    --connectors-tenant tt1 --messages-file (Join-Path $runDir 'edge-messages.db') `
    --model-config $modelPath --model-receipts-dir (Join-Path $runDir 'model-receipts') `
    --serve-front (Join-Path $repoRoot 'Front/dist')
  if ($LASTEXITCODE -ne 0) { throw "Edge startup failed: $LASTEXITCODE" }
} finally {
  Remove-Item Env:JW_DEEPSEEK_API_KEY -ErrorAction SilentlyContinue
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  $secret.Dispose()
}
Write-Output "Flash Edge: http://127.0.0.1:$Port/"
