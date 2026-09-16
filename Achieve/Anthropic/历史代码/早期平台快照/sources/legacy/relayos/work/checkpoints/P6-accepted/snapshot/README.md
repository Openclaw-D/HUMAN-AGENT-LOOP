# RelayOS P6

RelayOS P6 把已通过 P5 的 deterministic event-sourced kernel、HTTP API、AdvisoryProvider、Mock connector 与中文关系图 UI，收口为“单节点、无认证、Mock connector 默认”的演示/受控试点运行边界。

它不是生产安全版本。当前没有登录、SSO/OAuth、生产身份与权限、多租户隔离、HA、合规认证、真实 connector 或公网发布；`identityAssurance` 固定为 `demo_unverified`。本机没有独立的 `RELAYOS_ZAI_GENERAL_API_KEY`，因此没有声称 live Z.AI 已验证。

## 权威边界

P6 没有改变冻结的 domain/event/API 产品语义：

- `BusinessEvent` 是唯一权威来源，projection 可由 event-only replay 重建；
- 责任只在 `Accepted Handoff` 后转移；
- 受保护动作必须经过具名 `Human Gate`；
- provider 始终 `authority=none`，失败不能产生权威写入；
- connector 结果不确定时持久化 `ExecutionReceipt.status=unknown`，不能标记为 `succeeded`；
- 相同 idempotency retry 返回持久化结果，不重复调用 connector。

P5 的十场景仍使用同一套 kernel/API/UI，仅由 versioned config 和去标识化 fixture 参数化。P5 Gate 证据见 [P5_ACCEPTANCE.md](P5_ACCEPTANCE.md) 与 [P5_VISUAL_ACCEPTANCE.md](P5_VISUAL_ACCEPTANCE.md)。

## 最小启动

要求 Node.js `>=22.16.0 <23`。项目只有 Node 内置依赖，无需 `npm install`。默认监听 `127.0.0.1:4178`，默认 SQLite volume 是 `./data/relayos.db`，默认 provider 与 connector 都是 `mock`。

```powershell
cd C:\Users\22673\Desktop\Anthropic\RelayOS
$env:HOST = '127.0.0.1'
$env:PORT = '4178'
$env:RELAYOS_DB_PATH = 'C:\Users\22673\Desktop\Anthropic\RelayOS\data\relayos.db'
$env:ADVISORY_PROVIDER = 'mock'
$env:RELAYOS_CONNECTOR = 'mock'
$env:RELAYOS_DEMO_MODE = 'true'
npm.cmd start
```

无数据库时会事务性创建当前 schema；已有兼容数据库会先校验或执行受控 migration，再进入 WAL 模式。停止请在前台窗口按 `Ctrl+C`，服务使用同一条 10 秒 shutdown path 停 listener、处理 in-flight、checkpoint WAL 并关闭 SQLite/telemetry/log。完整配置、CORS、日志、备份/恢复、升级/rollback 和故障排查只在 [OPS.md](OPS.md) 维护。

## 健康检查

```powershell
Invoke-RestMethod http://127.0.0.1:4178/health/live
Invoke-RestMethod http://127.0.0.1:4178/health/ready
```

`/health/ready` 分开报告 persistence、Mock connector、advisory provider 与 observability。provider 或 log sink degraded 不会被伪装为 ready，也不会把健康的 deterministic core 整体标成宕机。

## Gate 验证

```powershell
npm.cmd run test:ops
npm.cmd run smoke:restart
npm.cmd run smoke:backup-restore
npm.cmd run test:replay
npm.cmd run test:scenarios
npm.cmd run test:provider
npm.cmd run test:frontend
npm.cmd run smoke:integration
npm.cmd test
npm.cmd run build
```

P6 验收记录见 [P6_ACCEPTANCE.md](P6_ACCEPTANCE.md)。通过 Gate 后的只读核验命令：

```powershell
npm.cmd run verify:checkpoint:p5
npm.cmd run verify:checkpoint:p6
```

`checkpoint:p6` 会复制 accepted source/config/test/doc/ops 到 `work/checkpoints/P6-accepted/snapshot`，生成逐文件 SHA-256 manifest，并拒绝 DB/WAL/SHM/log/credential material。不要再次运行 `checkpoint:p5`；P5 accepted snapshot 是 migration 前固定的代码 rollback baseline。

## 明确边界

- `HOST` 默认且推荐 `127.0.0.1`；不得把本版本直接暴露到局域网或公网。
- CORS 只接受精确 `scheme://host:port` allowlist，不支持 `*`。
- runtime secret 只允许 `RELAYOS_ZAI_GENERAL_API_KEY`；禁止读取、复制或 alias 开发期 `ZAI_API_KEY`。
- P6 没有验证真实 connector、live Z.AI、生产认证、HA、灾备 RTO/RPO、外部监控平台或 POSIX 主机上的 literal `SIGTERM`。
- Windows 会把对 Node 子进程的操作系统 `SIGTERM` 当成不可捕获终止；本机验收分别验证了真实强制终止后的 SQLite 原子恢复，以及真实子进程经 IPC 进入同一生产 `SIGTERM` shutdown entry 的优雅关闭。不能把后者写成 literal POSIX signal 验证。
- P6 完成后停止，不进入 P7，也不切换或污染用户可见的 `127.0.0.1:4177` P4 回滚服务。
