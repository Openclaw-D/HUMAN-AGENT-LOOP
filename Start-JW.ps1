# Start-JW.ps1 - JW 本地系统一键启动/停止/状态（V0.5 收尾轮 03 路）
# 用法:
#   powershell -NoProfile -ExecutionPolicy Bypass -File Start-JW.ps1            # 启动 v05 栈并打开浏览器
#   powershell -NoProfile -ExecutionPolicy Bypass -File Start-JW.ps1 -Status    # 只看状态
#   powershell -NoProfile -ExecutionPolicy Bypass -File Start-JW.ps1 -Stop      # 停服务（保留数据）
#   powershell -NoProfile -ExecutionPolicy Bypass -File Start-JW.ps1 -Stop -WithDb  # 连自有 PG 容器一起停
#   powershell -NoProfile -ExecutionPolicy Bypass -File Start-JW.ps1 -Stack demo03  # 操作另一登记栈
# 纪律:
#   - 幂等：已在运行的健康栈直接复用；部分存活自动恢复；端口被未知进程占用则报告不抢占。
#   - 真实就绪：以 /healthz/ready 聚合探测 + 版本封存 + 登录冒烟为准，不把静态页面当就绪。
#   - 不改凭据、不禁用鉴权；48430 检查栈与其他登记栈互不影响（integration-lib 多证停止）。
param(
  [string]$Stack = "v05",
  [switch]$Stop,
  [switch]$Status,
  [switch]$NoBrowser,
  [switch]$WithDb,
  [switch]$Init
)
$ErrorActionPreference = 'Stop'
$RepoRoot = $PSScriptRoot

# ---- 登记栈（03 路资源台账；新栈必须先核查端口空闲再登记） ----
$Stacks = @{
  "v05"    = @{ Container="jw-integ-v05-pg";   DbPort=25497; KernelPort=48491; ConnectorsPort=48411; EdgePort=48431; RunSubdir="v05";    Config=".run/v05/config.runtime.json";   Materials="docs/integration/2026-09-30-final/materials" }
  "demo03" = @{ Container="jw-integ-demo03-pg"; DbPort=25496; KernelPort=48490; ConnectorsPort=48410; EdgePort=48430; RunSubdir="demo03"; Config=".run/demo03/config.runtime.json"; Materials="docs/integration/2026-09-29/materials" }
}
if (-not $Stacks.ContainsKey($Stack)) {
  Write-Host "[Start-JW] 未知栈 '$Stack'（可用：$($Stacks.Keys -join ', ')）" -ForegroundColor Red
  exit 2
}
$S = $Stacks[$Stack]
$EdgeUrl = "http://127.0.0.1:$($S.EdgePort)"

function Find-Node {
  $local = Join-Path $RepoRoot ".local\runtime\node-v22.23.0-win-x64\node.exe"
  if (Test-Path $local) { return $local }
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  return $null
}
function Test-Docker {
  try { $null = & docker info --format '{{.ServerVersion}}' 2>$null; return $LASTEXITCODE -eq 0 } catch { return $false }
}
function Get-EdgeReady {
  param([int]$Port)
  try {
    $r = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/healthz/ready" -TimeoutSec 3
    return $r
  } catch { return $null }
}
function Get-EdgeVersion {
  param([int]$Port)
  try { return Invoke-RestMethod -Uri "http://127.0.0.1:$Port/versionz" -TimeoutSec 3 } catch { return $null }
}

# ============ 停止 ============
if ($Stop) {
  $node = Find-Node
  if (-not $node) { Write-Host "[Start-JW] 未找到 Node（.local\runtime 或 PATH）" -ForegroundColor Red; exit 2 }
  Write-Host "[Start-JW] 停止栈 '$Stack'（integration-down 多证复核；不动其他栈）"
  $env:JW_INTEG_RUN_SUBDIR = $S.RunSubdir
  $downArgs = @()
  if ($WithDb) { $downArgs += "--with-db" }
  & $node (Join-Path $RepoRoot "Back\Edge\scripts\integration-down.mjs") @downArgs | Write-Host
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  Write-Host "[Start-JW] 停止完成（数据卷/对象存储/消息库保留；-WithDb 时自有容器一并停止）"
  exit 0
}

# ============ 状态 ============
if ($Status) {
  $ready = Get-EdgeReady -Port $S.EdgePort
  $ver = Get-EdgeVersion -Port $S.EdgePort
  Write-Host ("[Start-JW] 栈 '{0}'  Edge={1}" -f $Stack, $EdgeUrl)
  Write-Host ("  就绪: {0}" -f $(if ($ready -and $ready.ok) { "是" } else { "否" }))
  if ($ready -and $ready.checks) { foreach ($c in $ready.checks) { Write-Host ("  - {0}: {1}{2}" -f $c.name, $(if ($c.ok) {"ok"} else {"NOT-OK"}), $(if ($c.advisory) {"（advisory）"} else {""})) } }
  if ($ver -and $ver.buildId) { Write-Host ("  版本: build={0} contract={1}" -f $ver.buildId, $ver.contractVersion) }
  if ($ready -and $ready.ok) { exit 0 } else { exit 3 }
}

# ============ 启动 ============
Write-Host "==== Start-JW：启动栈 '$Stack' ====" -ForegroundColor Cyan

# 1) Node
$node = Find-Node
if (-not $node) { Write-Host "[Start-JW] ✗ 未找到 Node：期望 $RepoRoot\.local\runtime\node-v22.23.0-win-x64\node.exe 或 PATH 中有 node" -ForegroundColor Red; exit 2 }
Write-Host "[Start-JW] ✓ Node: $node"

# 2) Docker
if (-not (Test-Docker)) {
  Write-Host "[Start-JW] ✗ Docker 不可达：请先启动 Docker Desktop（系统托盘鲸鱼图标变为稳定状态）后重试" -ForegroundColor Red
  exit 2
}
Write-Host "[Start-JW] ✓ Docker 可达"

# 3) 配置（合成演示值；缺失时给模板指引，不自动生成凭据）
$cfgPath = Join-Path $RepoRoot (Join-Path "Back\Edge" $S.Config)
if (-not (Test-Path $cfgPath)) {
  Write-Host "[Start-JW] ✗ 缺少运行配置: $cfgPath" -ForegroundColor Red
  Write-Host "    先在根目录运行 Setup-JW-Demo.ps1（生成合成演示配置；保留已有配置）"
  exit 2
}
Write-Host "[Start-JW] ✓ 运行配置: $cfgPath"

# 3.5) 真实模型密钥环境变量（V0.6-01）：栈目录存在 model-config.json 时，从用户 DPAPI 密钥文件
# 解出 JW_DEEPSEEK_API_KEY 注入子进程（内核语义辅助与 Edge 助手同一引用；密钥不打印、不落盘）。
# 密钥缺失 = 失败关闭并给出恢复指引（模型配置不会静默降级为 mock 或 not_configured 假绿）。
$modelCfgPath = Join-Path (Split-Path $cfgPath) "model-config.json"
if (Test-Path $modelCfgPath) {
  $secretDir = Join-Path $env:LOCALAPPDATA "JW\secrets"
  $keyFile = Get-ChildItem -LiteralPath $secretDir -Filter 'deepseek-api-key-*.dpapi' -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $keyFile) {
    Write-Host "[Start-JW] ✗ 模型配置 $modelCfgPath 存在但找不到 DPAPI 密钥文件（$secretDir\deepseek-api-key-*.dpapi）" -ForegroundColor Red
    Write-Host "    恢复：放回用户 DeepSeek 密钥 DPAPI 文件，或暂移走 model-config.json 以未配置模式启动（模型如实 not_configured）"
    exit 2
  }
  $secure = ConvertTo-SecureString ([System.IO.File]::ReadAllText($keyFile.FullName))
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { $env:JW_DEEPSEEK_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr); $secure.Dispose() }
  Write-Host "[Start-JW] ✓ 真实模型密钥已注入环境（DPAPI；不回显）；模型配置: $modelCfgPath"
}

# 4) 复用或启动
$ready = Get-EdgeReady -Port $S.EdgePort
if ($ready -and $ready.ok) {
  Write-Host "[Start-JW] ✓ 栈已在运行且健康：复用；初始化不重启健康服务"
} else {
  if ($ready) { Write-Host "[Start-JW] i Edge 存活但就绪不完整：走部分恢复（integration-up 幂等）" }
  else { Write-Host "[Start-JW] i Edge 未运行：完整启动（容器→迁移→策略→内核→Connectors→Edge）" }
  $env:JW_INTEG_RUN_SUBDIR = $S.RunSubdir
  Push-Location (Join-Path $RepoRoot "Back\Edge")
  try {
    & $node "scripts/integration-up.mjs" --recover --init --db-container $S.Container --db-port $S.DbPort --kernel-port $S.KernelPort --connectors-port $S.ConnectorsPort --edge-port $S.EdgePort --config $S.Config
    if ($LASTEXITCODE -ne 0) {
      Write-Host "[Start-JW] ✗ integration-up 失败（退出码 $LASTEXITCODE）；上方日志含逐依赖原因。常见：端口被占用（日志会给出占用者，需人工处置）、容器名冲突。" -ForegroundColor Red
      exit $LASTEXITCODE
    }
  } finally { Pop-Location }
}

# 5) 演示数据初始化（幂等；材料未冻结时如实跳过）
$initScript = Join-Path $RepoRoot "Back\Edge\scripts\ten-case-init.mjs"
$initScriptLegacy = Join-Path $RepoRoot "Back\Edge\scripts\demo-init.mjs"
$materialsAbs = Join-Path $RepoRoot $S.Materials
$env:JW_INTEG_RUN_SUBDIR = $S.RunSubdir
Push-Location (Join-Path $RepoRoot "Back\Edge")
try {
  $hasCases = $false
  if ($Stack -eq 'v05') {
    try {
      $seedSession = Invoke-RestMethod -Uri "$EdgeUrl/api/jw/v2/session" -Method Post -ContentType 'application/json' -Body '{"principalId":"biz1"}' -TimeoutSec 8
      $seedDirectory = Invoke-RestMethod -Uri "$EdgeUrl/api/jw/v2/arrow-cases" -Headers @{ 'x-jw-session'=$seedSession.session.sessionId; 'Origin'=$EdgeUrl } -TimeoutSec 30
      $hasCases = $seedDirectory.ok -and @($seedDirectory.cases).Count -eq 10
    } catch { Write-Host "[Start-JW] ✗ 案例目录暂不可读取，保留已有数据：$($_.Exception.Message)" -ForegroundColor Red; exit 4 }
  }
  if ($hasCases) {
    Write-Host '[Start-JW] ✓ 已有十案例：保留当前检查点和用户办理历史，不重复播种'
  } elseif (($Stack -eq "v05") -and (Test-Path $initScript)) {
    Write-Host "[Start-JW] i 首次完整十案例准备（新批次保留旧历史，不直写结果表）"
    $seedRun = 'v05-' + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    & $node "scripts/ten-case-init.mjs" --batch checkpoint --run $seedRun
    if ($LASTEXITCODE -ne 0) { Write-Host "[Start-JW] ✗ 十案例初始化失败，演示尚未就绪" -ForegroundColor Red; exit 6 }
  } elseif (Test-Path $initScriptLegacy) {
    if (-not (Test-Path $materialsAbs)) { Write-Host "[Start-JW] ⚠ 跳过演示初始化：材料未就绪（$($S.Materials)）" -ForegroundColor Yellow }
    else {
      Write-Host "[Start-JW] i 演示数据初始化（demo-init，幂等）"
      & $node "scripts/demo-init.mjs" --materials $materialsAbs
      if ($LASTEXITCODE -ne 0) { Write-Host "[Start-JW] ⚠ demo-init 非零退出（见上方日志）" -ForegroundColor Yellow }
    }
  } else {
    Write-Host "[Start-JW] ⚠ 跳过演示初始化：初始化脚本不存在" -ForegroundColor Yellow
  }
} finally { Pop-Location }

# 6) 真实就绪验证（聚合探测 + 版本 + 登录冒烟）
$deadline = (Get-Date).AddSeconds(60)
$ready = $null
while ((Get-Date) -lt $deadline) {
  $ready = Get-EdgeReady -Port $S.EdgePort
  if ($ready -and $ready.ok) { break }
  Start-Sleep -Seconds 2
}
if (-not ($ready -and $ready.ok)) {
  Write-Host "[Start-JW] ✗ 就绪未达成（60s）：这不是静态预览，聚合就绪探测未通过。逐依赖原因：" -ForegroundColor Red
  if ($ready -and $ready.checks) { foreach ($c in $ready.checks) { if (-not $c.ok) { Write-Host ("  - {0}: NOT-OK" -f $c.name) } } }
  exit 3
}
Write-Host "[Start-JW] ✓ 聚合就绪通过（kernel/db/connectors/channel 真实探测）"
$ver = Get-EdgeVersion -Port $S.EdgePort
if ($ver -and $ver.buildId) { Write-Host "[Start-JW] ✓ 版本封存: build=$($ver.buildId) contract=$($ver.contractVersion)" }

# 登录冒烟（受控目录会话交换 + 目录读；只读，不触发业务）
try {
  $sess = Invoke-RestMethod -Uri "$EdgeUrl/api/jw/v2/session" -Method Post -ContentType "application/json" -Body '{"principalId":"biz1"}' -TimeoutSec 8
  $sid = $sess.session.sessionId
  $caseDirectory = Invoke-RestMethod -Uri "$EdgeUrl/api/jw/v2/arrow-cases" -Headers @{ 'x-jw-session'=$sid; 'Origin'=$EdgeUrl } -TimeoutSec 8
  if (-not $caseDirectory.ok -or ($Stack -eq 'v05' -and @($caseDirectory.cases).Count -ne 10)) { throw '授权案例目录未就绪' }
  Write-Host "[Start-JW] ✓ 登录与授权案例目录读取通过（$(@($caseDirectory.cases).Count) 例）"
} catch {
  Write-Host "[Start-JW] ✗ 登录冒烟失败: $($_.Exception.Message)" -ForegroundColor Red
  exit 4
}

Write-Host ""
Write-Host "==== JW 已就绪: $EdgeUrl ====" -ForegroundColor Green
Write-Host "    停止: powershell -NoProfile -ExecutionPolicy Bypass -File Start-JW.ps1 -Stack $Stack -Stop$(if ($WithDb) {' -WithDb'})"
Write-Host "    状态: powershell -NoProfile -ExecutionPolicy Bypass -File Start-JW.ps1 -Stack $Stack -Status"
if (-not $NoBrowser) {
  Start-Process $EdgeUrl
  Write-Host "[Start-JW] 已在默认浏览器打开 $EdgeUrl"
}
