# V7 backend-next / A 路 — 目标协作内核（goal collaboration kernel）

PostgreSQL 事务存储 + 真实 HTTP API + outbox 至少一次投递。目标驱动、角色/人/Agent 分离、行业只是模板配置。
共享契约：[`../CONTRACT.md`](../CONTRACT.md)（**v1.2 FROZEN**）。状态与结果：[`STATUS.md`](STATUS.md) / [`RESULT.md`](RESULT.md)。

## 启动（依序；全部命令已验证）

```bash
# 1) PostgreSQL（Docker Desktop 需在运行；容器与数据卷均已隔离，不碰 Dify）
docker start v7next-a-pg          # 已存在（postgres:16, 127.0.0.1:15432, 卷 v7next_a_pgdata）
# 首次创建：docker run -d --name v7next-a-pg -e POSTGRES_USER=v7next -e POSTGRES_PASSWORD=v7next \
#   -e POSTGRES_DB=v7next_a -p 127.0.0.1:15432:5432 -v v7next_a_pgdata:/var/lib/postgresql/data --restart no postgres:16

# 2) 依赖（锁版；仅本包 node_modules）
cd V7/backend-next/A && npm ci    # 或 npm install

# 3) 迁移（真实 PG；幂等可重复执行）
node src/db/migrate-cli.ts

# 4) 启动内核（标准实例：48080 + outbox dispatcher + 10 个合成测试 principal）
node scripts/start-kernel.mjs              # 前台；验证：curl http://127.0.0.1:48080/healthz
# 可选参数：--port 48081（B/D 隔离实例）
```

健康检查：`{"ok":true,"db":"up","model":"not_configured","principalVerifier":"configured",...}`
（`model:"not_configured"` 是如实能力边界：GLM-5.2 仅预留接口，本轮 0 真实调用。）

## 身份凭据（合成测试 principal；请求头 `X-Principal-Credential`；服务端只存 sha256）

| credential | principal | 角色 |
|---|---|---|
| `tok-admin` | alice | admin |
| `tok-business` | bob | business+config（业务岗，可 supersede/human_led 目标执行） |
| `tok-agent` / `tok-agent2` | worker1/2 | business（agent 执行者） |
| `tok-approver` | carol | approver（验收/决定） |
| `tok-jianwei` `tok-policy` `tok-credit` `tok-commerce` `tok-asset` | jane 等 | C 模板六角色 |
| `tok-limited` | larry | 仅授权 restricted-proj-x（越权测试用） |

**不配置凭据目录时**（`node src/index.ts` 不带 `--principal-tokens`）：敏感写一律 403 `PRINCIPAL_UNTRUSTED` 失败关闭——这是安全属性，不是缺陷。

## CLI 人工介入（不模拟前端）

```bash
node scripts/goal-client.mjs --base http://127.0.0.1:48080 --token tok-business show --project <projectId>
node scripts/goal-client.mjs --token tok-agent claim --goal <goalId> --expectedVersion 2
node scripts/goal-client.mjs --token tok-approver accept --goal <goalId> --expectedVersion 4
node scripts/goal-client.mjs --token tok-agent complete --goal <id> --fencing 1 --expectedVersion 3 \
  --provider simulation --output '{"summary":"ok"}'
```

## 测试（17 集成用例，真实 PG + 黑盒 HTTP）

```bash
node test/run-all.mjs      # 自动建/删隔离测试库 v7next_a_test_*；输出 TAP
```

覆盖：完整状态机、双客户端并发领取恰一成功、过期租约 fencing 拒绝+重领、takeover fence、
同库重启持久化（目标/租约/待办/回执保留）、幂等重放与载荷一致性、终态保护、循环依赖、禁用键、
MODEL_NOT_CONFIGURED、失败关闭、failed→resume、证据取代定向失效+级联+无关项目逐字节不变、
accepted+stale/decided 保护、人工待办不冻结无关目标、项目暂停、outbox 至少一次+重投+eventId 幂等、
跨项目越权、受限 principal、审计无凭据。

## 组合验证（assembly；不修改 B/C 原件）

```bash
node assembly/e2e-compose.mjs     # A 参考模板：4 目标/2 角色/2 独立客户端端到端 + 非租赁小模板（10 步）
node assembly/run-c-plans.mjs     # C 两模板落库 + 8 份案例计划全链执行 + L1 fact_intake 闭环
```

结果：`assembly/e2e-result.json`、`assembly/c-plans-result.json`（快照在 `evidence/`）。

## 停止与恢复

```bash
# 停内核：终止 node src/index.ts 进程（数据都在 PG，直接重启无损）
# 停 PG：docker stop v7next-a-pg（恢复：docker start v7next-a-pg）
# 数据不可用时：migrations 重建 schema；业务数据持久于卷 v7next_a_pgdata
```

## 边界

- 只写 `V7/backend-next/A/**` 与共享 `CONTRACT.md`；`V7/backend/**` 与 site/V6 未触碰。
- 禁止：真实密钥、付费 API、Git 操作、公开部署。GLM-5.2 仅预留 transport 接口。
