# 测试证据 · A 权威路（TAKEOFF-FA-1.0.0 v2.6 预评估确认）

日期：2026-09-20｜执行者：ZCode·A 权威路｜性质：**开发自验**（与 Codex 独立复核、用户视觉/业务验收分开记录）

## 1. 源码版本与配置

| 项 | 值 |
|---|---|
| 仓库 | `C:/Users/22673/Desktop/JW`（origin Openclaw-D/HUMAN-AGENT-LOOP） |
| 基线 HEAD | `8c6d3b0edc7d0c467ab6876a765b80a30b1e268b`（未回退；工作树增量修改，未 commit/push） |
| 本轮改动 | `Back/A/migrations/012_takeoff_preassessment.sql`（新增）；`Back/A/src/domain/credit.ts`、`Back/A/src/http/server.ts`、`Back/A/test/customer-credit.test.mjs`（A22 清单）、`Back/A/test/preassessment-confirm.test.mjs`（新增）；`Back/CONTRACT.md` §13 |
| 运行时 | node v22.23.1；`pg` 8.x（A 包既有依赖，无新增依赖） |
| 测试数据库 | 独立测试库，容器 `jw-cc-kernel-pg@127.0.0.1:15444`（本路历史登记的自有测试资源；每个 suite 自动 DROP/CREATE `v7next_a_test_*`，不触碰未知库） |
| 环境变量 | `JW_A_ADMIN_DB_URL=postgres://jwcc:***@127.0.0.1:15444/postgres` |
| 身份/政策 | 全部合成（`tok-credit`/`tok-biz`/`tok-agent`/`tok-admin`/`tok-t2`；`rules-synth-takeoff-1` 合成规则标记）。无真实客户数据、无收费模型调用 |

## 2. 命令与结果（真实输出）

```text
cd Back/A
npx tsc --noEmit
  → 通过（0 诊断）

# 定向套件（本轮新增；含 D-03/OBS-03-01 修复与首次回租需求用例）
JW_A_ADMIN_DB_URL=… node --test test/preassessment-confirm.test.mjs
  → # tests 18  # pass 18  # fail 0

# 定向回归（受本轮改动影响的既有套件）
node --test --test-concurrency=1 test/customer-credit.test.mjs test/authoritative-reads.test.mjs \
     test/risk-recheck-task03.test.mjs test/preassessment-confirm.test.mjs
  → # tests 55  # pass 55  # fail 0

# 全量回归（run-all，串行；最终确认跑，含 D-03/OBS-03-01 修复与首次回租需求）
JW_A_ADMIN_DB_URL=… node test/run-all.mjs
  → # tests 167  # pass 166  # fail 0  # skipped 1
```

唯一 skip：`integration-crash` 的"PG 容器整机重启"用例——按既有边界守卫跳过（需 `JW_A_TEST_PG_CONTAINER` 显式指定才会执行；本轮不得重启共享容器，遵守守卫）。此 skip 与 2026-09-17 轮（102 项 1 skip）同因，非本轮引入。

## 3. 用例 → 验收映射（PA 套件）

| 用例 | 覆盖验收 | 断言要点 | 结果 |
|---|---|---|---|
| PA-01 | T09 | 正面确认绑定 version/revision；响应 `scope=preassessment_only`；GET 重读 `preassessment_confirmed`；**账本三表整表前后一致** | PASS |
| PA-02 | T09/T10 | 附条件必填条件；support/not_support 禁带条件；未知字段 400 | PASS |
| PA-03 | T10 | `not_support` 无候选可记录（collecting）；客户档案不被删除 | PASS |
| PA-04 | T06/T10 | 快照内同 factKey 冲突 → 正面 409 `REVIEW_REQUIRED{conflicts}`；负面同状态下可记录 | PASS |
| PA-05 | T10 | `withdraw_assessment`（行政）与结论互斥：撤回后确认 409；确认后 decide 409 | PASS |
| PA-06 | T11 | 同号同载荷重放=原回执+单效果（DB 恰 1 条确认）；同号异载荷 `IDEMPOTENCY_REPLAY_CONFLICT` | PASS |
| PA-07 | T09/T11 | 过期评估版本/过期候选修订 → `VERSION_CONFLICT` 附 `serverVersion`/`serverCandidateRevision`；待审中修订 r2 不回退状态 | PASS |
| PA-08 | T12 | 跨租户确认 404（不泄露存在性） | PASS |
| PA-09 | T12 | 假身份 403 `PRINCIPAL_UNTRUSTED` | PASS |
| PA-10 | T12 | business/agent/service 均 403（业务人默认无信审确认权；agent 可产候选不可确认） | PASS |
| PA-11 | T06/T08 | 确认前取代 → stale+inputVersion 前移，正面 `STALE_BASIS`；确认后取代 → 旧确认保留、`needsReview=true`、`PREASSESSMENT_REVIEW_FLAGGED` 恰一次 | PASS |
| PA-12 | T09 机器不变量 | 正/负/失败确认前后 `credit_facilities`/`financing_requests`/`exposure_entries` 逐行 JSON 相等且计数 0 | PASS |
| PA-13 | T04/T08 | 候选修订历史追加（r1/r2）、期限/价格/口径/依据/运行引用字段、`isCurrent`、服务端盖章 revision/inputVersion；按客户清单投影加法字段 | PASS |
| PA-15 | T09 | 显式期望 inputVersion/ruleVersion/snapshotHash 不符 → `STALE_BASIS` 附服务端当前值；一致则放行 | PASS |
| PA-16 | T06（D-03 修复） | Gate 硬门：CLEAR 放行；HARD_BLOCK/NEEDS_EVIDENCE/HOLD_FOR_REVIEW → 409 `GATE_BLOCKED`（附回执/规则明细；状态与候选历史不被改写；负面结论不受阻断）；CLEAR 但规则换版 → `STALE_BASIS` 须重新收口，新收口后放行 | PASS |
| PA-17 | （OBS-03-01 修复） | 五域词表：business 域分析运行登记 200；四域不受影响；词表外 400 且文案列全五域 | PASS |
| PA-18 | （契约 §12 首次回租需求） | 创建携带 request；修正 business/credit+版本锁+整块替换（declaredAt 保留）；确认后 409 NOT_READY；productType 恒回租/未知字段 400；**全程账本整表零变化**（绝不产生融资申请） | PASS |
| PA-14 | T11 | kill→同库重启后确认/候选历史/读回完整 | PASS |

## 4. 断言的诚实边界

- 本轮验证的是 **A 权威面的命令/读回/不变量**；二十格投影、页面交互（T01/T13）、Edge 代理、Connectors 上游属其他路，未在本套件内。
- `PREASSESSMENT_REVIEW_FLAGGED` 事件断言经客户事件读口验证；outbox 投递器行为不在本轮改动面。
- 全量 163 项里与本轮无关的历史套件结果如实引用（162 pass/1 skip），未把任何 `NOT_RUN/BLOCKED` 并入 PASS。
- 未做：真实模型 API（无本轮授权）、性能压测、Front/dist 重建（本路未改 Front）。

## 5. 证据位置

- 套件源码：`Back/A/test/preassessment-confirm.test.mjs`（PA-01..PA-15）
- 实测报文：`SAMPLES-OBSERVED.md`（同目录，真实内核采集）
- 迁移文件：`Back/A/migrations/012_takeoff_preassessment.sql`
- 契约登记：`Back/CONTRACT.md` §13
