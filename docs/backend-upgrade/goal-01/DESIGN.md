# goal-01 · Back/A 内核：并发正确收口 + 定向性能优化 — 设计书

日期：2026-09-17。writer：本任务唯一执行上下文（Back/A/**、Back/CONTRACT.md、A 迁移号）。
状态：基线已测、目标已固定（见 §7），实施按 A1→A2→A3 顺序，每阶段测试通过后进入下一阶段。

## 1｜现状核对（实测本地工作区，非远端假设）

| 项 | 实测值 |
|---|---|
| Git 根 / HEAD | `C:/Users/22673/Desktop/JW`，main `1ec0ee4`，工作区干净（开工时） |
| 共享契约 | `Back/CONTRACT.md` v1.3 + §8 v2.1 登记 + §9 v2.2 登记（PR#3 修复轮产物） |
| A 迁移 | 001–007 全部就位（005 幂等归属+客户授权；006 Gate 回执/规则版本/分析运行/必需域政策/提额请求；007 台账第二层唯一索引） |
| 基线测试 | `node test/run-all.mjs`（隔离容器 jw-cc-kernel-pg@15444，含容器重启用例 env）：**102/102 pass / 0 fail / 0 skipped**（2026-09-17，本任务实跑，日志见 `evidence/baseline-tests-20260917.log`） |
| 运行入口 | `node src/index.ts --port … --db … --principal-tokens …`；内核启动自动迁移；测试工具 `test/utils.mjs`（随机端口+独立库） |
| 隔离资源（本任务登记） | PG 容器 `jw-goal01-pg@127.0.0.1:15446`（本任务新建，pg_stat_statements 预加载）；HTTP 17930（perf）；共享容器 jw-cc-kernel-pg@15444 仅作回归 admin 库（不重启业务数据；crash 用例的受控重启见其守卫） |
| 性能基线 | `perf/results-before.json`（git 1ec0ee4，PG 16.15，详见 §6/§7） |

### 1.1 不变量→实现映射（核对结论：既有实现已覆盖大部分；缺口 2 项）

| 目标不变量 | 实现证据（文件:行为） | 结论 |
|---|---|---|
| 1. 身份/范围/权限先于缓存回执；撤权即刻生效 | `v2kit.ts` withCommandV2：外层命中不直接返回，落事务经全部授权门后锁内 replayed（v2kit.ts:137-139）；`principal_customer_grants` 撤权即查（v2kit.ts:268-280）；服务身份 kind=service 独立分级（analysis.ts:60,103,151） | ✅ 有测试（K01/K02/K03） |
| 2. 收口真实会话、必需域来自政策、豁免须真实有权批准 | 收口引用服务端解析（package.ts:86-98）；必需域 fail-closed（package.ts:102-110）；**豁免 approvedBy 仅 reqString 自报字符串（package.ts:124）；review.ts:235-239 waiver 同类** | ❌ **缺口 G1** |
| 3. 分析绑定输入快照；Gate 绑定实际输入输出；旧不盖新 | analysis_runs 开始盖章 input_digest（analysis.ts:128）；域结果只收 completed 运行（K09）；Gate 回执 rulesetVersion=激活版（analysis.ts:73-77）；HOLD≠通过（decision-support.ts:276-281）；换版失效（:282-287） | ✅ 有测试（K05/K06/K08/K09/K10） |
| 4. 证据匹配到客户/主体/设备对象/期间/版本 | 客户归属✅、取代/重复✅、object_ref 列与检查项锚定✅；**但 refreshItems 仅按 kind 客户级匹配（inspection.ts:350），answer.evidenceRefs（:1394-1404）与晚到材料重开（:1610-1612）均不校验 objectRef**——设备 B 照片可满足设备 A 核验 | ❌ **缺口 G2** |
| 5. 分动作条件检查；未发送/未知对账分开；不盲重发 | reserve/commit/disburse 分别 assertFrUseGates（credit.ts:1616-1638；disburse 不重复当前性门 :1631）；unknown 出账不动桶（:1217-1228）；唯一退出 confirm-external + 矩阵权限（:1285-1340）；release 遇外部状态强制走对账（:1124-1132） | ✅ 有测试（K12–K15、A12） |
| 6. 一致锁序；锁后新读；幂等/业务唯一分保护 | 锁序 客户→设施→申请（credit.ts:1118-1120 等）；lockFr 锁内新读（:1746-1752）；requestId 幂等 + `uq_exposure_fr_entry_once`（007）；金额防溢出（MAX_SAFE_INTEGER 检查 :79-82；bigint 聚合显式失败 :78-81） | ✅ 有测试（K12/K13/K16） |
| 7. 提额冷却/次数/在途/实质新证据按客户持久化 | credit_limit_requests 客户级（006 迁移）；在途唯一（:1497-1502）；窗口/间隔（:1504-1526）；实质新证据比对历史引用（:1530-1550）；requestId 幂等不重复计数；冷却不冻结既有用信（:1620-1622、:133-136） | ✅ 有测试（K17/K18） |

### 1.2 缺口设计

**G1（A2；不变量 2）豁免必须引用真实、有效、有权批准的记录**
- 现状：`createPackage.exemptions[{domain,reason,approvedBy,scope}]` 的 approvedBy 是调用者自报字符串；只要域在政策必需集中，自报即可把该域置 `required:false`，绕过必需域结果。`finding.resolve` 的 not_applicable waiver（policyApproved/approvedBy/validUntil）同为自报。
- 设计：新增**服务端豁免登记**（迁移 008）：
  - 表 `domain_exemptions`：`exemption_id PK、tenant_id、customer_id、domain、scope、reason、policy_version、approved_by（服务端从凭据解析，非载荷）、approved_by_roles、valid_until、status(valid|revoked)、created_at`。
  - 命令 `POST /api/v2/customers/:id/domain-exemptions`（人类；矩阵动作 `domain-exemption.grant`——矩阵未配置/无条目 → 409 POLICY_PENDING，fail-closed；硬红线不适用豁免：仅作用于"必需域豁免"，不解除 nonWaivable 差异）。`DELETE /api/v2/domain-exemptions/:id`（撤销，同权限）。
  - 消费端改引用制：`createPackage.exemptions[]` 只接受 `{exemptionId, reason?}`——服务端解析登记行（须 valid、未过 valid_until、customer/domain 匹配），approvedBy/批准角色从登记行冻结进包；自报 approvedBy 字段一律拒绝（400）。域 required=false 仅当存在有效豁免引用。
  - `finding.resolve` not_applicable：`waiverRef` 只接受 `{exemptionId}`（scope 匹配 finding 域/规则），不再接受自报 policyApproved/approvedBy/validUntil（旧字段出现即 400，不做兼容解读）。
  - 错误码：复用 `POLICY_PENDING`（无登记/过期/撤销）与新增 403 `EXEMPTION_INVALID`→ 不新增错误码，统一 `INVALID_INPUT`（引用字段残留）/`POLICY_PENDING`（登记无效），避免契约面膨胀。
- 测试（A2 阶段新增）：自报 approvedBy 冻结被拒；admin/无矩阵权限者登记豁免被拒（POLICY_PENDING）；有效豁免→域 required=false 且包就绪；撤销后新包被拒（旧包历史冻结不受影响）；valid_until 过期后引用被拒；not_applicable 引用制。

**G2（A1；不变量 4）证据匹配落实设备对象锚定**
- 现状：三处仅按 kind+客户匹配（见映射表行 4）。
- 设计（最小侵入，规则唯一：**检查项锚定了 objectRef 时，材料必须锚定同一 objectRef**）：
  1. `refreshItems` 的 `allPresent`：对 `item.object_ref !== null` 的项，期望 kind 的现行工件中须存在 `object_ref->>'objectId' === item.object_ref` 的工件；未锚定或锚定其他对象不满足。
  2. `answerQuestion.evidenceRefs`：引用工件若与问题所属项 object_ref 不匹配 → 409 `EVIDENCE_OBJECT_MISMATCH`（新错误码，errors.ts 登记），零状态变更；工件未锚定（无 objectRef）且项已锚定 → 同样不匹配。
  3. `addLateEvidence`：重开过滤加 objectRef 匹配（工件锚定对象 ≠ 项锚定对象 → 不重开该项）；审计/事件 payload 如实记录匹配口径。
  4. 人工 verify 不受影响（人仍可对 conflict/stale 做终审），但自动推导（`requires_human_verification=false` 的项）不再可能被错设备材料"自动核实"。
- 兼容：未锚定项（object_ref=null）行为完全不变（存量测试零扰动）；已锚定项此前从未被服务端校验过 objectRef，收紧属缺陷修复而非契约破坏（契约 §9 已声明"证据匹配落实到设备对象"语义）。
- 测试（A1 阶段新增，即验收清单"错设备材料"）：设备 B 照片不能使设备 A 项进入 to_verify/verified；错设备 answer 被拒且项保持 waiting_evidence；晚到错设备材料不重开；对设备换绑（rebind）后原引用保留、新材料按新锚定匹配。

## 2｜事务边界（现状保持，不放宽）

- v1：目标/证据/人工待办写 = inTx（业务写+outbox+audit+幂等同事务）。
- v2：withCommandV2 = 事务（客户锁 → 业务门 → 写 → 幂等行 → audit → outbox 同事务）；23505 冲突 → 锁内重查幂等出 replayed 出口。
- 不变量：模型调用/文件下载/渠道调用不入事务（analysis_runs 只登记 start/finish，执行在事务外——本轮无真实模型调用，0 付费调用）。

## 3｜锁顺序（固定，全部写路径一致）

```
customers(FOR UPDATE) → credit_facilities(FOR UPDATE) → financing_requests(FOR UPDATE)
                                                      → evidence_artifacts(FOR SHARE，批准复查)
                                                      → decision_findings / decision_packages / analysis_runs / credit_limit_requests(FOR UPDATE，各自域)
检查会话域：inspection_sessions(FOR UPDATE) → questions/outbound/items(FOR UPDATE)
```
本任务不改锁序；G2 的匹配校验发生在既有锁内，只增加读，不引入新锁。优化不改锁顺序、不缩短门，只合并重复读（§6）。

## 4｜兼容与迁移

- 迁移 008（G1）：只新增表 `domain_exemptions`；不改既有行。回退方式：保留对象、停用入口（无破坏性 DDL）；向前修复一律追加新迁移。
- API 变更登记到 `Back/CONTRACT.md` §10（v2.3）：
  - 新增 `POST /api/v2/customers/:id/domain-exemptions`、`DELETE /api/v2/domain-exemptions/:id`；
  - 破坏性收紧（v2 域内）：`decision-packages` exemptions 引用制；`findings/:id/resolve` not_applicable waiver 引用制；自报 approvedBy 字段拒绝。B/C/D 无既有消费者（审阅各目录 interface-change-request：本轮无新增请求）。
  - 新错误码 `EVIDENCE_OBJECT_MISMATCH`（409）。
- v1 面零改动；旧测试（102 项）不修改预期（G2 只对"已锚定+错对象"新增拒绝，存量场景无此形态；A2 阶段跑全量回归验证）。

## 5｜A1/A2/A3 阶段切分

| 阶段 | 内容 | 完成判据 |
|---|---|---|
| A1 证据可信 | G2 设备对象匹配（inspection.ts 三处 + errors.ts + 测试） | 新测试绿 + v1/检查会话全量回归绿 |
| A2 可信依据 | G1 豁免登记制（迁移 008 + analysis/review/package/credit 接线 + 测试 + 契约 §10） | 新测试绿 + 全量回归绿 |
| A3 台账/提额/性能 | 台账与提额既有实现核对（§1.1 行 5–7 已有 K12–K18；补：重启恢复+台账守恒回归并入 goal-01 证据）；§6 性能优化 | 全量回归绿 + perf-after 达标（§7） |

## 6｜性能：瓶颈证据与优化项（先测量后动手）

瓶颈证据（`perf/results-before.json`，jw-goal01-pg@15446，PG 16.15，node v22.23.1，git 1ec0ee4）：

1. **getCustomerExposure N+1**（读，最大项）：单设施 p50 15.3ms → 20 设施 p50 91.7ms（每增 1 设施 ≈ +4ms）。查询模式：1（设施列表）+ N×(computeBuckets 聚合 + basis 评估查询)。pg_stat_statements：`SELECT entry_type, SUM…exposure_entries WHERE facility_id=$1` 360 次/测量段。
2. **写路径重复桶计算**：reserve/commit/disburse 门内 facilityView(computeBuckets) 与响应前 computeBuckets 各算一次；`SELECT entry_type,SUM…` 360 次 vs 240 次账目插入（60 链×4 命令）——每写命令 ≥1.5 次聚合。
3. **客户锁串行化**：c1 屏障（24 并发同设施 reserve）wall 385ms ≈ 24×16ms 串行；锁内每命令查询数 ~24（580 查询/24 命令）。锁序与同事务 outbox 是不变量，不动；只缩短锁内重复读。
4. 无死锁（deadlocks=0）；top-by-time 均为结构性 INSERT（outbox/账目/幂等/审计），无缺失索引证据（全部命中 PK/既有索引），**不新增索引、不引入新组件**。

优化项（全部为读合并/重复消除，不删门、不弱化事务）：
- P1 `getCustomerExposure`：一次 `GROUP BY facility_id` 聚合全部设施桶 + 一次 `ANY($1)` 取全部 basis 评估 → 每请求 O(1) 查询（目标 ≤8）。
- P2 写命令响应桶由门内已算桶 + 本事务账目增量推导，删除响应前重复 computeBuckets（reserve 路径）。
- P3 `reverifyBasis` 快照工件循环 → `WHERE artifact_id = ANY($1) FOR SHARE` 单查询；`createLimitIncreaseRequest` 证据循环同理（同型 N+1，预防大快照退化）。
- P4 `facilityView` 内 basis 评估查询并入 P1 批量模式（单设施路径保持 1 次查询，不劣化）。

## 7｜量化目标（基线固定于优化前；复测同环境同数据同负载）

基线（before，2026-09-17）→ 目标（after 上限）：

| 指标 | before | 目标 | 说明 |
|---|---|---|---|
| exposure_big_20fac p95 | 97.0ms | **≤ 45ms** | P1；波动 ±5%，2× 改善远超噪声 |
| exposure_big_20fac 每请求查询数 | ~43 | **≤ 8** | pg_stat_statements 差值 |
| exposure_normal_1fac p95 | 16.3ms | ≥ 不劣化（≤ 18ms） | 防批量路径劣化小客户 |
| w1 全链 wall（60×4 写命令） | 5875ms | **≤ 5100ms** | P2/P4；≥13% 改善（run 间波动 ~5%） |
| commit p95 | 29.3ms | **≤ 26ms** | 同上 |
| disburse p95 | 31.7ms | **≤ 28ms** | 同上 |
| reserve p95 | 25.5ms | **≤ 23.5ms** | 同上 |
| c1 屏障 wall（24 并发同设施） | 385.5ms | **≤ 345ms** | 锁内临界区缩短；语义不变量不退化 |
| c2a/c2b 语义 | 12×200/1 效应；1×200+11×409/1 效应 | **必须逐项不变** | 幂等/恰一成功护栏 |
| 死锁 / 错误率 | 0 / 0 | 0 / 0 | |
| 全量回归 | 102/102 | **102/102 + 新增测试全绿** | 不变量不退化的硬门 |

若某目标实测未达：如实记录差异与原因，不调低已固定目标；不达标项列为未关闭事项并给出下一步，不宣称完成。

## 8｜回退方式

- 代码：A1/A2/A3 各自独立提交集（工作区分阶段留档 evidence/），任一阶段回退=还原该阶段文件，不牵连其他阶段；迁移 008 回退=保留对象停用入口。
- perf 工具与结果归档 docs/backend-upgrade/goal-01/perf/，before/after 同脚本同参数可重复。

## 9｜交付物

`DESIGN.md`（本文）、`CHANGELOG.md`、`TEST_RESULTS.md`、`PERF_BEFORE_AFTER.md`、`HANDOFF.md` + perf/（工具+before/after JSON）+ evidence/（基线与各阶段测试日志）。源码存在不算验收完成——以 TEST_RESULTS.md 的实跑数字与 PERF_BEFORE_AFTER.md 的达标对照为准。
