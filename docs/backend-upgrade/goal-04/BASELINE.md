# goal-04 · 独立验收与性能基线（冻结版 · 2026-09-17）

**状态：FROZEN — 本文件在实测开始前写定，后续不得修改规模、阈值、分母或允许波动来制造改善。** 修订只能追加（带日期与原因），不改写已冻结段落。

## 0｜本轮身份与独立性

- 角色：goal-04 独立验收与性能负责人（第四路，与任务01/02/03 平行）。
- 写入范围：`Back/D/**`、`Back/Edge/test/e1/**`、`Back/Edge/scripts/**`、`docs/backend-upgrade/goal-04/**`。
- 不修改：Back/A、Back/B、Back/C、Back/Connectors、Back/Edge/src、Front。发现的缺陷写 DEFECTS.md 交原负责人。
- 不使用 allow-legacy-basis 等兼容开关跑新链验收；业务推进全部经真实 HTTP API；白盒注入（政策种子/权限矩阵/故障注入）均显式标注 synthetic。
- 零真实模型调用、零付费 API、零真实资金。

## 1｜被测版本（唯一有效快照）

| 项 | 值 |
|---|---|
| Git HEAD | `1ec0ee4e79a793d1c95363022cb7d06ea04a6a5a`（2026-09-17 21:06 +08:00，"docs: DECISIONS/CHANGELOG 记录任务01-03审核修复轮与验收留证"） |
| 工作区 | 干净（`git status --porcelain` 空，采集时点 2026-09-17 晚） |
| 分支 | main，与 origin/main 一致 |
| 契约 | Back/CONTRACT.md：头部 v1.3 + §8（v2.1 增量登记：决策闭环/检查会话）+ §9（v2.2 增量登记：A1 权限幂等/A2 可信依据/A3 台账提额，迁移 005–007） |
| 迁移清单 | Back/A/migrations：001–007（001_init / 002_customer_credit / 003_inspection_sessions / 004_decision_loop / 005_a1 / 006_a2 / 007_a3 族，以运行时迁移簿记为准） |
| Node | v22.23.1（Windows x64） |
| 宿主 | AMD Ryzen 5 5600X（6C12T）/ 15.9 GB RAM / Windows 11 专业版 / Docker 29.7.2 |
| 数据库 | PostgreSQL 16.15（Docker 容器，仅 loopback） |

### 我方负责范围的文件哈希（冻结时点）

关键判据文件 sha256（完整清单见 `evidence/baseline-hashes.txt`）：

- `Back/D/harness/run-all.mjs` = f868c60a1cfc03457ed43200cbd36eebddbba60c27b3c4d9a7d1…（完整 64 位值见哈希清单）
- `Back/D/harness/runner.mjs` = a098a5f1ae9919a299ca804f7dd7d18e5d2bfb9cc0eecfb8e89e40e5a7320a73
- `Back/Edge/test/e1/e1-task3-scenario.test.mjs` = 50b0e5b19d959d455a2d72acd955743cd1e621c1ecb2ebdfd136f9c68d60b279
- `Back/Edge/test/e1/task3-boot.mjs` = 19b82ddf9a1b651378d0833d7c06e4501274bf0ef210fff5998f61e9c9a30250
- `Back/Edge/scripts/perf-baseline.mjs` = 52f1d5350f5943798dfe15dad410d6545a2beb62d15aa08a18345d6f19ce3927
- `Back/Edge/scripts/backup-restore-drill.mjs` = b617db8b94a4bbb628f6273c392e82a0aa2a41c4ece1abd2686c1e0528513a67

### 三类数据的区分纪律

| 类别 | 内容 | 用法 |
|---|---|---|
| 历史证据 | Back/D/STATUS·RESULT（2026-09-16 夜间批次，旧 V7 快照 + CONTRACT v1.0–v1.3 早期）；docs/customer-next/acceptance/**（S0/S1 阶段）；D01_D28 矩阵 E0 结论 | 只作对照与追溯，**不作为当前版本任何判据的 PASS 依据** |
| 在制修改 | 本轮任务01/02/03 已合入的审核修复（8f9b396/9feb371/b6977a1）| 属被测对象，随 1ec0ee4 一起验收 |
| 本次实跑 | 本轮 goal-04 在上述 HEAD 上执行的命令与结果 | 唯一可引用为当前结论的数据；每条附命令/退出码/时间/日志 |

## 2｜测量档位（D1/D2/D3，冻结）

规模是**测试目标**，不构成任何生产容量承诺。全部档位共用第 1 节硬件/运行时；数据库为每轮独立新建的隔离库（v7d- 前缀容器 @15434 段或 jw-cc-kernel-pg@15444 的独立测试库），用后即毁或明确登记保留。

### D1 普通办理（单客户单链）

| 维度 | 冻结值 |
|---|---|
| 客户数 | 1 合成客户 |
| 材料 | 6 件：进件主档 1、购销合同 1、设备发票 1、银行流水 1、诉讼记录 1（后被更正版取代）、设备核验照片引用 1；单件 content ≤ 4 KB JSON |
| 业务链 | 完整新链一遍（见 ACCEPTANCE_MATRIX.md F-01）：进件→材料→四域预审（Gate 回执+分析运行+域结果）→检查计划→定向提问→回答/补证→对象级核验→依据包冻结→人工批准/激活→两笔交易共同预占→不利证据阻断→中断恢复 |
| 并发 | 1 写者 + 1 SSE 订阅（除两笔预占并发步与双客户端争抢步） |
| 外部能力 | 全 simulation：零真实模型/渠道；四域结果由合成 service 身份登记（标注 synthetic） |
| 样本 | 每指标 ≥ 30 次调用级采样；整链 ≥ 3 轮 |
| 种子 | requestId 前缀 `g04d1`；随机种子=时间戳+pid，逐轮记录 |

### D2 多人协作（九角色 + 多客户并行）

| 维度 | 冻结值 |
|---|---|
| 会话 | 同一客户 9 角色独立会话（业务/见微/政策/信审/商务/资产/审批人/厂长/客户实控人）+ admin(setup) |
| 客户并行 | 3 个合成客户同时办理，各自完整 D1 链的"进件→材料→四域→包冻结→批准→激活→预占"段 |
| 事件 | 每客户 1 条 SSE 订阅，全程保持 |
| 并发写 | 每客户 2 笔预占并发（共 6 个并发 reserve 调用，分 3 组） |
| 外部能力 | 同 D1 全 simulation |
| 样本 | 整链 ≥ 3 轮 |

### D3 历史/压力/故障

| 维度 | 冻结值 |
|---|---|
| 历史规模 | 每客户 40 件证据（含 ≥ 8 次取代链）、≥ 200 业务事件（材料+会话+评估+账目），3 客户 |
| 慢请求 | 注入点：Edge→内核投影读（workspace）加 120 ms 延迟探针轮；不修改 Edge/src——用独立反代探针进程实现，或以内核慢查询（大 history 读）替代，逐轮记录采用方式 |
| 重复提交 | 同 requestId 重放 ≥ 20 次/指标；异载荷冲突 ≥ 5 次 |
| 断线 | SSE 客户端强制断开 3 次后以 Last-Event-ID 续传；内核 kill+重启 2 次 |
| 并发 | 8 并发读 + 4 并发写（跨 3 客户）持续 60 s |
| 样本 | 整链 ≥ 3 轮；60 s 压力窗每轮独立计数 |

## 3｜测量拆分与指标（冻结）

每个请求级指标按五段拆分记录（可得则分，不可得则该项标 n/a，不许混段冒充分段）：

1. 排队/调度（客户端发出到服务端开始处理——以服务端可观测起点估算；本轮以端到端减去可测段近似，标 synthetic-approx）
2. 数据库（SQL 计数；锁等待以 pg_stat_database 死锁/阻塞采样为准，能取则取）
3. 文件传输/解析（本轮材料为 JSON 内容，无大文件——标 n/a，不虚构）
4. 模型/渠道等待（全 simulation = 0 真实调用；费用=未测）
5. 事件同步（动作完成 → SSE 帧到达的延迟）

记录：p50/p95（样本 < 20 的指标只报 min/median/max 并标注样本数，不出高分位数）、查询数、调用次数、错误与超时计数、进程 RSS 峰值（内核/Edge）、退出码。**外部模型费用与生成质量：未测，如实写未测。**

## 4｜冻结判据（不可退化指标与允许波动）

### 主要改进指标（本轮验收对象，优化后不得劣化超出允许波动）

| # | 指标 | 基线采集方式 | 允许波动 |
|---|---|---|---|
| M1 | D1 整链端到端墙钟 | g04 链测试计时 | ±15% |
| M2 | workspace 快照 p95（D3 历史规模下） | perf 脚本 | ±20% |
| M3 | 简单写命令 p95（artifact/reserve/answer） | perf 脚本 | ±20% |
| M4 | 动作→SSE 可见延迟 p95 | SSE 订阅计时 | ±20% |
| M5 | 中断恢复到 readiness ok 的时间 | kill/重启计时 | ±25% |

### 不可退化指标（任何恶化即 FAIL，无论幅度）

| # | 指标 | 判据 |
|---|---|---|
| N1 | 正确性 | ACCEPTANCE_MATRIX.md 全部已执行判据无新增 FAIL |
| N2 | 幂等 | 同 requestId 重放零双重业务效应（账面逐字节不变） |
| N3 | 超占拒绝 | 可用额不可为负；超预占 100% 拒绝 |
| N4 | Gate 拦截 | 无包提案 409 BASIS_PACKAGE_REQUIRED；HOLD/NEEDS_EVIDENCE/HARD_BLOCK 零正式效果；STALE_BASIS 阻断生效 |
| N5 | 恢复完整性 | 内核/PG 重启后账面/档案/事件水位零丢失，resume 幂等仍 replayed |
| N6 | 错误率 | 同条件轮次间错误数不增加（偶发网络重试除外，逐条列出） |
| N7 | 权限边界 | 越权/匿名/跨租户/跨客户拒绝率 100% 保持 |

### 不得作为改善证据的行为（冻结）

- 优化结束后修改数据规模、阈值、统计分母或样本口径。
- 只保留最后一轮绿灯、丢弃失败轮次。
- 用局部接口改善掩盖整链等待/队列/恢复恶化（判定为退化）。
- 以 SKIP、零断言、子进程崩溃、日志截断冒充 PASS。
- 用预填事实的确定性管线冒充真实原件识别（四域结果一律标 synthetic）。

## 5｜外部能力模式（全部档位）

| 能力 | 模式 | 说明 |
|---|---|---|
| 模型 | not_configured / simulation | MODEL_NOT_CONFIGURED 如实拒绝路径单独验证；四域结果由 service 身份登记，标 synthetic |
| 媒体/RTC | 无 | 未接线，如实标 |
| 对象存储 | 无 | 材料以 JSON 内容入 evidence_artifacts；大文件路径未测 |
| 支付 | 无 | 零真实资金；confirm-external 走 mock 面 |

## 6｜基线结论（实测后回填 · 2026-09-18；只追加不改写）

- **D1 基线**（3 轮全绿）：整链业务步 4,077 / 5,206 / 4,281 ms（首轮含预热）；恢复段 879/567/568 ms；SSE 61 帧/轮零串线。
- **D2 基线**（3 轮全绿）：3 客户并行完整速通链 946 / 915 / 1,048 ms，零错误。
- **D3 基线**（修复版 3 轮全绿）：历史规模（3 客户×40 件含取代链）+60s 混合压力窗：workspace 读 p95 61–62 ms；写命令 p95 46–47 ms；幂等重放 p95 32 ms；kill→ready 恢复 ~348 ms；内核 RSS 峰值 ~98–100 MB、Edge ~114–119 MB 平稳；SSE 断线续传 2/2 无 resync。
- **M1–M5 均已建立可复现基线**；对照任务书候选 SLO 见 PERF_BEFORE_AFTER.md §7。
- harness 迭代失败轮全部保留（perf-g04-2026-09-17T16-29-12 / 16-34-39 等），教训已修入 g04-chain.mjs（重启子进程清理跟踪、日志级就绪判定、轮前端口预清理）与 DEFECTS.md。
- 证据：`evidence/perf-g04-2026-09-17T16-43-57`（D1/D2）、`evidence/perf-g04-2026-09-17T16-53-09`（D3）。

### 2026-09-18 追加

- e1 既有测试安静窗口重跑：task3-scenario PASS 26s、task3-inspection PASS 16s、d02 如实 SKIP（A 在制）、d03-d05 挂起（DEF-G04-10）。
- D g4 安静窗口 6/6 PASS（126 断言）——首跑 5 败定性为与我并行 e1 循环的 17919 端口冲突（goal-04 自身排程失误+D harness 探活弱点），非产品问题。

### 2026-09-18 追加（v2 重基线）

- 验收自查发现并修复两处 v1 偏差（DEF-G04-11/12）：九角色矩阵漏"财务"（已补 tok-fin1 并由其应答财务口径）；D3 慢请求注入与数据库段指标未执行（已补独立反代 120ms 探针 + pg_stat_database/pg_stat_activity 采样）。
- **v2 基线全档重跑**（脚本：perf-g04.mjs 更新版；证据 perf-g04-2026-09-17T18-06-55 与 …18-13-54）：D1 整链 3,868/3,893/4,312 ms；D2 三客户并行 946/952/953 ms；D3 读 p95 61–69 ms、写 p95 49–50 ms、慢读(120ms 注入) p50 236 ms / p95 238–239 ms、事务 Δ≈2.0 万/窗、死锁 0、锁等待峰值 0、恢复 327–350 ms。v1 轮次标记 superseded 保留。
- 数据库段口径登记：未装 pg_stat_statements，查询计数以 xact_commit 差值替代（synthetic-approx）；锁等待为 pg_stat_activity 3s 采样；排队段 synthetic-approx；文件传输/解析段 n/a；模型/渠道段=0（simulation）。
