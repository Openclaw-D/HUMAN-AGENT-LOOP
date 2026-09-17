# goal-02 · 资料处理与尽调执行链 DESIGN（2026-09-17）

Writer：ZCode（goal-02）。修改范围：`Back/B/**`、`Back/C/**`、`Back/Connectors/**` + 本目录文档。
不动 Back/A、共享契约、Edge、Front、D。零真实模型调用、零真实渠道调用、不 commit/push。

## 0｜现状测量（改码前基线，2026-09-17 实测）

环境：Node v22.23.1；测试 PG `jw-connectors-pg@15443`（cnext）、`jw-cc-kernel-pg@15444`（A 内核）均在本机运行。

既有测试基线（本轮开工实测，全部 0 失败）：

| 套件 | 命令 | 结果 | 耗时 |
|---|---|---|---|
| Back/Connectors | `node --test test/*.mjs` | 50/50 | 5.2s |
| Back/C | `node test/run-all.mjs` | 93/93 | 0.8s |
| Back/B | `npm test` | 83/83 | 78s |

既有能力盘点（全部保留复用，不重造）：

- **接收/登记**（Connectors）：分级邀请→candidate 绑定→操作者核验（`intake/service.mjs`）；上传范围门+对象存储+口径元数据登记（HTTP `POST /api/connectors/evidence/upload` → `evidence/service.mjs registerArtifact`，同 sha256 标 duplicate、同源派生标 suspected_duplicate、不可读=needs_followup 不编数）。
- **解压防护**（Connectors）：`evidence/zipguard.mjs`（穿越/炸弹/深度/数量限制，零依赖，可对真实 ZIP 字节测）。
- **观测/事实候选**（Connectors）：`addObservation`（修订链+下游候选 stale）、`assertFact`（对象/期间锚定+冲突并存）、`correctFact`（显式更正）、注入式文本 non-trusted 标记。
- **进件规范化**（C）：`intake/normalize.mjs`（批次规范化、同源根去重、主体|期间对齐表、口径注记；纯函数）。
- **四域管线**（C）：`domains/pipeline.mjs` 三阶段（共享感知→域评估→收口 Gate/提问/金额/下一步），确定性、authority=none；规则引擎/Gate 不可豁免语义。
- **持久执行器**（B）：worker（claim→complete/checkpoint/fencing/恢复）、GLM 预算账本（多粒度、失败关闭）、fs-lock、question-arbiter（去重键/外发分级/单语音仲裁/暂停语义）、recalc-planner（事件×依赖映射→受影响域、isResultCurrent 水位判定）、domain-cache（租户/客户/授权范围/输入哈希/规则版本隔离）。
- **渠道面**（Connectors）：企微回调验签/收件箱幂等、TRTC 回调录制状态机（重复回调 dedupe_key 去重）、send（clientMsgId 幂等、sent_ok/send_failed/unknown 三分）。

**断链清单（本轮要接的服务级缺口，全部有代码位置指认）**：

1. 上传登记之后**没有任何处理推进**：无解析（真实文件字节→结构化事实），无四域预审触发，无问题准备。`evidence/upload` 返回后链路即终止（`server.mjs:135-181` 之后无后续调用）。
2. **无持久处理任务**：没有任何表记录"某工件解析/分析到哪一步"；进程内无队列，进程重启无从恢复。
3. **解析适配器不存在**：C 感知层只消费 `materials[].declaredFacts`（`perception.mjs:32-52`），当前唯一来源是评测场景 JSON 预填——即任务书禁止的"预填 declaredFacts 冒充解析成功"形态在真实入口上无替代物。
4. **B2 模块未接服务路径**：recalc-planner/domain-cache/question-arbiter 只有单测调用，真实入口不经过它们（B worker 只服务 A goal 路径）。
5. **进度不可见**：传输/解压/解析/分析/核验没有分开的状态与回执。

基线性能（naive 形态 = 现状唯一形态）：每件材料都要走"全量感知+四域全算+全量提问"，重复上传会重复登记并（若串联）重复全算；同批 N 件材料解析次数=N（无去重），域计算次数=4N。量化数字见 PERF_BEFORE_AFTER.md（实现前后同输入对照）。

## 1｜目标链与分阶段数据流

总链：**接收→登记/校验→解压→解析→观测→事实候选→四域预审（选择性）→问题准备→授权提问→补证→会后续办**。
各阶段输入/输出/持久化/去重键/失败状态/恢复方式：

| 阶段 | 输入 | 输出 | 持久化 | 去重/幂等键 | 失败状态 | 恢复方式 |
|---|---|---|---|---|---|---|
| 接收(传输) | HTTP base64/对象引用 | objectRef+sha256 | objects 表+文件 | (tenant,sha256) 内容级 | 413/INVALID（确定性拒绝） | 客户重传（无半截状态） |
| 登记/校验 | objectRef+邀请+元数据 | evidence_artifacts 行 | evidence_artifacts | evidence_id（新行）；duplicate_of/same_source 标注 | needs_followup（不可读/缺页/加密） | 待补重传，不编数 |
| 解压 | ZIP 字节 | 逐 entry 派生工件 | 派生 evidence 行+任务 | (tenant,entry 路径+父 sha256) | ZIP_UNSAFE→隔离记录 | 派生任务独立重跑 |
| 解析 | 原始字节+声明元数据 | 结构化行/聚合+quality | parse_results（缓存） | (tenant,customerId,sha256,parserVersion) | PARSE_UNSUPPORTED→转人工；PARSE_FAILED→有限重试 | 任务表 stage 游标；缓存命中直接复用 |
| 观测 | 解析产物 | evidence_observations 行 | observations | segment_id=(evidenceId+段) 修订链 | —（纯写） | 修订链幂等 |
| 事实候选 | 观测+聚合 | fact_assertions 行 | facts | 确定性 fact_id（内容键）ON CONFLICT 不重插 | 冲突→并存+conflict 行 | 同键重放零新增 |
| 四域预审 | 当前工件集 materials | 感知快照+域结果+Gate | domain_analyses（快照缓存+域结果） | (tenant,customer,inputHash,rulesetVersion)；水位 generation | 域失败→override 记录，不当通过 | isResultCurrent 判定后只算受影响域 |
| 问题准备 | Gate+questionPlan | prepared_questions 行 | questions | question_key=对象\|期间\|目的\|受众\|回答权限 | — | 同键合并保留原问 |
| 授权提问 | 派发计划+外发策略 | send 调用或仅建议 | send 记录（clientMsgId=question_key） | clientMsgId 幂等 | 超时/断连→unknown（不换 ID 重试，先对账） | 对账端点人工/自动核 |
| 会后续办 | 晚到材料/回答 | 增量重算+问题状态推进 | 同上各表 | 同各阶段键 | — | 晚到件只触发受影响域 |

进度五分开：传输（HTTP 200=传输完成回执）、解压/解析/分析/核验各自 stage 状态，`GET /processing/status` 逐段可见；下载 100% ≠ 解析完成。

## 2｜固定测试数据（全部随测试代码生成原始字节，不经预填事实）

1. `bank-2026H1.csv`：真实 CSV 字节，中文表头（交易日期/收入/支出/余额），3 个月约 90 行——唯一声明"支持格式"，用原始文件过真实 HTTP 入口测试。
2. `declared-inputs.csv`：`key,value` 形（monthly_operating_cash_flow=46000 等，declared 级，带口径列）。
3. `decl.txt`：`key = value` 文本声明（declared 级；自由文本=申报，低于 CSV 结构化导出的 source_supported 级）。
4. `wrong-period.csv`：内容月份与声明期间错位（错期间场景）。
5. `fake.pdf`：`%PDF-1.4` 魔数最小字节——**不支持格式**，必须转人工（PARSER 白名单外）。
6. `enc.bin`：伪加密字节——不可读→needs_followup。
7. `batch.zip`：真实 ZIP 字节（测试内 store 法+CRC32 构造），含 bank csv + txt + pdf 三个 entry（解压分发+逐 entry 命运不同）。
8. `decl-v2.csv`：修正原件（supersedes v1，仅改一个数值）→ 局部重算场景。
9. 双上传人（owner/finance 两邀请）同批并发提交。
10. 同字节重复件（sha256 相同）×2。

## 3｜分阶段实施（每阶段独立可验边界；不 commit，边界=可独立验证的交付切面）

### B1 真实输入和批次处理
- C 新增 `src/parse/adapters.mjs`：格式白名单制（csv/tsv、txt、zip 容器），解析器带 `parserVersion`；白名单外（pdf/图片/office/加密）→ `FORMAT_UNSUPPORTED` 如实转人工。**不建通用文档平台，不写 OCR**。
- CSV 流水解析：表头嗅探（中英），日期/收入/支出/余额列映射；聚合=行级确定性求和（source_supported，绑定原件+parserVersion+行引用）；口径注记（入账≠经营收入）强制附加。`key,value`/`key = value` → declared 级事实。
- Connectors 新增 `src/processing/`：`coordinator.mjs`（持久任务表+stage 游标+FOR UPDATE SKIP LOCKED 认领+有限重试）+ schema 增量（processing_tasks/processing_stage_runs/parse_results/domain_analyses/prepared_questions/processing_costs）+ HTTP 进度/回执端点。
- 主入口接线：`start-connectors.mjs` 装配 coordinator+周期驱动；`server.mjs` upload 后入队；服务级测试经真实 HTTP 入口送原始字节。

### B2 共享解析与选择性分析
- 解析去重：parse_results 按 (tenant,customerId,sha256,parserVersion) 命中即跳过（同批重复件 0 重复解析；不跨客户共用——键含 customerId）。
- 分析步：工件集→C 感知一次→`B/schedule/recalc-planner.planRecalc`（事件×依赖映射，B 侧默认映射扩充进件真实 kind：statement/tax_filing/sales_purchase/accounting_ledger/equipment_contract/site_evidence）→只算受影响域；`domain_analyses` 缓存复用（inputHash+rulesetVersion+水位，isResultCurrent 判定）；修正原件→superseded→仅受影响域重算（记原因）。
- 结果绑定：每份域结果存 artifact 引用+处理版本+感知快照 inputHash；同源派生不叠加独立证明（沿用 C01/独立来源计数）。

### B3 问答、恢复和成本控制
- 问题准备：C planQuestions→`B/schedule/question-arbiter.bindQuestions`（去重键合并）→`planDispatch`（优先级排序；默认**只建议**：`outboundPolicy='suggest_only'` 无外发；显式 `auto_whitelist` 才对白名单目的走 Connectors send（Fake transport 测试），敏感类恒 human_gate；语音问题无活动通话一律排队不抢话）。
- 暂停：processing pause 旗标（PG）→派发计划 outboundPaused→零新外发；在途发送单列，unknown 保持 unknown，对账端点核对，不换 requestId 重试。
- 恢复：进程重启后 tick 重认领过期租约，stage 游标续跑，已完成段不重复（事实确定性 id 幂等）；SIGKILL 子进程测试。
- 成本：processing_costs 台账（估算字段与实际费用分离；本轮模型调用=0，实际账单缺失记 unknown 不记 0）；客户级任务预算（窗口内上限，超限排队不丢弃）；A 登记确定性 requestId+超时 AbortController→unknown。
- 会后续办：晚到材料→解析→事实→受影响域重算→满足 stopCondition 的问题推进（answered≠材料≠核验三段语义保留在问题状态机上）。

## 4｜依赖与接口缺口（详见 INTERFACE_REQUESTS.md）

- Connectors→A：解析完成事实如需进入 A 正式收口，须 A 侧 kind=service 身份与 analysis-runs 授权（目标一统一落地；本轮四域预审结果留存 Connectors 侧，标记"预审候选，非正式授信"）。
- Front/Edge：进度/问题建议面板如需展示，读 Connectors `/processing/status`、`/questions/pending`（本目录内自足，不阻塞本轮）。

## 5｜验收映射（六-§清单 → 测试位置）

| 验收项 | 测试（Back/Connectors/test/processing.e2e.mjs 等） |
|---|---|
| 重复上传 | 同字节×2→第二件 duplicate 标注+解析 skip+域缓存零重算 |
| 错主体/期间 | wrong-period.csv→period_mismatch 质量旗标+对齐定位 |
| 同源派生 | zip 派生件按根去重，独立计数不叠加 |
| 部分解析失败 | zip 内 pdf entry→转人工，csv entry 正常（同批互不拖垮） |
| 修正原件 | v2 supersedes→仅受影响域重算，无关域缓存行不变 |
| 局部重算 | 单 factKey 事件→planRecalc 受影响域子集断言 |
| 多人同时提交 | 两邀请并发上传+并发 tick→两任务都完成、无双跑 |
| 暂停与授权竞态 | pause 后计划零新外发；在途单列；恢复后按代际推进 |
| 超时未知 | A 登记超时→stage unknown→对账路径，不换 ID 重发 |
| 进程终止后恢复 | 子进程 SIGKILL→重启 tick→续跑、事实零重复 |
| 重复回调/重放 | 同任务 tick 重入→幂等（事实/观测零新增） |
| 预算耗尽 | 客户窗口任务上限→超额排队不丢弃+台账留痕 |
| 会后补证 | 晚到材料→只更新相关工作+问题推进语义 |
