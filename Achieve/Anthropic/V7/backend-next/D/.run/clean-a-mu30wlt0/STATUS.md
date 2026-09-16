# A 路 STATUS（2026-09-16 夜间长程）

更新时间：2026-09-16 02:15（北京时间）。本文件只保留当前概要，历史过程见 evidence/。

## 当前状态：合同目标达成 + 加固完成，进入值守模式（至 07:00）

- **22/22 集成测试全过**（含 SIGKILL 崩溃恢复、PG 容器整机重启、同事务性零孤儿写入、载荷限额、验证器异常注入）。
- **E2E 10/10**、**C 组合全过**（8 计划+2 模板+L1 闭环）。
- **D-29 干净目录启动预自验 PASS**（`scripts/verify-clean-start.mjs`：manifest 复制→npm ci→启动→健康检查）。
- **CONTRACT v1.0 FROZEN**；manifest 35 源文件+lockfile（assembly/manifest.json）。
- 48080 常驻实例运行中（最新代码），供 B/C/D 消费。
- 完整结论与未完成门见 RESULT.md。

## 02:00–02:15 加固轮（全部由新增测试抓到并修复）

1. **pg Pool idle error 未处理** → DB 重启时内核进程崩溃（docker restart 测试抓到）→ 已加 pool.on('error')。
2. **证据命令缺版本门**（submitEvidence/supersede 忽略 expectedVersion，契约违反）→ 同事务原子版本门已落（UPDATE ... WHERE input_version=$expected）；测试用例 integration-tx 抓到。
3. 失败命令零孤儿 outbox/audit 的显式断言（D-09 对应）。
4. 干净目录启动自验脚本（D-29 对应）。
5. 测试套件改串行（crash 套件重启共享 PG 会与并行文件互扰）。

## 值守计划（02:15–07:00）

1. 监控 C 的 run-contract-integration.mjs 是否落到 48080；如凭据不匹配按契约失败关闭，等 C 提接口请求。
2. B worker 一旦发布产物立即对接组合（消费面已就绪）。
3. D 开测后按缺陷报告（severity+owner+复现）响应修复；修复后按新 manifest hash 复测。
4. 定期健康检查常驻实例；07:00 如实汇总。

## 已做（真实验证，非自报）

1. **契约**：`V7/backend-next/CONTRACT.md` v0.1 已发布（B/C/D 可消费）。冻结 v1.0 待组合验证后落。
2. **基础设施**（A 独占）：
   - Docker Desktop 已启动（00:34）；隔离 PostgreSQL 16 容器 `v7next-a-pg`，`127.0.0.1:15432`，卷 `v7next_a_pgdata`，库 `v7next_a`，用户 `v7next`（仅 loopback 合成环境）。既有 Dify 容器未触碰。
   - 迁移 `migrations/001_init.sql` 已应用到真实 PG（10 张业务表+幂等表+投递簿）。
   - 启动/停止/恢复命令见 `README.md`。
3. **内核实现**（`src/`，TypeScript + Node 22 原生 strip-types，零框架，唯一运行时依赖 `pg`）：
   - 目标协作内核：模板/项目/目标/证据/任务领取/人工待办/验收/正式决定/暂停/接管/恢复 全部 HTTP API。
   - PostgreSQL 事务：业务写+outbox+audit+幂等表同事务；行锁（FOR UPDATE）串行化并发领取。
   - 幂等：requestId 全局表，同载荷重放 `replayed:true`、异载荷 409 REQUEST_MISMATCH。
   - 租约+fencing：claim 递增 fencingToken；过期 worker 写回被 STALE_FENCING_TOKEN/LEASE_EXPIRED 拒绝（先 fencing 后版本门序，B 可确定性区分"没执行"与"执行过"）；过期租约可重领（恢复语义）。
   - 权威分离：complete 最多 candidate_ready；accept/decide 仅人类验收/决定角色且执行者≠验收者；禁用键结构层拒绝（嵌套扫描）；普通输入不能改角色权限（角色全部来自模板+身份源）。
   - 鉴权：可注入异步 principalVerifier；未配置=敏感写失败关闭；内置合成 token 目录（仅存 sha256）；错误不回显凭据。
   - 失效：证据取代按引用映射定向失效+依赖级联（跳过 decided，accepted 只置 stale 投影）；重新齐备自动回 ready；无关目标逐字节不动（测试断言）；模板实例化查环。
   - outbox：pull 通道（GET /api/v1/events）+ dispatcher 订阅推送，每订阅独立投递簿，至少一次，eventId 幂等去重；不宣称 exactly-once。
   - GLM-5.2：transport 仅预留（modelTransport=null 恒），real_http 结果如实 409 MODEL_NOT_CONFIGURED，health 显示 not_configured。0 真实调用。
4. **测试**：17/17 集成测试全过（真实 PG + 黑盒 HTTP，见 evidence/test-run-0150.log；typecheck 干净）。覆盖：完整生命周期、双客户端并发领取恰一成功、过期租约 fencing、takeover fence、重启持久化（库保留重启后目标/租约/待办/回执全在）、幂等重放与载荷一致性、版本冲突、循环依赖、禁用键、real_http 拒绝、失败关闭、failed→resume、非租赁小模板、定向失效+级联+无关项目不变、accepted stale/decided 保护、人工待办不冻结无关目标、项目暂停、outbox 至少一次+重投+eventId 幂等、跨项目越权、受限 principal、审计无凭据。

## 真实失败（已修复的坑，防复发）

- `--lease-seconds` 参数未接入 loadConfig（租约恒 90s）→ 已修。
- claim 不允许过期租约重领（目标卡 leased）→ 已修（恢复语义）。
- complete 门序：fencing 先于版本门（旧 worker 确定性拿 STALE_FENCING_TOKEN 而非 VERSION_CONFLICT）→ 已修。
- respond 的 SELECT 漏 superseded_by 列导致引用校验恒拒 → 已修。
- getProject 证据/待办投影蛇形列名泄漏 → 已统一驼峰。
- DEPENDENCY_CYCLE 按契约映射 400（非 409）；测试曾写错 → 以契约为准修正测试。

## 依赖

- Docker daemon（本机 Docker Desktop）；PG 容器隔离，无外部网络依赖。
- npm：`pg@^8.14`（lockfile 锁版），dev：typescript/@types。全部在 `A/package.json`。

## 下一步（本晚继续）

1. E2E 组合：≥4 目标/2 角色/2 独立 CLI 客户端（真人 API 介入路径）+ 全流程编排脚本。
2. CONTRACT 升 v1.0 FROZEN（补记：门序终态→fencing→状态→版本；敏感写集合最终清单；Project.inputVersion 字段）。
3. assembly/manifest.json（传递源文件+lockfile hash，旧 D-11 教训）；README 启动入口。
4. 07:00 汇总真实结果（含未完成门）。

## 恢复方法

```bash
# PG（如容器在）：docker start v7next-a-pg
# 迁移：cd V7/backend-next/A && node src/db/migrate-cli.ts
# 起服务：node src/index.ts --port 48080 --dispatch --principal-tokens "<见 README>"
# 测试：node test/run-all.mjs   （自动建/删隔离测试库）
```
