# RelayOS P6 Gate 验收记录

## 结论

P6“部署、运维、安全边界与可观测性交付”通过本地 Gate：RelayOS 已达到 **单节点、无认证、默认 Mock connector 的演示/受控试点接近部署可运行** 边界。默认只监听 `127.0.0.1`，配置、Origin/CORS、SQLite schema、backup/restore、shutdown、JSONL observability 与去敏均 fail closed 或按冻结权威边界降级。

这不是生产安全版本。P6 没有实现或声称 SSO/OAuth、生产身份安全、多租户隔离、高可用、合规认证、公网发布或真实 connector。所有用户身份仍为 `demo_unverified`。本机没有独立 runtime key，live Z.AI General 未验证且不声称已验证。冻结 domain、BusinessEvent、API 与十场景产品语义没有改变；本 Gate 到 P6 停止，不进入 P7。

## 运行与配置边界

- 实际验收 runtime：Node `22.23.1`；支持范围固定为 `>=22.16.0 <23`；第三方 runtime dependency 为 0。
- `HOST` 默认 `127.0.0.1`，`PORT` 默认 `4178`；所有 P6 child/smoke 都请求 port `0` 并逐实例确认实际端口不是 `4177`。
- 数据目录、SQLite path、scenario/public path、JSONL log、provider telemetry、provider deadline/circuit breaker、connector、CORS、schema migration mode 与 10 秒 shutdown 均有显式配置和严格范围校验。空值、科学计数、符号、小数、未知 `RELAYOS_*`、模糊 Origin、非 canonical host/URL 与不支持模式会拒绝启动。
- provider 默认 `mock`，connector 只允许 `mock`，demo mode 必须为 `true`。runtime secret 唯一允许名称是 `RELAYOS_ZAI_GENERAL_API_KEY`；实现不读取、复制或 alias 开发期 `ZAI_API_KEY`。
- fresh DB 会事务性创建 schema v2；兼容 v1 会先精确校验再原子迁移；已有 v2 会验证后进入 WAL。`/health/ready` 诚实报告 persistence、connector、advisory 与 observability。

完整、唯一的部署与运维说明是 [OPS.md](OPS.md)。README 只保留最小启动、健康检查、Gate 命令与边界入口，避免重复运维文档。

## HTTP、Origin/CORS 与静态文件

- CORS allowlist 精确到 `scheme://host:port`，不支持 `*`；`localhost` 与 `127.0.0.1` 不混同。
- foreign、malformed、带 path、Host-spoofed Origin 在 request body 读取前拒绝；测试断言 body read 为 0、authority write 为 0。
- 无 Origin 的本地非浏览器健康检查不会依赖可伪造的 `Host` header 放宽浏览器 Origin。
- body limit、invalid/primitive JSON、业务错误使用统一 error envelope；raw/encoded traversal、反斜杠、NUL、dot segment 与 realpath 越界全部 fail closed。

## 10 秒 shutdown 与 in-flight 证据

`SIGINT`、`SIGTERM` 与测试 IPC 入口共用同一 production shutdown function。listener 先停止接受新请求，provider/connector 收到 abort，operation tracker drain 后执行 `TRUNCATE` WAL checkpoint，并关闭 SQLite、advisory telemetry 与 logger；hard deadline 到达会 best-effort 关闭后以非 0 进程状态退出，不能报告成功。

`npm.cmd run smoke:restart` 在真实 Node child 上得到：

- fresh DB 与第二次重启均 readiness `ready`、schema v2、journal mode `wal`，state/canonical hash 持久；默认 host 为 `127.0.0.1`。
- 正常 slow-body request 返回 HTTP `201` 后关闭，未丢失 command。
- in-flight transaction 结果为完整 commit；本机观测 shutdown wall time `361ms`，没有部分写。
- in-flight provider 返回 HTTP `503 / ADVISORY_UNAVAILABLE`，权威写入 `0`。
- in-flight connector 持久化 `ExecutionReceipt.status=unknown`、`completedAt=null`；重启后可查询，相同 idempotency retry 的 connector 调用数为 `0`。
- Windows 对 child 的操作系统 `SIGTERM` 是不可捕获终止；真实强制终止发生在 transaction 内时，重启审计为完整 rollback：streams/events/projections/receipts 全为 `0`。
- 另一个 non-cooperative production child 在 hard timeout 测试中约 `1.15s` 以 code `1` 退出；不会因残留 handle 假装 graceful success。
- 成功停止消息逐项确认 WAL checkpoint `busy=0`、store/advisory/logger closed。新请求在 drain 期间被拒绝，body read 与 authority write 都为 `0`。
- 10 个临时 JSONL、68 条记录完成去敏扫描，secret/credential/prompt/response 命中 `0`；临时 DB/WAL/SHM/log 目录随后删除。

Windows 上的 graceful child 证据是“真实 child 经 IPC 进入同一 production `SIGTERM` shutdown entry”，不能解释为 literal POSIX `SIGTERM`。POSIX 主机上的 literal signal 仍未验证。

## Backup、restore、migration 与 rollback

备份使用 `node:sqlite.backup` 在线一致性 API，而不是复制活动中的单个 `.db`。backup 与 manifest 先写唯一 staging、用当前 binary 做 schema/readiness/audit 验证并 checkpoint，再以全新路径发布；所有失败路径 best-effort 删除 staging 与不完整 final。restore 先验证 manifest 与 source SHA-256，再复制到唯一 staging、复验 copy SHA、schema、event/receipt/projection/idempotency 与 canonical hashes，最后才发布到全新路径。

最终 retained evidence 位于 `work/checkpoints/P6-accepted/backup-restore-evidence.manifest.json`，文件 SHA-256 为 `ABD98DA87834E73205FB1DE44724F8E922D1D30254A080A83E697F9960AE6A6E`。它不包含 runtime DB、WAL/SHM、日志或 secret。真实恢复证据：

| 字段 | 结果 |
|---|---|
| creation method | `node:sqlite.backup-online-consistent` |
| backup manifest SHA-256 | `00cf5ed2e3e27a0eed65c512c3c9e402add07c7c9bca8e10f75f7ac814c4dc84` |
| backup database SHA-256 | `e923cc16a29940b3d4121fc45d59ae57597718971b4fd9f514297bb384c53f1c` |
| schema/counts | v2；20 streams；480 events；20 projections；440 command receipts |
| event chain digest | `45f8b753c9a8583af7c2aa589576fd73fe819dccf4d1bafce11a749be40d763b` |
| projection digest | `958c30bd5eeafde65581c49f661baed056a2a901582ff473ba1b6fa7b9e207f1` |
| receipt digest | `ef8995563302bee618c4183f058dbdccb28a5b79771680ea8a754fe10795c941` |
| idempotency digest | `2224655665c5cac9d9b1d3940a2f70dca713b635e65333aac2baf03763334768` |
| canonical/replay | 20 WorkCase hashes retained；20/20 rebuild；0 mismatch |
| unknown retry | persisted unknown；connector calls 0；audit unchanged |
| artifact scan | 6 temp files；sentinel 0；credential pattern 0；runtime DB/log retained=false |

Evidence 还绑定 `backup.js`、credential scanner、event store、schema 与 backup smoke 的 5 个 exact source SHA-256，防止 scanner 或恢复实现改变后复用旧结果。

Migration Gate 真实覆盖：兼容 P5 v1 → v2 成功且 canonical state/hash 不变；DDL 后与 version update 后两个注入故障均整事务回滚；partial v1、未知 schema object、缺 version、过旧、future schema、旧 binary 打开 v2 全部拒绝。规范化 `sqlite_schema.sql` 精确指纹覆盖 `CHECK`、`DEFERRABLE` 与显式 index order；删改这些语义会在 migration 写前拒绝。v2 migration ledger 必须恰好记录 `schema-1-to-2 / 1→2`，删除、改 ID 或增加歧义记录都会使 startup/readiness fail closed。P6 没有向下 migration；rollback 使用 P5 accepted code checkpoint 与匹配的升级前 backup 恢复到新路径，禁止原地降级。

## 结构化可观测性

- JSONL schema 使用 allowlisted fields，`traceId` 串联 HTTP → provider/adapter → domain/event/receipt；记录 level、component、operation、authority/result、latency、HTTP/error code 与 degraded 状态，不记录完整业务 payload。
- nested sensitive key 会递归丢弃；所有 string field 都复用 credential scanner。Bearer/Basic、JWT、GitHub/Google/AWS key、private key、quoted/unquoted credential assignment 与常见 secret key 形态有正例测试；完整 accepted source 扫描为 0 false positive。
- log/telemetry sink 失败不改变 domain result，readiness 以 `observability.status=degraded` 暴露且保持 sticky failure count。
- provider circuit open/half-open 时 advisory 标记 degraded；核心 read 与 deterministic command 仍可用，provider 始终 `authority=none`。

## 自动化 Gate 真实结果

2026-08-26 在 Windows、Node `22.23.1`、Mock provider、Mock connector、临时 SQLite 与 port `0` 上执行：

| 命令 | 结果摘要 |
|---|---|
| `npm.cmd run test:ops` | PASS；31/31；配置、Origin-before-body、shutdown、backup/migration、observability/scanner |
| `npm.cmd run smoke:restart` | PASS；fresh/restart/WAL、四类 in-flight、unknown retry、Windows crash recovery、log scan 0 |
| `npm.cmd run smoke:backup-restore -- --evidence work\checkpoints\P6-accepted\backup-restore-evidence.manifest.json` | PASS；20 streams、480 events、20 projections、440 receipts、20/20 replay、scan 0 |
| `npm.cmd run test:replay` | PASS；25/25 |
| `npm.cmd run test:scenarios` | PASS；2/2；P5 10/10；480 events；20/20 replay；scenario branches 0 |
| `npm.cmd run test:provider` | PASS；19 tests：18 pass、1 live Z.AI skip、0 fail |
| `npm.cmd run test:frontend` | PASS；13/13；P4/P5 UI contract 未回退 |
| `npm.cmd run smoke:integration` | PASS；P5 10/10；480 events；20/20 replay |
| `npm.cmd test` | PASS；109 tests：108 pass、1 live Z.AI skip、0 fail |
| `npm.cmd run build` | PASS；57 JS/ESM、10 configs、10 deidentified fixtures、5 static assets；0 third-party import |

GLM-5.3 本 Gate 未重复调用：上次 P5 transport 在模型开始前失败的原因没有先得到确认，且本轮安全/暴露/最终 Gate 判断不适合委派。三路内部只读复审分别覆盖 HTTP/ops、persistence/migration/backup 与 tests/checkpoint；所有复现 blocker 修复后均回报 PASS，最终验收仍由主 Codex 的本地命令完成。

## Checkpoint 与回滚边界

P5 accepted snapshot 已再次只读验证为 `89/89`，`missing=0 / extra=0 / mismatch=0 / forbidden=0`，manifest SHA-256 保持 `5D1A99CB23085D3CD3B0689812CEA3B3D4595C0B5375F4CEA31AC285631A21A3`。

P6 checkpoint creator 只接受本文件、冻结契约、P5 acceptance、README/package、`src/**`、`scenarios/**`、`public/**`、`scripts/**`、`test/**` 与 `OPS.md`；逐文件复制到 `work/checkpoints/P6-accepted/snapshot` 并生成 SHA-256 manifest。它拒绝 DB/WAL/SHM/journal/log/JSONL、`.env`、key/token/credential material、symlink/junction 越界及 source/snapshot mismatch，accepted snapshot 创建后默认 immutable。最终 file count、manifest hash 与独立 0-clean 结果以同目录 `SNAPSHOT_INFO.json` 为准，避免验收文档自引用形成 hash 循环。

用户可见的 `127.0.0.1:4177` P4 回滚进程始终由原 PID `22464` 运行；P6 没有停止、替换或污染它，也没有切换最终服务。

## 未验证与剩余限制

- live Z.AI General API 未验证；没有读取开发期 key，也没有网络调用证据。
- 真实 connector、真实外部副作用与生产 retry/reconciliation 未验证；只有 Mock contract 与 unknown/failed/succeeded 行为。
- 登录、SSO/OAuth、生产身份/权限、多租户、HA、合规、公网、系统服务、防火墙、反向代理、外部监控与真实灾备 RTO/RPO 未实现或部署。
- POSIX 主机 literal `SIGTERM` 未验证；Windows 证据边界如上。
- DDL fingerprint 刻意采用严格 syntactic fail-closed；任何等价但未知的 DDL 也必须通过显式 migration 接受。
- 极端文件系统锁定/权限故障下 staging 删除只能 best-effort；工具会拒绝发布不完整 final，但运维仍需按 `OPS.md` 检查并人工清理残留。
- 未执行公网部署、未改防火墙/计划任务/系统服务/全局配置，未进入 P7。
