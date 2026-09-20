# 清理记录 · Back/A（TAKEOFF-FA-1.0.0 A 权威路）

日期：2026-09-20｜结论先行：**本轮 Back/A 内零删除、零停用**。对任务书要求的"明显冲突/无关的测试夹具、样例与孤立代码"做了逐项引用检查，全部候选均给出保留理由；未发现需要停用/删除的对象。若后续独立复核发现可删项，按"停用 → 依赖检查 → 备份 → 删除"补录。

## 1. 检查范围与方法

- 范围：`Back/A/**`（本路独占 ownership）；不碰 Front/Edge/B/C/Connectors/D 与共享根文档。
- 方法：`src` 逐文件反向引用检查（import 图）；`test/` 夹具与留档逐个核对产生方/消费方；历史文档按"是否被现行契约/README 引用、是否自标历史"判断。

## 2. 逐项结论

| 对象 | 引用检查结果 | 决定与理由 |
|---|---|---|
| `src/domain/*.ts`（16 个文件） | import 图全部可达 `index.ts`（kernel→analysis/credit/identity/inspection/package/recompute/reports/review/staleness/status；其余被域内共享） | 保留：无孤立源码 |
| 额度/用信/账本底层（`credit.ts` 的 facility/FR/exposure 命令、迁移 002 既有表） | 被 `customer-credit`/`ledger-*` 等套件与 §8–§12 契约消费；存量库可能有历史数据 | 保留：本轮不调用但不得删（04 文件 §7"单列评估"；机器断言恰恰依赖这三张表保持原状） |
| `test/evidence/ledger-property-failure-seed-20260917.json` | 由 `ledger-property.test.mjs` 失败时按日期再生成的留档（失败序列证据）；现行套件全绿 | 保留：历史失败证据（审计类），104 字节，删除无收益 |
| `STATUS.md` / `RESULT.md` | 自标"2026-09-16/19 轮历史概要"，被后续轮增量更新 | 保留：明确标注的历史记录，按根规不自动成为当前指令 |
| `DEF01-analysis.md` | 被 `Back/CONTRACT.md` v1.3 头部引用 | 保留：现行契约的分析依据 |
| `docs/CUSTOMER_CREDIT_V2.md`、`docs/DECISION_LOOP_V1.md`、`docs/INSPECTION_SESSION_V1.md` | 分别被 CONTRACT §头/R7、§8、检查会话套件引用 | 保留：现行契约文档 |
| `assembly/`（run-c-plans 等） | CONTRACT §6 组合状态引用；`manifest.json` 为 D 路消费入口 | 保留：跨路组合证据与入口 |
| `scripts/`（start-kernel 等） | README/CONTRACT §1 启动入口 | 保留：运行依赖 |
| 旧 decide（reject/withdraw）语义与错误文案 | 仍为行政撤回/旧拒绝的唯一通道（本轮契约 §1 明确沿用） | 保留：语义未变 |

## 3. 本轮新增（非清理，登记备查）

- 新增 `migrations/012_takeoff_preassessment.sql`、`migrations/013_five_domain_vocab.sql`（五域词表）、`migrations/014_admission_request.sql`（首次回租需求）、`src` 对应增量、`test/preassessment-confirm.test.mjs`、`test/customer-credit.test.mjs` A22 迁移清单更新（001–014）。
- 临时样例采集脚本 `temp-capture-sample.mjs`：采集完成后**已删除**（样例留存于 `SAMPLES-OBSERVED.md`；恢复路径：TEST_RESULTS §2 命令可随时再生）。

## 4. 明确不删的红线复核

未删除任何：正式决定（`decision_records`）、审计（`audit_events`）、迁移文件、幂等数据、未知数据库/容器；未停止任何未知进程；未执行任何 Git 写操作。
