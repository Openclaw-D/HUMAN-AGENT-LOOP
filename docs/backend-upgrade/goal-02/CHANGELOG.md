# goal-02 · CHANGELOG（2026-09-17）

Writer：ZCode（goal-02 资料处理与尽调执行链）。基线：main @ 1ec0ee4。
范围：`Back/B/**`、`Back/C/**`、`Back/Connectors/**` + 本目录文档；A/契约/Edge/Front/D 零改动。
无 Git 提交；零真实模型/渠道调用。

## 新增

- **C `src/parse/adapters.mjs`**：真实文件解析适配器（格式白名单制，`parse-adapters@1`）。
  支持 CSV/TSV 银行流水（表头中英嗅探、行级提取+聚合、source_supported 事实、强制
  "入账≠经营收入"口径注记）、key,value 声明表与 `key = value` 文本（declared 级）；
  白名单外（pdf/图片/office/未知二进制）一律 `FORMAT_UNSUPPORTED` 转人工；ZIP 容器交回
  协调层经 zipguard 安全解包；同字节同元数据恒同输出；解析缓存键含租户+客户+处理版本。
- **Connectors `src/processing/coordinator.mjs`**：资料处理与尽调执行协调器
  （`processing-coordinator@1`）——持久任务表+阶段游标（unzip/parse/facts/analyze/questions/
  register_a）+阶段回执（processing_stage_runs）+FOR UPDATE SKIP LOCKED 认领+租约+有限重试+
  过期租约回收+客户级窗口预算（认领 SQL 内强制，排队不丢弃）+对账 sweep（blocked_unknown）。
  分析步=共享感知一次+`B/recalc-planner` 事件×依赖映射+**域消费面签名缓存**（该域实际消费的
  事实键状态+参与材料一致性双条件；supersede 值同源异=保守重算并记原因）+收口幂等复用；
  提问步=C planQuestions→`B/question-arbiter` 去重/排序/分级→默认 suggest_only 零外发；
  auto_whitelist 策略下白名单目的经 send 外发（clientMsgId=question_key 幂等）；
  暂停=零新外发（代际标注，在途单列）；A 登记=确定性 requestId+超时→unknown→回执对账，
  绝不换 ID 重发；成本台账估算与实际分离（账单缺失=unknown 不记 0）。
- **Connectors schema 增量**：processing_tasks / processing_stage_runs / parse_results /
  domain_analyses（域消费面签名+snapshot_hash）/ analysis_finalizations / prepared_questions /
  processing_costs / processing_flags；evidence_artifacts.superseded_by（修正原件）。
- **Connectors HTTP 面**：上传回执带 processing 任务号并自动入队；`POST /processing/tick`、
  `GET /processing/status`、`GET /processing/tasks/:id`、`POST /processing/pause`、
  `GET /questions/pending`、`POST /questions/answer`、`POST /questions/verify`（人工核验唯一
  verified 出口）；上传支持 `supersedesEvidenceId`（修正原件→旧件 superseded_by）。
- **性能对照脚本 `scripts/perf-goal02.mjs`**：naive_full（现状基线形态）/selective 双臂同输入
  对照，核验覆盖等价性四项断言不过即 exit 1；结果 JSON 落本目录 evidence/。

## 变更（既有行为保持，增量适配）

- `Connectors src/evidence/service.mjs`：assertFact 支持 `contentKey`→确定性 fact id
  （重放/恢复重入零新增；无 contentKey 的既有调用行为不变）。
- `Connectors src/evidence/a_register.mjs`：确定性 requestId 参数、注入 fetch（测试故障注入）、
  超时显式 `TIMEOUT_UNKNOWN`、`getReceipt` 幂等回执查询。
- `Connectors src/compose.mjs`：装配 processing 协调器（`processing:false` 可关闭）、aFetchImpl 透传。
- `Connectors scripts/start-connectors.mjs`：主入口启动常驻处理驱动（interval 可配）。
- `B src/schedule/recalc-planner.mjs`：DEFAULT_DEPENDENCY_MAP.byEvidenceKind 增补进件真实
  材料种类（statement/tax_filing/sales_purchase/accounting_ledger/equipment_contract/
  site_evidence/media）；既有映射与语义不变。
- `C test/run-all.mjs`：注册 parse-adapters 测试（96 项）。

## 测试

- 新增 `Connectors test/processing.e2e.mjs`（13 项服务级整链，真实 HTTP+原始字节，覆盖任务书
  §六 13 项验收场景）与 `test/processing-helpers.mjs`（零依赖真实 ZIP 构造器+处理 harness）。
- 新增 `C test/parse-adapters.test.mjs`（3 项）。
- 回归：C 96/96、B 83/83、Connectors 64/64，全部 0 失败（详见 TEST_RESULTS.md）。

## 边界（如实）

- 解析白名单只有 csv/tsv/txt/zip——不建通用文档平台、无 OCR/ASR（无获准提供方，保留 BLOCKED）。
- naive_full 策略仅供对照测量，生产配置恒为 selective；域消费面签名不含材料身份——值同源异时
  保守重算（记原因），不冒充复用。
- 事实核验等级：机器从原件确定性提取=source_supported、自由文本申报=declared——银行流水聚合
  不映射经营收入，规则所需事实仍走补证/人工核验路径。
