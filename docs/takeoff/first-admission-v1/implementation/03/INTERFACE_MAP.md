# 03路接口对应与逐动作映射 · 2026-09-20

writer：ZCode 03路。逐动作写明实际路由/权限/落点/回执。协议词表见同目录 PROTOCOL.md。

## 1. 一次上传 → 可信客户绑定 → 原件/解析/事实 → 按需领域分析 → A 登记/候选

| 动作 | 路由（Edge 面为04路代理，上游为 Connectors 服务令牌面） | 权限 | 落点 | 回执 |
|---|---|---|---|---|
| 发邀请 | POST `/api/jw/v2/actions/connectors/intake/invitations` → `/api/connectors/intake/invitations` | 服务令牌；页面身份裁决在 Edge | `intake_invitations`（allowed_evidence_kinds 按 PROTOCOL §1） | invitationId+token |
| 上传原件 | POST `/api/jw/v2/actions/connectors/evidence/upload` → `/api/connectors/evidence/upload` | 邀请 accepted+kind 在获准清单+对象锚定+客户归属一致（CUSTOMER_MISMATCH 拒绝） | 对象存储（内容哈希落库）+`evidence_artifacts` | evidenceId+processing.taskId |
| 可信客户绑定 | 处理链 register_material 段 | 同 ID 场景经 A 权威核验自动登记；映射场景需 legalEntityRef 归属证明 | `a_customer_links`（权威） | a_links.status=registered |
| A 材料登记 | aBridge.registerArtifactOp（requestId=ptx-\<taskId\>-mat 确定性幂等） | 上传者 principal（凭据映射缺失=blocked_a_unavailable 等待，不静默跳过） | A artifacts（kind=material.\<kind\>） | aArtifactId；unknown→blocked_unknown 先对账 |
| 解析+语义事实 | 处理链 parse 段（PARSE_ADAPTERS@2+SEMANTIC_FACTS@1） | 服务内部 | `parse_results`（键=租户+客户+sha+解析器版本+声明元数据）；重复件 skipped_duplicate | stage_runs 逐段留痕 |
| 事实断言 | 处理链 facts 段（contentKey 幂等） | 服务内部 | `fact_assertions`（declared 级；verified 只能来自人工核验端点） | factsInserted/factsExisted |
| 五域分析 | 处理链 analyze 段（C 确定性管线；感知一次+选择性重算） | 服务内部；authority=none 结构强制 | `domain_analyses`（键=消费面签名；snapshot_hash=水位） | computed/reused 逐域留痕（because） |
| 收口（Gate/提问/金额候选v2/下一步） | 处理链 analyze 段（键=inputHash+规则版本） | 服务内部 | `analysis_finalizations` | finId；previousRef 指向前版 |
| 结果登记 A | 处理链 register_results 段（派生件→run start/finish→Gate 回执→findings→包域结果） | registrar/service principal | A 派生工件/分析运行/Gate 回执/复核 findings | a_links 逐项 registered；A 域枚举未含的域 skipped（a_domain_enum_pending） |
| 收口读面 | GET `/api/connectors/analysis/finalization?tid&cid`（本轮新增） | 服务令牌面 | 只读最新收口 | finalization{gate,amountCandidate v2,nextStep,artifactRefs,authority=none} |

## 2. 本轮代码变更清单（ownership 内）

**C（Back/C）**
- `domains/schema.mjs`：DOMAINS 扩五域（business/policy/credit/commerce/asset）+LEGACY_FOUR_DOMAINS 兼容常量
- `domains/perception.mjs`：DOMAIN_READ_SCOPE 加 business；KNOWN_KINDS 加 TAKEOFF 六种材料 kind
- `domains/capability-registry.mjs`：MATERIAL_MODALITY 加六种 kind（ownership_document=image，余为 text）
- `domains/assessors.mjs`：新增 assessBusiness（商机域确定性评估器）+ASSESSORS 注册
- `domains/pipeline.mjs`：域循环/evalInputs 扩五域；finalizeStage 透传 previous/materialIds/runRefs；新增 runFiveDomainPipeline 导出（旧名保留兼容）
- `amount/candidate.mjs`：候选 v2（tendency/suggestedTerm/referencePrice/frozen/frozenReasons/changeReason/previousRef/basedOn；termPolicy/pricePolicy/assetCapPolicy 合成配置驱动；wan→元单位归一；全部加法，旧调用零破坏）
- `rules/takeoff-first-admission-rule-pack-v1.json`（新增）：五域准入合成规则包（simulation_only；携旧8规则+SIM-LITIGATION-PENDING-01+SIM-LEASEBACK-BASIS-01+期限/价格/LTV 合成配置）
- `src/parse/adapters.mjs`：修复 PDF 字面串 latin1→UTF-8 还原（中文业务材料文本层，ASCII 恒等）
- `src/parse/semantic-facts.mjs`（新增）：语义事实确定性投影（PROTOCOL §2 实现）+embedded_instruction_detected 旗标
- `test/takeoff-five-domain.test.mjs`（新增，12 项）+`test/run-all.mjs` 注册；两处夹具升级五域（保留测试意图）

**B（Back/B）**
- `src/domains/four-domain-tools.mjs`：域表取自 C schema（五域）；rulePackPath 可配置；fd-tools@1.1.0
- `src/runtime.mjs`：tools.rulePackPath 透传
- `src/schedule/recalc-planner.mjs`：依赖映射加 TAKEOFF 六种 kind/八个事实键（全部加法）；superseded 扩散含 business；document 影响面扩五域
- `config/routes-four-domain.json`：新增 takeoff_evaluation/takeoff_recalc×5/takeoff_gate；business 角色；four_domain_* 保留为兼容别名（计划同五域）
- `test/four-domain.test.mjs`：路由断言升级五域+新 taskKind 覆盖

**Connectors（Back/Connectors）**
- `src/processing/coordinator.mjs`：域表取自 C schema；evidenceKindOf 扩词表；ruleConsumers 加 business；语义事实合并进 parse 段（单一事实来源）；收口 previous 透传（tendency/previousRef 生产化）；A 域注册配置白名单（aRegisterDomains，缺省四域=A 当前枚举；business 等诚实跳过留痕）
- `src/compose.mjs`：processing.rulePackPath 支持（TAKEOFF 五域包启用入口）
- `src/http/server.mjs`：新增 GET `/api/connectors/analysis/finalization`（服务令牌面；404 NO_FINALIZATION 不泄露存在性）
- `test/takeoff-chain.test.mjs`（新增，5 项）+package.json 注册；processing.e2e 三处断言升级五域

## 3. 诚实边界（未接/未测，不冒充）

- **流式：未接**。B transport（glm.mjs）HTTP 完整读取响应；取消=步边界标志；超时=AbortController→unknown 三分语义（不自动重试）。首字时间未测，不承诺。
- **A 域枚举**：A analysis-runs/start 当前只收 policy/credit/commerce/asset；business 的 A 运行登记经 a_domain_enum_pending 诚实跳过（本地结果+Gate 回执完整）。01路契约扩展后，配置 `aRegisterDomains:['business','policy','credit','commerce','asset']` 即接通。
- **A 候选字段**：A submitCandidate 白名单（tendency/supportableAmountMinor 等）未含期限/价格/修订引用——01路候选同版协议冻结前，03路候选以 Connectors 收口+读面为落点，不猜 A 字段。
- **真实模型 API：0 调用**（未获授权）；预算门照常；成本未知不记 0（billKnown=false）。
- 观察模型/心跳：未启用（未经授权）。
- **规则包版本注记（04路装配）**：旧四域包与新五域包 `version` 字符串同为 `1.0.0`（rulePackId 不同）。
  A Gate 回执的 STALE_BASIS 校验若按版本串比对，部署时应显式设 `aRulePackVersion`
  （如 `takeoff-first-admission@1.0.0`）区分 basis 版本，避免与旧包混撞。
