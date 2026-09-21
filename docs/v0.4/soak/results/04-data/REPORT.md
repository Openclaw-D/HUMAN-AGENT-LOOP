# V0.4 长程测试 04-DATA · 报告（REPORT.md）

包任务书：`docs/v0.4/soak/04_DATA.md`。结果目录：本目录。运行产物：`.local/soak-v04-data/`。
执行者：ZCode（本任务独占 writer）；产品源码零改动；测试/脚本独占 `Back/Connectors/test/soak-v04-data/`。

## 结论（TL;DR）

- **时长门槛：未通过。** 有效长测 **14.59 分钟**（仅基线档）。用户于正式跑开始约 15 分钟后指示"快速收尾"，ramp（4 档并发×36 分钟、8 个故障窗）与收尾稳定窗（70 分钟）未执行。按合同"若无法满足则明确未通过，不缩短标准冒充完成"，本包长测结论如实标注为**未达成**，不宣称任何长时稳定性/生产性能结论。
- **功能与不变量门槛：通过（在全部已执行范围内）。** 正式跑 0 非预期错误、不变量核查 4/4 PASS；烟雾全矩阵演练（scale=0.002）16/16 不变量 PASS、110 终态 0 非预期、五大硬不变量无违例。harness 已可一条命令复跑（RUN.md）补足时长证据。
- **产品源码零改动**（开始/结束 hash 一致）。发现既有缺陷 1 项（白名单外上报）、产品稳定性调查信号 1 项、产品语义行为 1 项（如实报告）、harness 自身缺陷 1 项（已修）。

## 窗口与分类计数

正式跑：2026-09-20T23:31:20Z → 23:46:09Z（用户 control.json 优雅收口）。

| 项 | 值 |
|---|---|
| 有效长测 | 14.59 min（regression 0.16 + baseline 14.59；ramp/closeout 即时跳过） |
| 上传 | 21 发 21 成（0 预期拒绝/0 非预期/0 故障窗失败） |
| 任务终态 | done 17 · skipped_duplicate 2 · needs_followup 2（empty/fakePdf 预期）· failed 0 · blocked 0 |
| 时延（上传→终态） | p50 1018ms · p95 3039ms · p99 3045ms（n=21） |
| A 替身 | 244 请求 = 244 执行 = 244 回执 · 0 重放异常 · 0 错误 · 36 登记请求=36 工件 |
| 不变量核查 | baseline-end / closeout-start / closeout-end / ramp-end 全 PASS |
| 资源 | 对象字节与材料 1:1（21 文件无孤儿）；宿主空闲内存 0.3–1.9GB（并行任务压力），触发本包自动降载 1 次（合同资源守护生效）；CPU 15.6–32.2% |

烟雾全矩阵演练（scale=0.002，有效 11.94min）：110 终态 0 非预期；A 替身 1150 请求（replay=0、错误=0、173 登记=173 工件）；PG clean stop 15s + crash kill 20s + worker SIGKILL×n + A替身 slow/down 窗口全部注入并恢复；13 类夹具（含敌意 ZIP→failed(ZIP_UNSAFE)、空文件→needs_followup、跨客户同字节独立处理、supersedes 链、金丝雀重放→skipped_duplicate）全部按预期分类。

## 合同矩阵覆盖对照（诚实口径）

| 合同要求 | 状态 |
|---|---|
| 预检（环境/hash/现有回归） | ✅ 回归 3 文件全绿 + goal02-parsing 4/5（F3 既有失败，见 D1） |
| 低载基线 ≥20min | ⚠️ 仅 14.59min（用户提前收尾） |
| 并发 1→2→4→8 每档 ≥20min | ❌ 未执行 |
| ≥4×PG 短暂断连/恢复 + ≥4×worker 重启 | ❌ 正式跑未执行（烟雾各做过小规模版本，恢复后不变量 PASS） |
| 长历史（≤1000 材料/10000 事件内做增长趋势） | ❌ 仅 21 材料 |
| 收尾连续 60min 无非预期错误 | ❌ 未执行（正式跑全程 0 非预期） |
| 每MB成本/积压/连接数/磁盘长趋势 | ⚠️ DB 侧每分钟采样缺失（harness H3，已修可复跑）；磁盘/对象字节有 |

## 缺陷与发现清单

- **D1（既有产品缺陷，白名单外，上报未修）** 文本 PDF 解析分流失败：可提取文本 PDF 终态 `needs_followup`，期望 `done/keyvalue_pdf`（goal02-parsing F3，4/5）。独立 runner 与驱动内回归两轮稳定复现，属既有失败非本包引入。位置 `Back/C/src/parse/*`，不在本包白名单（pg.mjs/fs.mjs/coordinator.mjs）内。
- **D2（产品稳定性调查信号，未修）** 烟雾首跑中 4 个 worker 在 PG 故障窗同秒退出（exit 1）：栈尾指向 pg-pool connect promise 拒绝路径（`Connection terminated unexpectedly`，pg-pool/index.js:45）→ unhandledRejection 进程退出。与部署恢复报告 CONN-001（pg Pool 无 error 处理器）同类残留风险：idle 客户端已有处理器（pg.mjs:31），仍有路径可致进程级退出。定向复现（clean stop 15s / kill -9 带载）未能稳定复现；已给 worker 加捕获仪表（crash-signal 事件，保活+记栈），其后两轮烟雾与正式跑信号=0。按合同"无最小复现不改产品"，候选白名单修法（pg.mjs makeStore 在 pool connect 时为 client 挂 error 兜底监听）留待复跑抓栈后处理。
- **D3（产品语义行为，如实报告）** A 不可达且请求**从未到达 A**（ECONNREFUSED）时，A 恢复后任务保持 `blocked_unknown`（诚实等待：不换 ID 重发、不假成功）；请求**已到达 A**（slow 超时但 A 已处理）时经回执对账自动恢复。属"先对账绝不换 ID"设计的保守面，是否允许"对账确认未到达后安全重执行"需产品侧裁决。
- **H3（harness 缺陷，已修）** 采样层 `taskStatusCounts` 双 `.rows` 导致正式跑 DB 侧每分钟指标缺失（`Cannot read properties of undefined (reading 'map')`）。已修（driver.mjs 两处），复跑即有完整 DB 侧采样；本跑 DB 侧数值以不变量核查点为准（conns total=2，池释放正常）。
- 其余 harness 构建期修复（均为测试侧）：A 替身异步装配 await、`aCredential` 接线、金丝雀首传字节与重放一致、跨运行 schema 重置（psql 方案）、srv.close 顺序+强制退出看门狗、worker 崩溃捕获与自动补员、资源守护降载。

## 硬不变量核验（全执行范围）

越权泄漏=0（fact/a_link 跨客户=0、parse 键跨客户结构核对通过）· 丢失已确认持久数据=0（故障恢复快照核对+missingObjects=0）· 同一幂等命令重复副作用=0（金丝雀 parse_results=1/observations=1/facts 恒定、A 替身 replay=0）· 未知自动重发=0 · 将请求/失败伪报成功=0（负例全部如实落 needs_followup/failed(ZIP_UNSAFE)）。

## 真实模块/替身边界

真实模块：Connectors 全链（HTTP 入口、intake、objectstore、evidence、processing coordinator、store/pg、真实 PostgreSQL 16 容器）。替身：A=本地可计数 HTTP 替身（requestId 幂等+回执+故障模式，端口系统分配）、企微=FakeWecomTransport。**零真实外部出站；测得是本地系统与 transport 效率，不代表 GLM 真实服务延迟或质量。** 预审产物均为候选（authority=none）。

## 遗留与复跑

时长证据缺口按 `RUN.md` 一条命令复跑补足（预计 ~4.5–5 小时墙钟；scale=1、不设 SMOKE/SKIP_REGRESSION）。复跑前 `docker start jw-v04soak-data-pg`（容器已停止保留）或按 RUN.md 重建。D2 候选修复需复跑中由 crash-signal 抓到栈后按白名单流程（最小复现→pg.mjs 小修→goal02 回归→继续长测）执行。

## 资源清理登记

- 容器 `jw-v04soak-data-pg`：**已停止（保留）**，未删除；`docker rm -f jw-v04soak-data-pg` 可彻底清除。
- `.local/soak-v04-data/`、`.local/soak-v04-data-smoke/`：保留（结果摘要/事件/指标/回归结果/hash/对象 21 件；合计 <1MB）。
- 无残留 node 进程；未触碰共享容器/端口/其他任务资源。
