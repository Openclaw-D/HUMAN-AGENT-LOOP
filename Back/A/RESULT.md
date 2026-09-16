# A 路 RESULT — 2026-09-16 夜间（截至 04:00 检查点，继续值守至 07:00）

任务：`V7/NIGHT_BACKEND_20260916.md` §A。唯一写面 `V7/backend-next/A/**` + 共享 `CONTRACT.md`。
03:05 监督纠偏（`V7/REVIEW_20260916_0305.md`）已落实：DEF-01 语义候选 + 真实 B 执行器最终组合。

## 结论（真实状态，不虚报）

**A 路合同目标全部达成，B/C 真实组合完成**：目标协作内核（PostgreSQL 事务存储 + 真实 HTTP API + outbox + 租约 fencing + 可信鉴权 + 人工介入）已实现，**23/23 集成测试**、**10/10 步 A 参考模板 E2E**、**7/7 步 A×B×C 最终组合**、**C 8 份案例计划+双模板**、**D-29 干净目录启动自验** 全部通过（真实本机 PostgreSQL，黑盒 HTTP）。

**03:05 纠偏两项均已落地**：
1. **DEF-01**：不再仅改契约。反例分析（`A/DEF01-analysis.md`）+ 最小候选实现（**契约 v1.3，新增部分明确标注 CANDIDATE / PENDING-USER-RULING**）：传递 staleness 读投影（accepted/decided 也可见"依据事后被推翻"）+ accept/decide 人工复核门（409 `UPSTREAM_STALE`，显式 `staleReviewAck` 放行并审计）。历史决定/验收记录永不改写；"谁有权重审"等制度问题不擅自冻结，留待用户。
2. **最终组合不引用 B 自报**：`assembly/final-compose.mjs` 真实拉起 `B/src/cli.mjs worker`（B 代码只读消费）+ C mock 真实 socket，4 目标/2 角色/2 独立客户端（B worker 执行器 + approver 人工 CLI/HTTP），人工暂停/恢复、无关目标继续、证据取代 → 复核门 → 正式决定全链 7/7 通过，全部断言走 A 的 HTTP/PG 读路径。

GLM-5.2 保持 0 真实调用。

## 交付清单（全部有落盘证据）

| 交付 | 位置 | 证据 |
|---|---|---|
| 共享契约 v1.3（v1.2 及之前 FROZEN；v1.3 候选语义 PENDING-USER-RULING） | `../CONTRACT.md` | manifest 内 sha256 |
| DEF-01 反例分析与最小候选 | `A/DEF01-analysis.md` | v1.3 测试覆盖 |
| 迁移 SQL（10 业务表+幂等+投递簿） | `migrations/001_init.sql` | 已应用于 `v7next_a` |
| 内核源码（TS，~2300 行，运行时唯一依赖 `pg`） | `src/`（domain/db/http/outbox） | typecheck 干净 |
| HTTP API（契约 §4 全部端点） | `src/http/server.ts` | 测试黑盒覆盖 |
| CLI 人工介入客户端 | `scripts/goal-client.mjs` | E2E S7 实用通过 |
| 标准启动入口（48080+dispatcher+10 principal） | `scripts/start-kernel.mjs` | 当前 48080 常驻运行中 |
| 集成测试 23 用例（5 文件，串行） | `test/` | `evidence/test-run-final.log`：23 pass / 0 fail |
| **A×B×C 最终组合（4 目标/2 角色，真实 B worker+C mock）** | `assembly/final-compose.mjs` | `evidence/final-compose-result.json`：7/7 |
| A 参考模板 E2E（4 目标/2 角色/2 独立客户端+非租赁小模板） | `assembly/e2e-compose.mjs` | `evidence/e2e-result-final.json`：10/10 |
| C 路组合（2 模板+8 计划+L1 闭环） | `assembly/run-c-plans.mjs` | `evidence/c-plans-result-final.json`：全过 |
| 交付 manifest（传递源 40 文件+lockfile，D-11 教训落实） | `assembly/manifest.json` | `evidence/manifest-final.json` |
| 干净目录启动自验（D-29 预验证） | `scripts/verify-clean-start.mjs` | `evidence/clean-start-verify.log`：PASS |
| README（启动/停止/恢复/凭据表） | `README.md` | — |

## 核心机制验证（对应任务书逐条）

1. **PostgreSQL 持久化 HTTP API** ✅：模板/项目/目标/证据/取代/领取/完成/失败/人工待办/回应/验收/决定/暂停/接管/恢复/项目暂停。业务写+outbox+audit+幂等表**同事务**；行锁串行化并发。
2. **执行成功≠候选就绪≠验收通过≠正式决定** ✅：complete→candidate_ready；accept 仅人类验收角色且执行者≠验收者；decide 仅决定角色且仅 accepted 可决定；decided 终态 409 TERMINAL_STATE。
3. **幂等与载荷一致性** ✅：requestId ≤128（v1.3 放宽，兼容 B 周期化 id）；同载荷重放 `replayed:true`；异载荷 409 REQUEST_MISMATCH。
4. **租约/fencing** ✅：过期租约写回 LEASE_EXPIRED；旧 token 写回 STALE_FENCING_TOKEN（零写入）；takeover 强制 token+1；过期租约可重领（恢复语义）；门序=终态→fencing→状态→版本。
5. **失效映射（v1.3 候选语义）** ✅：取代→直接命中目标 invalidated→重绑新证据回 ready；**传递 staleness 读投影向全部下游可见（含 accepted/decided）**；**accept/decide 复核门**（无 ack=409 UPSTREAM_STALE+staleRoots，有 ack=放行+审计）；invalidated 重绑后自身 staleness 自然清除；无关目标逐字节不变；历史永不删除。
6. **outbox 至少一次** ✅：同事务插入；pull+订阅推送独立投递簿；失败重投；同 eventId 载荷逐字节一致；不宣称 exactly-once。失败命令零孤儿写入（行级断言）。
7. **可信鉴权** ✅：可注入异步验证器；未配置=敏感写失败关闭；验证器异常注入后 403 且响应零凭据泄漏；审计只记 principalId。
8. **人工介入** ✅：人工待办不冻结无关目标（测试+两套组合均验证）；暂停/恢复（测试+final-compose F3/F4 真实 B worker 场景）；重启后待办/租约/任务/回执全在。
9. **崩溃与 DB 重启** ✅：SIGKILL 后同库重启数据完整无半事务；PG 容器整机重启后数据完好、连接池自动恢复（此测试抓到并修复 pool idle error 崩溃缺陷）。
10. **模型边界** ✅：real_http → 409 MODEL_NOT_CONFIGURED；health 恒显 not_configured；0 真实调用。
11. **上下文限额** ✅：result.output >64KB → 400。
12. **行业无关** ✅：A 参考模板 + C 非租赁反例模板 + C 租赁主模板（9 目标/6 角色）同一内核配置化运行。

## 与其他路的交接状态（如实）

- **B**：**真实接线完成**（final-compose，7/7；执行全部由 `B/src/cli.mjs worker` 进程产生，A 断言只依赖 A 侧状态与 C mock 供数标记）。B 的 4 条 OBS 全部采纳（OBS-1 修复+回归、OBS-2 projectId、OBS-3 文档化、OBS-4 设计确认）；另发现并放宽 requestId 上限（64→128）以兼容 B 周期化 requestId——B 的 reclaim claim 缺 expectedVersion 属 B 侧小缺陷，已在其 FAILURE 面能看到（safe-retry-stop 留队列/人工），不阻断。
- **C**：已组合 ✅。C 自有集成脚本亦对 48080 实测通过（其 CP6/CP8）。
- **D**：full-r3 中 3 个 A-owned FAIL 已回应（见 `A/STATUS.md` 02:55 裁决）：D-09 复测 pass（r7）；D-19 已按 v1.3 落地语义（D 复测预期：下游可见 stale + accept 被门拦截）；D-29 A 侧自验 PASS，D harness 清理竞态属其脚本（EBUSY）。契约现为 v1.3，D 复测请以新 hash 为准。

## 未完成门（不掩盖）

1. **DEF-01 候选语义待用户裁决**（复核门/ack 的制度含义；accepted 重开机制未提供）。
2. **真实模型通道未测**——GLM-5.2 按任务书 0 调用，transport 仅接口预留。
3. **生产权限体系未接**——principal 为合成 token 目录（sha256 存储）。
4. **第二机器/跨机恢复未测**；**dispatcher 单进程**（无分布式投递保障，契约未承诺）。
5. Celery 为 B 路已验证 spike 候选，列待裁决（非 A 裁量）。
6. 07:00 前继续值守。

## 已修复的真实缺陷（测试/B 观察/D 反证/监督纠偏抓到）

`--lease-seconds` 未接线；过期租约卡 leased 不可重领；complete 门序掩盖 fencing 信号；respond 证据校验 SELECT 漏列；API 投影蛇形列名泄漏（两处）；证据投影缺 content；**证据命令缺项目 inputVersion 原子门**；幂等并发插竞态；**pg Pool idle error 未处理致 DB 重启崩溃**；**requestId 64 上限卡 B worker 周期化 id**；测试并行与 docker restart 互扰（改串行）；E2E 脚本版本硬编码。
