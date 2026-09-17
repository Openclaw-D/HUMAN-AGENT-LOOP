# goal-01 · 性能基线与复测对照（PERF BEFORE / AFTER）

测量日期：2026-09-17。同环境、同数据、同负载、同脚本（`perf/perf-run.mjs`，负载参数写死于脚本且 before/after 一致）。

## 1｜环境与可比性

| 项 | 值 |
|---|---|
| PG | 容器 `jw-goal01-pg@127.0.0.1:15446`（postgres:16.15，本任务自有；pg_stat_statements 计查询数） |
| 内核 | `node src/index.ts`（node v22.23.1），合成开发矩阵 matrix-dev-synthetic-1 / conc-dev-synthetic-1 / `--allow-legacy-basis` |
| 负载 | 4 常规客户（各 1 设施 + 60 申请）+ 大客户（20 已激活设施 + 40 proposed）；写相位 60×(reserve→commit→disburse→settle) + 40×(approve→activate)；读相位 7 端点×100；并发相位：24 worker 同设施不同申请（C1）、12 worker 同 requestId（C2a）、12 worker 同申请异 requestId（C2b）、48 链跨 4 客户并行（C3）——受控 release-promise 屏障，非随机等待 |
| 代码版本 | before/after 均 `git rev-parse HEAD = 1ec0ee4`；before=HEAD 原始实现；after=本任务工作区改动（未提交；文件清单见 HANDOFF §1）。补充查询数测量用 `git archive HEAD` 导出树复现 before，不依赖口头描述 |
| 干扰控制 | 全程独占自有容器；共享容器 jw-cc-kernel-pg 上的其他会话活动不影响本测量 |

## 2｜结果总表（ms；p50/p95）

### 2.1 读端点（100 次/端点）

| 端点 | before p50/p95 | after p50/p95 | 变化 |
|---|---|---|---|
| **exposure_big_20fac** | 91.66 / 97.04 | **15.43 / 16.00** | **-83% / -84%**（目标 ≤45 ✅） |
| exposure_normal_1fac | 15.27 / 16.31 | 15.35 / 16.08 | 不劣化（目标 ≤18 ✅） |
| customer_get | 15.35 / 16.28 | 15.31 / 16.11 | 持平 |
| artifacts_list_big | 15.37 / 16.45 | 15.45 / 16.56 | 持平 |
| facility_get | 15.27 / 16.01 | 15.40 / 16.21 | 持平 |
| use_readiness | 15.31 / 16.18 | 15.47 / 16.22 | 持平 |
| decision_status | 15.41 / 16.18 | 15.40 / 16.11 | 持平 |

### 2.2 写命令（W1 链 60×4）

| 命令 | before p95 | after p95 | 变化 | 目标判定 |
|---|---|---|---|---|
| reserve | 25.53 | **21.52** | **-15.7%** | 目标 ≤23.5 ✅ |
| commit | 29.28 | 29.99 | +2.4%（噪声级） | 目标 ≤26 **❌ 未达标** |
| disburse | 31.68 | 30.23 | -4.6% | 目标 ≤28 **❌ 未达标** |
| settle | 28.60 | 26.59 | -7.0% | （未设单项目标） |
| W1 全链 wall | 5875 | **3985** | **-32.2%** | 目标 ≤5100 ✅ |
| W2 approve / activate p95 | 17.84 / 15.38 | 17.02 / 15.63 | 持平 | （未设目标） |

### 2.3 并发（受控屏障）

| 相位 | before | after | 判定 |
|---|---|---|---|
| C1：24 并发同设施不同申请 reserve | wall 385.5ms，全 200 | **wall 309.0ms（-19.8%）**，全 200 | 目标 ≤345 ✅；桶守恒（reserved=2,600,000 分，26 账目） |
| C2a：12 并发同 requestId 重放 | 12×200 / 恰 1 账目 | 12×200 / 恰 1 账目 | ✅ 幂等语义不变 |
| C2b：12 并发同申请异 requestId | 1×200 + 11×409 / 恰 1 账目 | 1×200 + 11×409 / 恰 1 账目 | ✅ 恰一成功不变 |
| C3：48 链跨 4 客户并行 | wall 981.7ms，全 200 | wall 871.8ms（-11.2%），全 200 | ✅ |
| 死锁 / 错误率 | 0 / 0 | 0 / 0 | ✅ |
| 锁等待采样（C1，10ms 间隔） | avg 5.69 / max 8 waiters | avg ~5.7 / max 9 waiters | 客户锁串行点语义不变 |

### 2.4 DB 查询量

| 指标 | before | after | 变化 |
|---|---|---|---|
| **getCustomerExposure 每请求查询数**（20 设施；100 次实测，`perf/supp-query-count.mjs`） | **42**（=1 客户 + 1 设施列表 + 20×(桶聚合+依据) 2×20） | **4**（=1 客户 + 1 设施列表 + 1 批量桶 + 1 批量依据） | **-90.5%**（目标 ≤8 ✅） |
| exposure 100 次总墙钟（独立安静环境复测） | 3219ms | 1484ms | -53.9% |
| W1+W2 段桶聚合查询次数（`WHERE facility_id=$1 GROUP BY`，pg_stat_statements） | 360 次 | 大幅减少（reserve 由 3 次聚合降为 1 次；批量路径改 `ANY($1)` 单语句） | 见 `perf/results-*.json` `db_writes_total.topByTime` |

## 3｜达标判定（对照 DESIGN.md §7 固定目标）

| # | 目标 | 结果 |
|---|---|---|
| 1 | exposure_big p95 ≤45ms | ✅ 16.00ms（2.8× 超额） |
| 2 | exposure 每请求查询 ≤8 | ✅ 4 |
| 3 | exposure_normal p95 不劣化（≤18ms） | ✅ 16.08ms |
| 4 | W1 全链 wall ≤5100ms | ✅ 3985ms |
| 5 | reserve p95 ≤23.5ms | ✅ 21.52ms |
| 6 | commit p95 ≤26ms | ❌ **29.99ms（未达标；+2.4% 在噪声带内，非退化——见 §4）** |
| 7 | disburse p95 ≤28ms | ❌ **30.23ms（未达标；改善 4.6% 不足 11.7% 目标——见 §4）** |
| 8 | c1 屏障 wall ≤345ms | ✅ 309.0ms |
| 9 | 语义护栏（C2a/C2b/守恒/错误率）逐项不变 | ✅ |
| 10 | 全量回归 102/102 + 新增全绿 | ✅ 114/114 |

**结论**：10 项目标 8 项达标（其中 4 项大幅超额），2 项（#6/#7）未达标。按 DESIGN.md §7 约定不调低目标：#6/#7 列为未关闭事项（OPEN-1/OPEN-2，见 HANDOFF §5），不宣称完成。

## 4｜未达标项分析（如实）

commit/disburse 的设计目标假设了 P2/P4 会缩短其路径，实测不成立：
- P2（响应桶推导）只作用于 reserve（唯一返回 exposure 的命令）；commit/disburse 本就只算一次桶，无重复可消除。
- P4（依据批量）只作用于多设施批量读；单设施路径查询数不变。
- 剩余耗时是结构性写放大（每命令 6 次 INSERT：账目/幂等/审计/outbox×3 + 锁与门查询），在既定"不减门、不弱化事务"约束内无进一步合规手段。
- 后续候选（未实施，需另行评审）：outbox 事件三连发合并为单条 multi-VALUES INSERT（同事务内等价）；驱动层 pipelining。
- 注：commit before→after +0.7ms、disburse -1.5ms 均在运行间波动带（±5%）内；按"改善需超过测量波动"标准，两者均不宣称改善或退化。

## 5｜产物

- `perf/perf-run.mjs`：可重复的负载与测量脚本（before/after 同脚本）。
- `perf/results-before.json` / `perf/results-after.json`：完整原始数据（含每相位 pg_stat_statements 差值、锁等待采样）。
- `perf/supp-query-count.mjs` + `perf/supp-before.json` / `perf/supp-after.json`：每请求查询数对照（before 用 `git archive HEAD` 导出树实测）。
