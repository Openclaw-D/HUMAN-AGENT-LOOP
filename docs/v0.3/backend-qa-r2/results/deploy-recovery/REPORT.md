# backend-qa-r2 · deploy-recovery 专项测试报告

- 任务书：`docs/v0.3/backend-qa-r2/04_DEPLOY_RECOVERY.md`
- 执行：ZCode，2026-09-21，串行单包；产品源码与既有测试只读
- 运行命令（独立可重跑）：`node docs/v0.3/backend-qa-r2/results/deploy-recovery/test/run-deploy-recovery.mjs`
- 本轮退出码：**1**（35 通过 / 1 失败 / 0 跳过 / 0 不适用；唯一失败为产品缺陷，非环境阻点）

## 结论（TL;DR）

现有后端启动/停止入口在隔离环境中**可按 PG→A→Connectors→Edge 依赖顺序冷启动**（8.1s），**受控停止/重启后测试数据、消息与回执全部保留**，**恢复重启（`--no-migrate`）不偷偷迁移/播种**（表级零漂移），**端口被占拒绝且不杀占用者**（Edge exit 24 / 双开 exit 23），**缺配置与依赖不可达错误可解释且不泄漏 secret**，退出后**无本包遗留进程**。

发现 1 个产品缺陷 **CONN-001（P1）**：PG 停机时 Connectors 进程整体崩溃（pg Pool 无 `error` 处理器），导致"依赖自愈恢复"场景中 Connectors 无法像 A 一样自动重连，必须人工重启。已在 T2-006 如实判失败，未修改产品实现，未弱化断言。

## 结果矩阵（严格分类）

| 判定 | 项 |
|---|---|
| 通过（35） | ENV-001/002/003；T1-001～005；T2-001/002/003/004/005；T3-001～005；T4-001～005；T5-001～004；T6-001～004；T7-001～003 |
| 失败（1） | **T2-006** PG重启后Edge ready未回绿——根因 CONN-001（见下） |
| 未测（0） | — |
| 不适用（0） | — |

逐项证据（断言、日志、退出码）见 `results.json` 与 `run/steps/*.json`；本报告只列关键定位。

## 必测逐项结果

1. **依赖顺序冷启动**（T1-001～005）✅：专用容器 `jw-bqa-r2-deprec-pg`（owner 标签、仅 loopback:15502）→ A（生产入口 `src/index.ts`，空库默认迁移为 START.md 文档化行为，log `[migrate] applied: 001…014`）→ Connectors（`start-connectors.mjs` + `CONNECTORS_CONFIG` 注入本包配置；其迁移=幂等 `schema.sql` 直涂，无簿记表）→ Edge（`edge-start.mjs --run-dir` 隔离实例）`/healthz/ready` body.ok=true。**冷启动总耗时 8056ms**（PG就绪3105 + A 2518 + Connectors 826 + Edge 1459），一次测量。
2. **health/readiness 实际语义**（T2-001～005）✅：`/healthz/live`=仅进程存活；`/healthz/ready` **HTTP 恒 200，就绪门控在 body.ok**（gating=非 advisory 检查；assistant-model 未配置模型时为 advisory 不阻断——本包未配模型，如实 not_configured，无真实模型调用）。A 停→kernel-a 失败且整体 ok=false；PG 停→A `/healthz` db=down、Edge db 探针失败，均如实降级不隐瞒。A 经标准入口 `start-kernel.mjs`+`V7NEXT_A_DB_URL` 重启后 readiness 恢复。
3. **端口被占拒绝且不杀占用者**（T3-001～005）✅：本包自起占位监听@48555（全程存活，PID 复核）。Edge 被占→exit 24 且提示换端口；Edge 双开→exit 23（pidfile+heartbeat 标识）；A 被占→exit 1 `EADDRINUSE` fatal；Connectors 被占→exit 1（未处理 listen error 崩溃退出，见 OBS-2），占用者始终存活、无任何入口按端口杀进程。
4. **缺配置/依赖不可达，可解释且不泄密**（T4-001～005）✅：Connectors 缺配置文件→exit 2 明示路径与补救（复制 example）；缺 signingSecret→exit 2 明示字段；A 连不上 PG（15599 无监听）→exit 1 `ECONNREFUSED` 可定位；Edge `--auth-file` 缺失→启动期失败（ENOENT 路径明确）。**四例输出经合成密钥（PG密码/serviceToken/signingSecret/encodingAESKey/回调token）泄漏扫描全部为零命中**（needle 见 `run/synthetic-secrets.json`）。
5. **受控停止与重启，数据保留**（T5/T6-002/T7-001）✅：写入合成数据（A 客户 `cust-mua6czvq-…`、Edge 消息 1 条＋幂等回执 1 条）。停止纪律与 edge-stop 同源：**PID＋命令行 marker 复核后才 taskkill /T**；edge-stop 脚本 exit 0。重启后：A 客户 GET 200、Edge sqlite `messages=1 / message_receipts=1` 零漂移、消息 API 可读回原文。
6. **已有库恢复不偷偷迁移/播种**（T6-001/T6-004）✅：`--no-migrate` 恢复重启：A 日志无 `[migrate] applied`、`schema_migrations` 簿记 14 条不变、A/Connectors 两库**表级快照零漂移**（无新表=无迁移、无新行=无播种）；默认入口对已迁移库幂等（不重复应用）。Connectors 侧佐证为其文档化行为：`--no-migrate` 时仅 `SELECT 1`＋表级零漂移（其迁移无簿记表，故不用簿记数主张）。
7. **退出后无本包遗留**（T7-002/003）✅：三进程端口（15502/48480/48414/48514/48555）全部关闭、登记容器已删（`--keep-db` 可只停不删）；前后 `netstat`/`docker ps` 快照留档，共享栈（takeoff 15446/48114/48194/48214、zloop 48324、兄弟包 authup@25443）全程零触碰。
8. **恢复耗时一次**（T6-003）✅：全停→`--no-migrate` 恢复三服务＋Edge ready＝**1910ms**（一次测量，非压测）。

## 缺陷与观察（最小复现，未改产品实现）

### CONN-001（P1）PG 停机 → Connectors 进程崩溃，无法自愈

- **复现**（本包已自动化）：生产入口启动 Connectors → `docker stop` 其 PG → 进程即崩：
  `Unhandled 'error' event on BoundPool … error: terminating connection due to administrator command`（完整栈见 `run/connectors-cold.log` 行 6–29）。
- **根因**：`Back/Connectors/src/store/pg.mjs` `makeStore()` 的 `new pg.Pool({...,max:8})` **未挂 `pool.on('error')`**；PG 主动断开空闲连接时 pg-pool 在 BoundPool 上发 `error` 事件，无监听即压垮进程。
- **对照**：`Back/A/src/index.ts:14-16` 已有同类处理器，注释明确"不处理会压垮进程（真实缺陷，测试抓到）"——Connectors 未获同款修复。
- **影响**：T2-006 场景中 A 自动重连恢复、数据无损，但 Connectors 需人工重启；Edge readiness 的 `connectors` 探针持续失败（如实报 not ready，不误报）。
- **处置**：按任务书仅交最小复现，不改产品实现；受控停止阶段该实例已死，`T7-001` 证据中 `cStop.why="Connectors 未在运行"` 即此缺陷的连带痕迹（停止语义仍如实）。

### OBS-2（P3 诊断性）Connectors 端口被占无可读错误

被占时以未处理 `Server 'error'`（EADDRINUSE 原始栈）崩溃退出（exit 1），行为安全（不抢不杀）但定位信息差；对照 Edge exit 24 有明确中文指引。同一"缺 error 处理器"模式家族（`Back/Connectors/src/http/server.mjs` listen 处）。

### OBS-3（观察，非缺陷）takeoff 装配默认规则包文件缺失

`takeoff-up.mjs` 默认 `rulePackPath=C/rules/takeoff-first-admission-rule-pack-v1.json` 当前**不存在**（目录内仅 four-domain 包等）。本包配置显式不提供 rulePackPath，compose 以 `rulePack=null` 基线形态启动并全程正常。共享 takeoff 栈运行中，疑为其配置提供了自定义路径或文件在启动后被移除——不在本包范围，交 CTRL 核对。

### 语义说明（向使用方）

Edge `/healthz/ready` HTTP 恒 200，就绪状态须读 body.ok（装配脚本即按此判定）；`assistant-model` 为 advisory 检查，未配模型时入口 503 not_configured 属如实状态。

## 资源清单（执行期登记，全部已清理）

见 `RESOURCES.json`（8 条）：容器 `jw-bqa-r2-deprec-pg`（标签 `owner=backend-qa-r2/deploy-recovery`，loopback:15502，**无共享卷**、数据仅容器层）；A（直启 `src/index.ts` marker `bqa-r2-deprec-a-*` / 标准入口 `start-kernel.mjs`）；Connectors（marker `bqa-r2-deprec-conn-*`）；Edge（`run/edge-run` pidfile+heartbeat）；占位监听@48555。恢复轮 Connectors 实例未单独记 PID（台账内注明），以端口关闭＋无进程核实停止。

## 前后持久数据摘要

`run/snapshot-before-restart.json` / `snapshot-after-pg-restart.json` / `snapshot-after-recovery.json`：A 库 17 表（customers=1、schema_migrations=14 等）、Connectors 库全表、Edge sqlite（messages=1/receipts=1）三轮快照；重启前后 diff 均为 `{}`。

## 恢复命令（复现用；合成配置已留档）

```bash
# 0) 专用PG（本包登记资源；重跑会新建同名容器，须先核实无同名残留）
docker run -d --name jw-bqa-r2-deprec-pg -p 127.0.0.1:15502:5432 \
  --label owner=backend-qa-r2/deploy-recovery \
  -e POSTGRES_USER=qa_dep -e POSTGRES_PASSWORD=qa_dep_local_demo -e POSTGRES_DB=qa_dep postgres:16

# 1) A（空库首次=默认迁移；已有库恢复=显式 --no-migrate，不偷偷迁移/播种）
node Back/A/src/index.ts --port 48480 --db 'postgres://qa_dep:qa_dep_local_demo@127.0.0.1:15502/qa_dep' \
  --principal-tokens '<SPEC见 run/connectors-config.json 同源A_SPEC>' --delivery-marker <唯一marker> --dispatch [--no-migrate]
#    或标准入口：V7NEXT_A_DB_URL='<DSN>' node Back/A/scripts/start-kernel.mjs --port 48480

# 2) Connectors（配置经 CONNECTORS_CONFIG 注入；恢复=--no-migrate 仅 SELECT 1）
CONNECTORS_CONFIG='docs/v0.3/backend-qa-r2/results/deploy-recovery/run/connectors-config.json' \
  node Back/Connectors/scripts/start-connectors.mjs --delivery-marker <唯一marker> [--no-migrate]

# 3) Edge（--run-dir 隔离实例；同 run-dir 停止）
node Back/Edge/scripts/edge-start.mjs --port 48514 --run-dir <run/edge-run> --live \
  --kernel-port 48480 --db-port 15502 --auth-file <run/edge-auth.json> \
  --connectors-url http://127.0.0.1:48414 --connectors-token-file <run/connectors-token.txt> \
  --connectors-tenant qa_dep_tenant --messages-file <run/edge-run/messages.db>
node Back/Edge/scripts/edge-stop.mjs --run-dir <run/edge-run>
```

注意：以上 DSN/令牌为本包本地合成值（`run/synthetic-secrets.json`），不用于生产；A/Connectors 无独立停止脚本，停止须按"PID＋命令行 marker 复核"受控执行（同 edge-stop 纪律），绝不按端口杀。

## 输入源码完整性与首轮说明

- 输入 12 个源文件执行前后 SHA256 全部一致（`run/source-hashes-before/after.json`；ENV-003 PASS），执行期间零改动。
- 首轮（attempt1，已归档 `run/attempt1/`）因**本包测试代码自身缺陷**（合成 AESKey 随机数越界、会话令牌字段取错）产生 10 项失败；修复后全量重跑即本报告数据。首轮同样证明产品侧：T3/T4/T7 全过、源码零改动。产品源码两轮 SHA256 一致。

## 证据文件索引

`results.json`（逐项断言+退出码）、`RESOURCES.json`（资源台账）、`run/*.log`（各服务启动/崩溃日志）、`run/steps/*.json`（逐步退出码）、`run/pre|post-netstat.txt`、`run/pre|post-docker-ps.txt`、`run/snapshot-*.json`（数据摘要）、`run/source-hashes-*.json`。

## 边界声明

未执行共享 `takeoff-up`（任务书禁止）；未读改 `Front/**`；未控制浏览器；未 commit/push；未动共享服务/端口/容器；无真实客户数据、无付费模型与外网调用（assistant-model 未配置=如实 503 not_configured）。本轮验证的是**启动/停止入口与恢复语义**，不构成模型质量验收或生产部署验收。
