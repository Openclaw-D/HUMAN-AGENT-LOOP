# RelayOS P6 部署与运维

本文是 RelayOS P6 唯一的部署与运维说明。P6 的验收定位是：**单节点、无认证、默认 Mock connector 的演示或受控试点运行**。所有用户身份均为 `demo_unverified`。

## 1. 安全与能力边界

P6 不是生产安全版本。它没有 SSO/OAuth、生产身份认证、租户隔离、高可用、合规认证、真实 connector 或公网发布能力。默认 advisory provider 是 `mock`；当前也没有 live Z.AI 验证证据。

- 只在本机或物理与网络访问均受控的试点环境运行。
- `HOST` 默认且推荐保持 `127.0.0.1`。不要改为 `0.0.0.0`，不要建立公网入口，也不要通过防火墙放行、端口转发或反向代理扩大访问面。
- 服务没有认证。任何能够访问端口的人都应被视为拥有演示系统的完整 API 访问权。
- P6 只允许 `RELAYOS_CONNECTOR=mock`。真实外部系统副作用没有交付。
- Z.AI General runtime 唯一允许的 secret 名是 `RELAYOS_ZAI_GENERAL_API_KEY`。禁止使用、复制、回退或 alias `ZAI_API_KEY`。

如果业务需要局域网访问、反向代理、SSO/OAuth、多租户、HA、真实 connector 或生产安全控制，应停止本次部署并进入新的设计与安全 Gate，不能把 P6 配置变化当作这些能力已经存在。

## 2. 安装前置与目录

要求 Windows PowerShell 和 Node.js `>=22.16.0 <23`。项目使用 Node.js ESM、`node:http` 与 `node:sqlite`，没有第三方运行依赖，因此不需要安装 npm package。

```powershell
Set-Location 'C:\Users\22673\Desktop\Anthropic\RelayOS'
node --version
npm.cmd run build
```

建议把权威数据、JSONL 日志、provider telemetry 和备份放在相互独立的目录。运行 RelayOS 的 Windows 用户必须对这些目录具有必要的读取、创建和写入权限；其他非运维用户不应获得访问权。RelayOS 会创建数据库文件的父目录，但不会替你配置 Windows ACL。

运行中的 SQLite volume 可能包含：

- `relayos.db`：权威 SQLite 数据库；
- `relayos.db-wal` 与 `relayos.db-shm`：WAL 运行时文件，进程退出并完成 checkpoint 后可能消失；
- 与数据库分开的 JSONL log 和 provider telemetry。

不要直接复制运行中的单个 `.db` 文件作为备份，也不要把 `.db-wal`、`.db-shm`、日志或 runtime secret 放进源码 checkpoint。

## 3. 配置

所有配置在启动时严格校验。无效、模糊或不兼容的配置会 fail closed，服务不会继续监听端口。

| 环境变量 | 默认值 | 约束与用途 |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | 单一 host；不得包含 scheme、port 或 path。P6 运维保持 loopback。 |
| `PORT` | `4178` | `0–65535`；`0` 仅用于自动化测试的临时端口。 |
| `CORS_ALLOWED_ORIGINS` | 本地固定端口对应的 origin | 逗号分隔的精确 allowlist；每项必须是 canonical `scheme://host:port`。 |
| `RELAYOS_DB_PATH` | `./data/relayos.db` | 权威 SQLite volume。 |
| `RELAYOS_SCENARIO_DIR` | `./scenarios` | 必须是已存在目录。 |
| `RELAYOS_PUBLIC_DIR` | `./public` | 必须是已存在目录。 |
| `RELAYOS_DEMO_MODE` | `true` | P6 只接受 `true`。 |
| `RELAYOS_CONNECTOR` | `mock` | P6 只接受 `mock`。 |
| `RELAYOS_SCHEMA_MIGRATION` | `auto` | `auto` 或 `verify-only`。 |
| `RELAYOS_HTTP_BODY_LIMIT_BYTES` | `1048576` | `1024–10485760`。 |
| `RELAYOS_SHUTDOWN_TIMEOUT_MS` | `10000` | `1000–10000`；P6 硬上限为 10 秒。 |
| `RELAYOS_CONNECTOR_DEADLINE_MS` | `5000` | `250–10000`。 |
| `RELAYOS_LOG_LEVEL` | `info` | `debug`、`info`、`warn` 或 `error`。 |
| `RELAYOS_LOG_PATH` | `-` | `-` 表示 stdout；文件路径不得与数据库或 telemetry 相同。 |
| `ADVISORY_PROVIDER` | `mock` | `mock` 或 `zai-general`；P6 没有 live Z.AI 验证。 |
| `RELAYOS_ADVISORY_FAST_DEADLINE_MS` | `8000` | `3000–30000`。 |
| `RELAYOS_ADVISORY_STANDARD_DEADLINE_MS` | `15000` | `3000–30000`。 |
| `RELAYOS_PROVIDER_BREAKER_FAILURE_THRESHOLD` | `5` | `1–100`；窗口内 transient failure 达到该值时打开。 |
| `RELAYOS_PROVIDER_BREAKER_WINDOW_MS` | `60000` | `1000–600000`；transient failure 统计窗口。 |
| `RELAYOS_PROVIDER_BREAKER_OPEN_MS` | `30000` | `1000–600000`；breaker 打开时长。 |
| `RELAYOS_PROVIDER_TELEMETRY_PATH` | `:memory:` | 如落盘，必须与权威数据库分离。 |
| `RELAYOS_ZAI_GENERAL_API_KEY` | 无 | 仅在显式选择 `zai-general` 时必需；不能记录或备份。 |
| `RELAYOS_ZAI_GENERAL_BASE_URL` | Z.AI 官方 General API endpoint | 实现只接受官方 `https://api.z.ai/api/paas/v4/`。 |
| `RELAYOS_ZAI_GENERAL_MODEL` | `glm-5.3` | P6 只接受 `glm-5.3`。 |

显式空值、未知 `RELAYOS_*` 变量和拼写错误都会拒绝启动；需要默认值时应省略该变量，而不是设置为空字符串。

### Origin/CORS 规则

Origin 必须精确到 scheme、host 和 port，例如 `http://127.0.0.1:4178`。不支持 `*`、`null`、省略 port、path、query、fragment、credentials、通配 host 或重复项目。foreign 或 malformed Origin 会在读取 request body 前拒绝，因此不会产生权威写入。

默认 `HOST=127.0.0.1`、`PORT=4178` 时，可以不设置 `CORS_ALLOWED_ORIGINS`，服务会得到本地固定 Origin。若显式设置：

```powershell
$env:CORS_ALLOWED_ORIGINS = 'http://127.0.0.1:4178'
```

`http://localhost:4178` 与 `http://127.0.0.1:4178` 是不同 Origin；只配置实际使用的精确值。命令行健康检查没有浏览器 Origin，不需要额外放宽 CORS。

## 4. Windows PowerShell 前台启动与停止

首次启动会在全新路径初始化当前 schema；已有兼容数据库会先验证并按配置决定是否迁移。SQLite 使用 WAL，readiness 会校验规范化 DDL 指纹、migration ledger、event chain、command receipts、projection 与数据库完整性；即使 DDL 看似等价但不属于当前 binary 的已知 schema，也会 fail closed，必须走显式 migration。

```powershell
Set-Location 'C:\Users\22673\Desktop\Anthropic\RelayOS'

$env:HOST = '127.0.0.1'
$env:PORT = '4178'
$env:RELAYOS_DB_PATH = 'C:\RelayOS\data\relayos.db'
$env:RELAYOS_LOG_PATH = 'C:\RelayOS\logs\relayos.jsonl'
$env:RELAYOS_DEMO_MODE = 'true'
$env:RELAYOS_CONNECTOR = 'mock'
$env:ADVISORY_PROVIDER = 'mock'
$env:RELAYOS_SCHEMA_MIGRATION = 'auto'

npm.cmd start
```

保持此 PowerShell 窗口为前台运行窗口。停止时在同一窗口按 `Ctrl+C`。`SIGINT` 与 `SIGTERM` 共用同一条 shutdown path：停止 listener、拒绝新请求、处理或保守终止 in-flight 工作、执行 WAL `TRUNCATE` checkpoint，并关闭 SQLite、telemetry 和 logger；总时间不能超过 10 秒。

不要用 Task Manager、`Stop-Process -Force` 或直接关闭控制台窗口替代优雅停止。Windows 上这类终止可能成为进程崩溃语义，只能依赖 SQLite 的事务/WAL 恢复，而不会完成应用层 drain。

P6 不安装 Windows Service、计划任务，也不改变防火墙或机器全局配置。

## 5. 健康检查与运行判断

```powershell
Invoke-RestMethod 'http://127.0.0.1:4178/health/live'
Invoke-RestMethod 'http://127.0.0.1:4178/health/ready' | ConvertTo-Json -Depth 10
```

- `/health/live` 证明 HTTP 进程正在响应，不证明数据链、connector 或 advisory 可用。
- `/health/ready` 以权威 SQLite 内核为核心 readiness。数据库、schema、event chain 或 projection 异常时返回 HTTP 503。
- `connector`、`advisoryProvider` 和 `observability` 会分别报告状态。advisory breaker 打开或 log sink 失败会诚实显示 degraded，但不会把 deterministic read/command 的结果改写成失败。
- 无认证状态会显示 `identityAssurance=demo_unverified` 或 `authentication.status=not_implemented`；这是预期安全边界，不是认证已完成。

启动后至少确认：监听地址仍为 `127.0.0.1`、readiness 的 `persistence.status=ready`、`journalMode=wal`、schema version 与当前 binary 匹配。重启后再次检查 WorkCase、receipt 与相同 idempotency key 的结果仍可查询。

## 6. JSONL 日志与 telemetry

JSONL 每行是一个独立 JSON record。核心字段包括时间、level、service/version、event、traceId（适用时）、component/operation、authority、resultStatus、latency、errorCode，以及最小化的 command/work-case/event/receipt 关联标识。一次请求可用 `traceId` 串联 HTTP、provider/adapter 与 domain/event/receipt。

日志实现采用字段 allowlist，并不得记录：

- `Authorization`、cookie、API key、password、token 或其他 credential；
- 完整 prompt、provider response 或敏感业务 payload；
- SQLite 行内容或数据库文件；
- `RELAYOS_ZAI_GENERAL_API_KEY` 的值。

log sink 写失败不会改变已确定的 domain 结果；它会通过 readiness 的 `observability.status=degraded` 暴露。出现 degraded 时先修复目录权限、磁盘空间或目标路径，然后再次发起无副作用的健康检查。不要通过临时记录 payload 或 secret 来调试。

Provider telemetry 是非权威数据，必须与 SQLite volume 分离。`ADVISORY_PROVIDER=mock` 是 P6 默认与已验收路径；没有 `RELAYOS_ZAI_GENERAL_API_KEY` 时选择 `zai-general` 会 fail closed。

## 7. 在线备份与全新路径恢复

### 7.1 创建一致性备份

备份使用 `node:sqlite.backup` 的在线一致性机制，并验证备份数据库。它不是对活动 `.db` 的单文件直接复制。backup 与 manifest 目标都必须是全新路径：

```powershell
Set-Location 'C:\Users\22673\Desktop\Anthropic\RelayOS'

npm.cmd run ops:backup -- `
  --db 'C:\RelayOS\data\relayos.db' `
  --backup 'D:\RelayOS-backups\relayos-20260826.db' `
  --manifest 'D:\RelayOS-backups\relayos-20260826.manifest.json'
```

manifest 包含 backup SHA-256、schema version、event/stream/projection/receipt/idempotency counts 与 digests、所有 WorkCase canonical hashes，以及 `secretMaterial=excluded`。它不包含 runtime secret、日志或数据库业务 payload。

每次备份后都应把 `.db` 与 manifest 作为一对保存，限制访问权限，并执行一次恢复演练。不要修改 manifest，也不要复用已有目标文件名。

### 7.2 恢复到新路径

恢复不会覆盖现有数据库。目标必须不存在；工具会先验证 manifest 和 backup SHA-256，再复制并用当前 binary 验证 schema、BusinessEvent chain、projection、receipt、idempotency 与 canonical hashes。

```powershell
npm.cmd run ops:restore -- `
  --backup 'D:\RelayOS-backups\relayos-20260826.db' `
  --manifest 'D:\RelayOS-backups\relayos-20260826.manifest.json' `
  --target 'C:\RelayOS\restore-drill\relayos-restored.db'
```

验证成功后，先停止当前 RelayOS，再把 `RELAYOS_DB_PATH` 指向已验证的新路径并以前台方式启动。确认 `/health/ready` 后再进行只读业务检查。原数据库保持不动，直到人工验收完成。

恢复失败时不要删除或覆盖源 backup；保留错误 code，并检查 SHA-256、manifest/backup 是否配对、目标是否确实不存在、当前 binary 是否支持该 schema。

## 8. 升级、migration 与 rollback

P6 没有向下 migration。任何升级都按以下顺序执行：

1. 用当前 binary 创建一致性备份，并真实恢复到一个全新路径完成演练。
2. 保存与该 backup schema 兼容的旧 binary/source checkpoint、backup 和 manifest。
3. 用 `Ctrl+C` 优雅停止旧进程，确认端口不再监听。
4. 切换到新 source；不要改写或删除旧数据库与备份。
5. 可先用 `RELAYOS_SCHEMA_MIGRATION=verify-only` 检查：schema 已匹配则启动，空库或需要 migration 时会拒绝并明确报错，不会初始化或迁移。
6. 需要执行受支持 migration 时，改为 `RELAYOS_SCHEMA_MIGRATION=auto` 并启动。migration 在事务中执行；中途失败会原子回滚并拒绝启动。
7. 检查 `/health/ready`、schema history、event/projection/receipt/idempotency 与 canonical hash 证据，再接受新版本。

旧 binary 必须拒绝更高版本 schema；未来或过旧 schema 也会 fail closed。不要尝试让旧 binary 对已升级数据库继续写入。

如果要 rollback：停止新进程，使用与旧 binary/schema 兼容的升级前 backup 恢复到另一个全新路径，然后让旧 binary 指向该路径。不要原地降级 schema，不要把新 binary 产生的数据手工搬回旧 schema。若升级后的业务写入需要保留，必须先停止并进行单独的数据迁移设计与人工决策，不能在 P6 运维步骤中猜测合并。

## 9. 故障排查

| 现象或 error code | 运维判断与处理 |
| --- | --- |
| `RUNTIME_CONFIGURATION_INVALID` / `CORS_CONFIGURATION_INVALID` | 检查拼写、范围、目录是否存在，以及 CORS 是否为精确 `scheme://host:port`；不要用 `*` 绕过。 |
| `ORIGIN_DENIED` | 请求 Origin 不在 allowlist 或格式不合法。修正调用端或精确 allowlist；拒绝发生在 body 读取和权威写入前。 |
| `SCHEMA_INITIALIZATION_REQUIRED` / `SCHEMA_MIGRATION_REQUIRED` | 当前是 `verify-only`；确认数据库路径和升级计划后，才决定是否使用 `auto`。 |
| `SCHEMA_VERSION_FUTURE` / `SCHEMA_VERSION_TOO_OLD` | binary 与数据库不兼容。停止重试写入，选择匹配 binary 或从兼容 backup 恢复。 |
| `SCHEMA_SHAPE_INVALID` / `SCHEMA_MIGRATION_HISTORY_INVALID` | DDL 语义或 migration ledger 不属于当前 binary 的精确已知状态。停止写入，不要手工修表；从匹配的 checkpoint/backup 恢复或设计显式 migration。 |
| `SCHEMA_MIGRATION_FAILED` | migration 已回滚并拒绝启动。保留数据库与日志摘要，回到升级前 backup/checkpoint 排查。 |
| readiness persistence 为 error | 停止写入，保留数据库文件集，检查磁盘、权限、SQLite integrity、event chain 与 projection 证据。不要手改 SQLite。 |
| advisory/provider degraded | 核心 deterministic read/command 可继续；建议结果不可当权威。P6 默认切回并验证 `mock`，不要声称 live Z.AI 可用。 |
| connector degraded 或 receipt 为 `unknown` | 不得把 unknown 标成 succeeded。先按 actionIntent/idempotency 查询持久化 receipt；相同 idempotency retry 应返回原记录，不重复副作用。P6 仍只支持 Mock connector。 |
| observability degraded / `LOG_SINK_FAILED` | 修复日志目录权限、路径或磁盘空间。domain 结果不因 sink 失败而回滚或重做。 |
| `SHUTDOWN_TIMEOUT` | 10 秒内未完成 drain。记录 pending action intent IDs；不要把 connector 不确定结果改为成功，重启后先查 receipt 与 readiness。 |
| backup/restore hash 或 audit mismatch | 停止使用该副本；确认 backup/manifest 配对，重新从健康源创建全新备份并恢复演练。 |

## 10. 临时测试数据清理

自动化 smoke 使用临时端口和临时目录，正常结束会自行清理。测试被中断时，先确认对应 RelayOS 子进程已经停止，再只清理已明确识别的临时目录。下面示例只针对指定的 `%TEMP%\relayos-p6-ops-manual`，并先验证目标仍位于系统 TEMP 下：

```powershell
$relayTemp = [IO.Path]::GetFullPath((Join-Path $env:TEMP 'relayos-p6-ops-manual'))
$tempRoot = [IO.Path]::GetFullPath($env:TEMP)

if ($relayTemp.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and
    (Test-Path -LiteralPath $relayTemp)) {
  Remove-Item -LiteralPath $relayTemp -Recurse -Force
}
```

不要把正式 `RELAYOS_DB_PATH`、备份目录、源码根目录或不确定路径代入递归删除命令。测试清理不应触碰当前用户可见服务、系统服务、防火墙、计划任务或机器全局配置。
