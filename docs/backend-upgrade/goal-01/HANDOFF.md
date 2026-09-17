# goal-01 · HANDOFF（交接与验收指引）

日期：2026-09-17。执行：ZCode（Back/A 内核负责人槽位）。状态：**实施与测试完成，未 commit/push，待独立验收**。

## 1｜变更清单（本任务全部改动；其余工作区改动属其他并行会话，未触碰）

```
Back/CONTRACT.md                             §10（v2.3 增量契约登记）
Back/A/migrations/008_domain_exemptions.sql  新增（豁免登记表；只新增对象）
Back/A/src/domain/errors.ts                  +409 EVIDENCE_OBJECT_MISMATCH
Back/A/src/domain/inspection.ts              G2 设备对象匹配（refreshItems/answer/addLateEvidence/next-actions）
Back/A/src/domain/analysis.ts                G1 豁免登记/撤销/列表命令
Back/A/src/domain/package.ts                 豁免引用制（parseFreezeInput；+tenantId 参数）
Back/A/src/domain/review.ts                  not_applicable waiver 引用制
Back/A/src/domain/credit.ts                  A3 性能优化（P1/P2/P3；buildFacilityView/buildBucketView 抽取）
Back/A/src/http/server.ts                    新路由 ×3；DELETE 读 body
Back/A/test/evidence-object-match.test.mjs   新增（G2-1..5）
Back/A/test/domain-exemptions.test.mjs       新增（X1..X7）
Back/A/test/inspection-utils.mjs             registerArtifact 支持 objectRef
Back/A/test/utils.mjs                        startKernel 端口碰撞重试
Back/A/test/customer-credit.test.mjs         A22 迁移清单 001–008、计数 8
docs/backend-upgrade/goal-01/**              本任务全部文档与 perf/evidence 产物
```

## 2｜运行与复验命令

```bash
# 类型检查
cd Back/A && npm run typecheck          # 0 错误

# 全量回归（114 项；使用本任务自有隔离容器）
export JW_A_ADMIN_DB_URL='postgres://goal01:goal01-local@127.0.0.1:15446/postgres'
export JW_A_TEST_PG_CONTAINER='jw-goal01-pg'
export JW_A_TEST_PG_ISREADY='docker exec jw-goal01-pg pg_isready -U goal01'
node test/run-all.mjs                   # 实测 114/114 pass / 0 fail / 0 skip（见 TEST_RESULTS.md）

# 性能复测（同环境同数据同负载；约 6 分钟）
cd docs/backend-upgrade/goal-01/perf
node perf-run.mjs --label verify --out results-verify.json   # 对照 results-before/after.json
node supp-query-count.mjs --root ../../../../../Back/A --out supp-verify.json
```

## 3｜资源登记（本任务自有；移交后归验收方处置）

| 资源 | 值 | 说明 |
|---|---|---|
| PG 容器 | `jw-goal01-pg@127.0.0.1:15446`（卷 `jw_goal01_pgdata`；用户 goal01/goal01-local；pg_stat_statements 预加载） | 本任务创建；遗留库仅 `goal01_perf`（性能负载库，可随时删） |
| HTTP 端口 | 17930（perf 工具）、17931（supp 工具，用毕即释） | 避让 48080/48100-48699 测试段/17919/17921 |
| 共享容器 | jw-cc-kernel-pg@15444：基线 102 项在其空闲期实跑；后因其他会话并行活动（含容器重启）改用自有容器。**其上残留的 v7next_a_test_* 库属多个会话，未清理**（单文件单 writer/不覆盖他人） | |

## 4｜不变量保持声明（证据索引）

| 不变量 | 本轮结论 | 证据 |
|---|---|---|
| 1 身份/范围/权限先于缓存回执 | 既有实现确认，未改动 | K01/K02/K03；v2kit.ts:137-139 |
| 2 豁免须真实有权批准记录 | **缺口 G1 已修复**（引用制 + 登记表 + 矩阵权限） | X1–X7；CONTRACT §10；migration 008 |
| 3 分析绑定输入快照；Gate 绑定输入输出；旧不盖新 | 既有实现确认，未改动 | K05/K06/K08/K09/K10 |
| 4 证据匹配落实设备对象 | **缺口 G2 已修复**（锚定匹配三处） | G2-1..G2-5 |
| 5 分动作条件检查；未知对账分开；不盲重发 | 既有实现确认；性能优化不改门 | K12–K15 + perf C1/C2b |
| 6 一致锁序；锁后新读；幂等/业务唯一分保护 | 既有实现确认；优化在锁内只做读合并 | K12/K13/K16 + perf C2a |
| 7 提额冷却/次数/在途/实质新证据按客户持久化 | 既有实现确认（P3 批量校验口径不变） | K17/K18 |

## 5｜未关闭事项（如实）

- **OPEN-1（commit p95）**：目标 ≤26ms，实测 29.99ms（与 before 差异在噪声带内，非退化）。原因与候选方案见 PERF_BEFORE_AFTER.md §4（outbox 三连发合并 multi-VALUES INSERT / 驱动层 pipelining；需另行评审实施）。
- **OPEN-2（disburse p95）**：目标 ≤28ms，实测 30.23ms（改善 4.6%，未达 11.7% 目标）。同上。
- **OPEN-3（共享容器卫生）**：jw-cc-kernel-pg 上多会话残留 v7next_a_test_* 库与本机常驻服务（Edge@48200、Anthropic 树内核@48080 等）并存；建议后续轮次与各会话协调清理，本轮按边界未动。
- **OPEN-4（working tree）**：本任务改动未提交（等用户验收）；工作区另有其他会话对 Back/B/C/Connectors/D 的在途修改，验收时请分开甄别。

## 6｜验收对照（目标 §六 交付物）

| 交付物 | 位置 |
|---|---|
| DESIGN.md（目标在优化前固定） | `DESIGN.md` |
| CHANGELOG.md | `CHANGELOG.md` |
| TEST_RESULTS.md（实跑数字） | `TEST_RESULTS.md` |
| PERF_BEFORE_AFTER.md（同环境同数据同负载） | `PERF_BEFORE_AFTER.md` |
| HANDOFF.md（本文） | `HANDOFF.md` |
| 契约登记 | `Back/CONTRACT.md` §10 |
| 原始证据 | `perf/results-*.json`、`perf/supp-*.json`、`evidence/*.log` |

"源码存在不算验收完成"——验收请以 TEST_RESULTS.md §2 的实跑数字与第 2 节命令的本地复跑为准。
