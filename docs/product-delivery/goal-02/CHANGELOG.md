# goal-02（产品交付·任务二）· CHANGELOG（2026-09-18）

Writer：任务二路。基线 `v02-goal1234-delivery` @ e4ed7a5。全部变更未提交（工作区可审查）。

## 2026-09-19 增量（缺陷判据与 PDF 抽取修复验证轮）

背景：04 路 DEFECTS.md 中 DEF-G04N-01/03（02 路缺陷）已由 04 路于 R4 复测关闭（金丝雀
`kd:register-results-reaches-a` / `xlsx:no-zip-container-mishandling` 转绿）。本轮独立复证修复在制工作树真实有效
（G-A1/G-A2 真 A 内核 2/2），补齐**能抓住原缺陷形态**的常绿判据；验证中另发现并修复一处 PDF 抽取潜在缺陷。

- `Back/C/src/parse/adapters.mjs`：**extractPdfText 流数据切片修复**。原切片自 `stream` 关键字**起点**开始，
  7 字节关键字（`stream\n`）被混入 FlateDecode 数据——能否解出全凭 zlib 字节运气（短流侥幸对齐但文本带垃圾
  前缀，稍长流即 `invalid literal/length code` 全空、整件误判"扫描件"转人工）。数据起点改为关键字之后；
  无压缩内容流不再混入 `stream` 字面量。谓词/取值 trim 行为不变（P3 normalize 既有语义）。
- `Back/C/test/parse-adapters-v2.test.mjs`：新增 P3 回归判据——journey 购机合同同形 PDF（冒号前带空格/行首缩进）
  谓词与值无前导/尾随空白，`TOTAL PRICE` 可被下游按谓词精确匹配（DEFECTS.md P3 补充观察的常绿护栏）。
- `Back/Connectors/test/defects-g04n.test.mjs`：**新增 2 项缺陷判据**（挂入 `npm test`/`test:processing` 默认入口）：
  - N1（原 DEF-G04N-01）：严格 A 契约 e2e——假 A 按 A v2kit 同规则校验每个写请求 requestId（string 1..128，
    违规=400 INVALID_INPUT 同码同文案，任务不得掩绿）；全链 done 证明零违规；requestId 全部确定性
    `ptx-<taskId>-<op>` 且 ≤128（含 findings 最长形态 `ptx-…-fnd-cfl_<20hex>`）；parse_extraction 派生件
    （含事实摘要、provenance 指向材料件 A 工件）真实到达 A；重入零新写（幂等不换 ID）。
  - N2（原 DEF-G04N-03）：XLSX 整体解析不当容器——unzip 段 skipped（`xlsx_whole_file`）、本侧与 A 侧零 OOXML
    派生子件、事实谓词非 XML 垃圾且无尾随空白、解析=bank_statement_xlsx 且解析产物以 parse_extraction 登记 A；
    对照臂：真 ZIP 容器仍安全解包派发（命运分离，不是一刀切禁解包）。
- Back/B：本轮零代码改动（复证当日 105/105，证据 test-b-2026-09-19.txt）。

## Back/C

- `src/parse/adapters.mjs`：**重写为 parse-adapters@2**。引号感知 CSV 状态机（parseDelimitedRows）；严格金额
  parseAmountCell（千分位分组校验/括号负/全角负号；非千分位逗号拒绝）；严格日历 normDate + excelSerialToIso；
  extractBankStatement 共用（合计/小计行剔除、金额不可解析整行拒绝、公式缺缓存行整行拒绝 opts.excludeRows）；
  XLSX 最小 OOXML 读取（zipEntries/zipRead/parseSharedStrings/parseSheetRows/convertSerialDates；非 XML 护栏）；
  PDF 文本提取（extractPdfText：FlateDecode+文本算子+加密检测；无文本层=扫描转人工）；图片 previewSafe；
  parseCacheKey 增 meta 参数（声明元数据入键）。导出 detectFormat/parseDelimitedRows/parseAmountCell/normDate/excelSerialToIso。
- `test/parse-adapters-v2.test.mjs`：新增 4 项（自包含真实 ZIP/XLSX/PDF 字节构造）。`test/run-all.mjs`：挂入 v2 文件。

## Back/B

- `package.json`：npm test 补齐漏挂的 fs-lock-recovery / inspection-dispatcher / question-arbiter（83→105 用例）。
- `src/schedule/recalc-planner.mjs` 等逻辑零改动（复用上一轮成果）。

## Back/Connectors

- `src/store/schema.sql`：新增 `a_customer_links`（客户↔A 客户持久映射）、`a_links`（逐 A 操作：request_id 唯一、
  principal、状态机 registered/unknown/failed、a_ref）。
- `src/evidence/a_bridge.mjs`：**新增** A v2 客户端（材料/派生件登记、runs start/finish、Gate 回执、findings、
  包域结果、v2 回执对账（兼容嵌套/平铺/found:false）、decision-status；确定性 requestId；超时=A_UNKNOWN；注入 fetch）。
- `src/evidence/service.mjs`：新增 `manualEntry`（人工录入：转录语义、contentKey 幂等、冲突并存、needs_followup 拒绝、
  录入后转人工问题推进 material_received）。
- `src/processing/coordinator.mjs`：游标改 `register_material → unzip → parse → facts → analyze → questions →
  register_results`；新增 stageRegisterMaterial（A 材料登记+取代链回写+派生件 provenance）、stageRegisterResults
  （派生工件→4 域 runs→Gate 回执→findings→可选包域结果）、aOp 幂等执行器（registered/unknown/failed + 回执对账取回 aRef）；
  unzip 段 XLSX 整体文件识别（不当容器解包）；parse 段元数据感知缓存键+重复判重对全部同字节件比较+detail 增补
  aggregates/badRows；getTask 增 aOps；reconcileUnknown 泛化（a_links 逐操作+无任务行）。
- `src/http/server.mjs`：新增 `POST /evidence/manual-entry`、`POST /evidence/correct-fact`（继承原事实锚定/来源、
  contentKey 幂等、A 回写 aSync）、`GET /evidence/preview`（魔数嗅探+签名 URL）；detectFormat 顶层引入。
- `src/compose.mjs`：装配 aBridge（`config.a`）；processing 接收 aBridge（v1 aRegister 保留供 e1）。
- `scripts/start-connectors.mjs`：透传 `a` 配置。`scripts/perf-goal02.mjs`：证据输出目录改 docs/product-delivery/goal-02/evidence。
- `config/connectors.config.example.json`：a.bridge 配置样例。
- `package.json`：**修复默认测试入口**（原 `node --test test/` 实际匹配 0 个文件 → 显式清单）+ test:processing。
- `test/processing-helpers.mjs`：harness 支持 aConfig 透传。`test/processing.e2e.mjs`：P09 重写为 v2 桥语义
  （unknown→对账→材料 POST 恰一次→a_ref 回填断言）。
- `test/goal02-parsing.test.mjs`：新增 5 项（引号 CSV/XLSX/text-PDF+扫描分流/同字节不同元数据/预览面）。
- `test/goal02-manual.test.mjs`：新增 2 项（扫描件人工路线全链/待补材料拒绝录入）。
- `test/goal02-a-bridge.test.mjs`：**新增真 A 内核集成 2 项**（全链贯通含 A 侧只读直查断言；确定性拒绝如实失败）。

## docs/product-delivery/goal-02/

DESIGN.md、SUPPORTED_FORMATS.md、TEST_RESULTS.md、INTERFACE_REQUESTS.md、HANDOFF.md、CHANGELOG.md、
evidence/{test-connectors-npm-test.txt, test-c-run-all.txt, test-b-npm-test.txt, test-goal02-a-bridge.txt, perf-goal02-*.json}。

## 2026-09-19 续轮（IR-03-8 ①②③⑤ 关闭轮；03 路缺陷候选→02 owner 落地）

来源：`docs/product-delivery/goal-03/INTERFACE_REQUESTS.md` IR-03-8（03 路 2026-09-19 真实链复现）。
基线：`v02-goal1234-delivery` 在制工作树（上轮交付后未提交状态）；本轮全部为增量编辑，零 revert/丢改。
资源：自属容器 `jw-g02r2-pg@15458`（Connectors 测试库 + A 内核测试库管理连接，经
`CONNECTORS_TEST_PG_PORT`/`JW_A_ADMIN_DB_URL` 注入，不碰共享 15443/15444）。

### ① G3 处理状态写口调通（a_bridge + 协调器逐段上报）

- `Back/Connectors/src/evidence/a_bridge.mjs`：新增 `reportProcessingStages`——service 身份调
  `POST /api/v2/customers/:id/artifacts/:artifactId/processing`（A §11 G3）；入参校验对齐 A 契约
  （failed 必带 failureReason；failed|needs_review 必带 nextAction）。
- `src/processing/coordinator.mjs`：新增 `reportG3` 助手并在游标推进点接线——register_material→received、
  parse done/缓存命中→parsed、analyze done→analyzed、转人工（解析白名单外/待补/ZIP 深度超限）→needs_review、
  analyze/register_results 确定性失败→failed。`runRef=<taskId>:a<attempt>`（新 attempt=新处理尝试，A 侧允许
  从任意 stage 重开，重试/恢复如实留痕）；requestId=`ptx-<taskId>-a<attempt>-prc-<stage>`（确定性，重放幂等）。
  a_links 新增 entity_type=`processing`。**上报失败不阻断主链**（进度披露非业务事实；a_links 如实留痕）。
- 验收：G-A3（真内核）断言 A 侧 artifact_processing 阶段序列 received→needs_review→analyzed、
  registered_by=service 身份、failure_reason/next_action 到位、重入零新增。

### ② 人工事实并入四域分析输入（Gate 可被人工路线满足；正向 CLEAR 前置）

- **裁决（02 owner）**：分析快照除 parse declaredFacts 外纳入现行人工事实——manual_entry 转录=source_supported；
  correction 更正=source_supported；**manual_entry_required 问题被获准复核 verified 后，该件转录事实升 verified**
  （verified 仍只由获准复核端点产生，机器不自证）。同件同键存在现行人工事实时 parse 声明值让位（本地事实状态
  已 superseded，不在快照复活被取代值）；同键多个人工取值并存→感知层冲突结构显式保留。
- `src/store/schema.sql`：fact_assertions 加列 `entry_mode`（NULL=机器解析默认|manual_entry|correction）、
  `value_json`（录入原始 JSON 类型保真）；存量人工行按 statement 前缀幂等回填。
- `src/evidence/service.mjs`：manualEntry 事实挂 `from_observations`（结构化溯源）+entry_mode+value_json；
  correctFact 标 entry_mode='correction'；新增 `requeueForAnalysis`——人工事实变更（录入/更正/复核升级）后把
  受影响材料任务从 done/needs_followup 重入分析（游标置 analyze；failed/blocked_unknown 不越权改写）。
- `src/processing/coordinator.mjs`：stageAnalyze 增 `liveManualBlocks`（人工事实→感知材料块，materialId 带
  `@manual-<obs>` / `@corr-<fact>` 后缀；verified 升级按问题状态推导）并入快照；no-parse 工件（扫描件）有人工
  事实即可触发客户级分析；fin 引用面=解析材料∪人工事实来源件（A deps 不伪造缩小）；myFacts 含人工事实键。
- **stageRegisterResults requestId 升级（诚实新收口）**：run/fin/gate/dres 追加收口作用域后缀 `-<finId>`——
  同输入重放=同 ID 幂等零新写；人工事实变更产生新收口=新 ID（合法新 A 写，不覆写历史回执）。G-A3 断言
  NEEDS_EVIDENCE→CLEAR 两轮回执并存、CLEAR 到达 A、deps 覆盖人工事实来源件。
- 验收：M3（本地）+G-A3（真内核）：录入→收口#1 NEEDS_EVIDENCE（不冒充通过）→复核 verified→收口#2 CLEAR。

### ③ intake 判重客户级 + 绑定幂等回执

- `src/evidence/service.mjs` registerArtifact：duplicate_of 判重加 customer_id（原租户级——跨客户同字节误判）。
- `src/processing/coordinator.mjs` stageParse：同字节判重比较集合同步收敛客户级（同客户判重语义保留）。
- `src/intake/service.mjs` acceptInvitation：既有绑定（同联系人↔同客户）命中时**新邀请显式推进 accepted 并挂接
  既有绑定**（原缺陷=幂等空转恒 pending、无法上传）；同 token 重放仍被"一次有效"拦截，语义不变；响应增
  `invitationAccepted` 幂等回执字段。
- 验收：N3——跨客户同字节各自全链 done 且零 duplicate 标注；同客户同字节仍 skipped_duplicate；
  既有绑定后新邀请 accepted→上传范围检查通过。

### ⑤ start-connectors 透传 processing 配置与客户映射种子

- `scripts/start-connectors.mjs`：`fileCfg.processing` 原被整体丢弃——现透传进 compose（IR-03-8⑤ 本体）。
- `src/compose.mjs`：新增导出 `resolveProcessingConfig`——种子优先级 显式 `processing.aCustomerLinks` >
  `a.customerLinks`（样例配置主位/03 路部署形态）> 空；落 `a_customer_links` 后以表为权威（既有语义不变）。
- `config/connectors.config.example.json`：样例补 processing.aCustomerLinks 与透传注记。
- 验收：N4——仅配 a.customerLinks 时种子落表（linked_by=config_seed）且全链到达 A；G-A3 亦经此路径。

### 测试与判据

- `test/defects-g04n.test.mjs`：N1 判据随契约演进扩展（G3 上报操作形态 `a<attempt>-prc-<stage>`、收口作用域
  后缀 `-<finId>`；确定性/≤128/A 契约校验/重入零新写/派生件到达 A 全部保留）；新增 N3（③）、N4（⑤）。
- `test/goal02-manual.test.mjs`：新增 M3（②本地全链 NEEDS_EVIDENCE→CLEAR）。
- `test/goal02-a-bridge.test.mjs`：新增 G-A3（①+②真内核；⑤种子路径）。
- `test/helpers.mjs`/`test/processing-helpers.mjs`：BASE_PG 支持 `CONNECTORS_TEST_PG_PORT/USER/PASSWORD/DATABASE`
  环境覆盖（并行轮次各自专用容器，避免共享容器干扰假失败；默认值不变）。

### 本轮明确不做

- 金丝雀 `journey-first-file.mjs`（固定端口 17933/17935 与 03 路在跑栈冲突）：本轮跳过，**留给路 D 合流回归统一跑**。
- IR-03-8④（kind 命名空间剥前缀，→01）：非本轮范围，未见回归。
- 部署库中已直插 `a_customer_links`（linked_by=goal-03-deploy-seed）行：与种子透传兼容（表为权威，种子不覆写）。
