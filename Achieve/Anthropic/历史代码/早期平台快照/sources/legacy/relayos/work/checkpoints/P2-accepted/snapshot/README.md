# RelayOS P2

RelayOS 当前交付的是 **P2 确定性 event-sourced 后端内核**：一个单进程、单节点、离线可运行的 continuity control plane / Accepted Handoff Ledger。`WorkCase` 是唯一业务聚合根；SQLite `BusinessEvent` 是权威来源；查询投影可删除并从事件完整重建。

## 当前真实能力

- Node.js ESM、`node:http`、内置 `node:sqlite`、SQLite WAL；零第三方依赖。
- per-WorkCase stream optimistic concurrency；成功 command receipt 在 stale version 检查之前命中。
- append-only typed event、stream/global sequence、schema version、canonical payload hash、per-stream previous-event hash 和 event hash。
- event append、stream/projection update、成功 command receipt 在同一 `BEGIN IMMEDIATE` 事务中提交或回滚。
- `Trigger`、`GoalVersion`、`Evidence`、`ContextVersion`、temporal `AuthorityGrant`、Accepted Handoff、具名 `HumanGate`、`ActionIntent/ExecutionReceipt`、Exception/Escalation、三类 `MetricObservation` 的 P2 最小状态。
- 明确区分 `HumanPrincipal`、`RoutableAgent`、`ExternalSystem`、`ControlObject`。Agent owner 必须关联具名 accountable human；Agent/system/control object 不能解决 Human Gate。
- `MockExternalSystemAdapter` 返回明确的 `succeeded`、`failed`、`unknown` 或 `rejected` receipt；HTTP/业务状态不会把 unknown/failed 推断为成功。
- 同源默认、精确 Origin allowlist、Origin-before-body、1 MiB 默认 body limit、统一错误 envelope、live/readiness、SIGINT/SIGTERM 关闭基线。
- 三个代表性场景配置（金融、供应链、企业自动化）使用同一 kernel/command handler；未知 core/extension 字段 fail closed。

## 运行

要求 Node.js `>=22.5.0`，当前验收运行时为 Node 22。无需 `npm install`。

```powershell
cd C:\Users\22673\Desktop\Anthropic\RelayOS
npm.cmd start
```

默认监听 `127.0.0.1:4178`，不会占用旧 P0 可能使用的 `127.0.0.1:4177`。默认数据库为 `./data/relayos.db`；运行时目录不进入 P2 accepted manifest。

可配置的 P2 环境变量：

- `HOST`：默认 `127.0.0.1`。
- `PORT`：默认 `4178`；测试和 smoke 使用 port `0`。
- `RELAYOS_DB_PATH`：SQLite 文件路径。
- `RELAYOS_SCENARIO_DIR`：场景配置目录，默认 `./scenarios`。
- `CORS_ALLOWED_ORIGINS`：逗号分隔的精确 `scheme://host:port` allowlist；禁止 `*`。

P2 不需要 API key，也不读取或创建 `.env`。

## API

- `GET /health/live`
- `GET /health/ready`
- `GET /api/scenarios`
- `GET /api/work-cases`
- `GET /api/work-cases/{id}`
- `GET /api/work-cases/{id}/events?after={globalSequence}`
- `GET /api/work-cases/{id}/replay`
- `POST /api/work-cases`
- `POST /api/work-cases/{id}/commands`

所有写入 envelope 必须包含 `commandId`、`idempotencyKey`、`expectedStreamVersion`、`configurationVersion`、`commandType`、`demoActorRef`、`identityAssurance` 和 `payload`。P2 只接受并在 command/event/response 中保留：

```json
{ "identityAssurance": "demo_unverified" }
```

这表示“演示角色（未认证）”，不是登录、认证、生产授权或安全边界。

## 验证

P2 交付接口：

```powershell
npm.cmd test
npm.cmd run test:contract
npm.cmd run test:replay
npm.cmd run build
npm.cmd run smoke
```

测试包含：真实 SQLite/WAL 重开恢复；两个真实子进程竞争同一 expected version；三处事务故障注入全回滚；幂等优先于 stale version；payload mismatch；事件/hash chain；投影删除与 event-only rebuild；schema/hash corruption fail closed；Accepted Handoff 正反路径；具名 Human Gate/temporal grant；authority/capability/context/evidence 正交；Mock receipt 三种结果；Origin-before-body；body limit；三个场景同核与非法配置。

`npm.cmd run build` 是语法、scenario config 和零第三方 import 检查，不声称生成前端 bundle。`npm.cmd run smoke` 在自管理 port `0` 和临时数据库上执行 HTTP → domain → SQLite/WAL → replay → 关闭重开闭环。

## 明确边界

P2 **没有**实现或验证：

- Advisory Provider、Z.AI General runtime、任何真实模型调用；这些属于 P3。开发期 ZAI Coding Plan 审查也不是 RelayOS runtime provider。
- `public/**` UI 或视觉重设计；属于 P4。
- 十套富场景 fixture 或“十场景已支持”；P2 只有 3 个代表性 config，完整 10/10 压力测试属于 P5。
- 真实企业 connector、SSO/OAuth、生产认证、多租户、HA、合规认证、公网部署、生产安全。
- 企业外部系统的事实替代；RelayOS 只保存引用、版本、hash、意图与 receipt 关系。

单节点 SQLite 与无认证 demo 是当前明确运行边界。不要把 P2 用作共享网络上的生产安全服务。
