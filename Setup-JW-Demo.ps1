# 只生成公开合成演示配置；已有配置保留，不写入真实密钥。
$ErrorActionPreference = 'Stop'
$target = Join-Path $PSScriptRoot 'Back/Edge/.run/v05/config.runtime.json'
if (Test-Path -LiteralPath $target) { Write-Host '已有本地演示配置：保留。'; exit 0 }
$templatePath = Join-Path $PSScriptRoot 'docs/integration/2026-09-29/03-integration/config-template/demo03-config-template.json'
$template = Get-Content -LiteralPath $templatePath -Raw -Encoding UTF8 | ConvertFrom-Json
$config = $template.config
$config.dbUser = 'jwv05demo'
$config.dbPassword = 'v05-local-synthetic-demo'
$config.requiredDomainsPolicy.version = 'v05-required-v1'
$config.requiredDomainsPolicy.seedSql = $config.requiredDomainsPolicy.seedSql.Replace('demo03-required-v1','v05-required-v1').Replace('demo03-isolated-seed','v05-isolated-seed')
$config.edgeServeFront = (Join-Path $PSScriptRoot 'Front/dist')
$config.PSObject.Properties.Remove('arrowCasesFallback')
$config.PSObject.Properties.Remove('_arrowCasesFallbackNote')
New-Item -ItemType Directory -Path (Split-Path $target) -Force | Out-Null
[IO.File]::WriteAllText($target,($config | ConvertTo-Json -Depth 20),[Text.UTF8Encoding]::new($false))
Write-Host '已生成仅供本机使用的合成演示配置；现在运行 Start-JW.cmd。'
