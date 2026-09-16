# RelayOS P1 十场景矩阵

状态：P1 冻结契约  
日期：2026-08-26  
权威来源：`C:\Users\22673\Desktop\Anthropic\P0-market\outputs\中国AI招聘市场证据库-2026-08-26.md` 第 5 节十张工作流反推线索卡，以及 `C:\Users\22673\Desktop\Anthropic\P0-market\outputs\中国AI招聘市场证据库-2026-08-26.csv` 的 `record_id`、`record_type`、`evidence_grade`、`production_metrics` 字段。

## 1. 使用边界

- 十场景全部进入 P5 自动化压力测试；排序只决定测试与展示顺序，不决定是否进入产品。
- 三个展示重点是金融、供应链、企业自动化；它们只能拥有场景配置、词汇、角色、adapter 和模拟数据，不能拥有专用内核、状态机、API 或 UI。
- 本矩阵中的企业内部流程均为公开证据驱动的合成推断，不代表任何公司的真实私有流程。
- 标记规则：**事实**来自 P0 报告/CSV；**推断**是由岗位职责和业务域反推的可测试流程；**待验证假设**必须在模拟或试点中证伪，不能写成事实。

## 2. 可审计选择评分

### 2.1 评分公式

每项 0–5 分，总分 `5E + 3M + 4X + 3L + 3R + 2T`，满分 100。

| 维度 | 可复核规则 | 权重 |
| --- | --- | --- |
| `E` 证据强度 | 报告卡片引用的 A/B/C 级记录分别计 3/2/1；`E = 5 × 加权和 ÷ (3 × 引用数)` | 25% |
| `M` 指标可观测性 | 同名 CSV 中该卡引用记录的 `production_metrics` 非空比例；`M = 5 × 非空数 ÷ 引用数` | 15% |
| `X` 跨角色/系统复杂度 | 5=至少 5 类人类角色且至少 4 类系统/事实源；4=至少 4/3；3=至少 3/2；2=至少 2/1；1=单角色或单系统 | 20% |
| `L` 连续性长度 | 5=至少 5 个接续阶段且跨部门/会话；4=4 个阶段；3=3 个阶段；2=2 个阶段；1=单步 | 15% |
| `R` 异常成本 | 5=资金、法律、处罚、物理设备、生产发布或量产不可逆风险；4=客户、品牌、内容发布或大规模运营风险；3=内部可逆错误；2=低影响返工；1=几乎无业务后果 | 15% |
| `T` 可迁移性 | 5=相同 handoff/Gate/回执模式可映射至少 3 个其他场景；4=至少 2 个；3=至少 1 个；2=主要为本场景；1=强专用且难配置化 | 10% |

`E`、`M` 可直接从报告和 CSV 重算；`X`、`L`、`R`、`T` 必须由下方逐场景列出的角色、系统、handoff、Gate、异常路径和共性映射复核。

### 2.2 评分结果与测试顺序

| 测试顺序 | 场景 | 证据构成 | 指标记录 | E | M | X | L | R | T | 总分 |
| ---: | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 客服 | 5A | 4/5 | 5.0 | 4.0 | 5 | 4 | 4 | 5 | 91.0 |
| 2 | AI Coding | 4A+1C | 3/5 | 4.3 | 3.0 | 5 | 5 | 4 | 5 | 87.5 |
| 3 | 供应链 | 4A+1C | 1/5 | 4.3 | 1.0 | 5 | 5 | 5 | 5 | 84.5 |
| 4 | 视频生成 | 4A+1C | 4/5 | 4.3 | 4.0 | 5 | 4 | 4 | 3 | 83.5 |
| 5 | 企业自动化 | 3A+2C | 3/5 | 3.7 | 3.0 | 5 | 5 | 3 | 5 | 81.5 |
| 6 | 终端 OS / IoT | 2A+3C | 2/5 | 3.0 | 2.0 | 5 | 5 | 5 | 3 | 77.0 |
| 7 | 金融 | 2A+3C | 1/5 | 3.0 | 1.0 | 5 | 5 | 5 | 4 | 76.0 |
| 8 | 本地生活 | 1A+3C | 1/4 | 2.5 | 1.3 | 5 | 5 | 4 | 5 | 73.4 |
| 9 | 内容治理 | 1A+4C | 1/5 | 2.3 | 1.0 | 5 | 5 | 5 | 4 | 72.5 |
| 10 | 电商 | 2A+3C | 1/5 | 3.0 | 1.0 | 5 | 4 | 4 | 5 | 72.0 |

内容治理、电商和本地生活分数较低主要是 C 级证据或公开指标不足，不代表产品价值低；它们必须以更严格的事实边界进入压力测试。

### 2.3 展示重点的可审计选择

展示选择不是简单取总分 Top3，而是覆盖三种互补压力：

1. **金融**：在高风险决策流候选（金融、内容治理）中证据分更高，压力点是资金/风险结论、具名 Human Gate 和零越权写入。
2. **供应链**：在长链路外部执行候选（供应链、本地生活、终端 OS/IoT）中总分最高，压力点是跨 ERP/SRM/WMS/TMS、合同/付款 Gate 和 ActionIntent/ExecutionReceipt。
3. **企业自动化**：报告事实明确横跨营销、供应链、研发、财务、HR、办公，最适合解释同一内核如何跨部门、跨知识权限与审批工作。

客服与 AI Coding 虽总分更高，仍是前两项自动化压力测试；没有展示专用代码。

## 3. 十场景完整矩阵

### 3.1 电商：经营、推荐与准入治理

证据 ID：`BYTE-016`、`JD-008`、`JD-004`、`TENCENT-001`、`TENCENT-006`。

| 字段 | 冻结内容 |
| --- | --- |
| Trigger | **推断**：商品/商家准入申请、流量或转化异常、营销投放变化、经营诊断请求。 |
| 人类角色 | **事实+推断**：算法、产品运营、准入/内容治理；商家运营、类目、风控审核、客服与申诉复核人。 |
| RoutableAgent | 商品理解/推荐 Agent、经营诊断 Agent、准入审核 Agent、申诉证据 Agent。 |
| ExternalSystem | 商品库、订单/流量平台、商家后台、审核队列、申诉系统；具体接口为待验证假设。 |
| 事实来源 | 商品/商家记录、流量/转化观测、审核命中、规则版本、申诉材料；模型摘要只能引用这些 `Evidence`。 |
| 决策权 | 流量建议可由 Agent 提议；准入/封禁、重大流量调整、规则发布和终局申诉必须由配置中的具名人类决定。权限归属是待验证假设。 |
| Handoff | 机器初筛/诊断 → 业务或风控复核 → 商家申诉复核 → 规则/样本 Owner；接收前 owner 不变。 |
| Human Gate | 高影响封禁、批量流量调整、规则变更、终局申诉。 |
| 业务指标 | GMV/转化变化、准入通过率、申诉闭环率；只作为试验指标，不把招聘材料当作已达成效果。 |
| 风险指标 | 误杀率、漏检率、错误流量调整数、无证据处罚数。 |
| 效率指标 | 首次复核时长、交接接受时延、重复调查率、申诉周期。 |
| 异常路径 | 证据冲突或规则过期 → `ExceptionRecord` → 政策 Owner Gate；外部系统失败 → `ExecutionReceipt=failed/unknown` → 禁止假定成功并升级。 |
| 共性字段 | `WorkCase`、`Trigger`、`GoalVersion`、`Evidence`、`ContextVersion`、`AuthorityGrant`、`HandoffOffer/Acceptance`、`HumanGate`、`ActionIntent/ExecutionReceipt`、`MetricObservation`、`BusinessEvent`。 |
| 场景扩展字段 | `merchantId`、`skuId`、`policyVersion`、`appealId`、`trafficWindow`；全部属于 `scenarioExtensions.ecommerce`，不得进入通用状态机。 |

### 3.2 金融：支付、风控与智能投研

证据 ID：`BOSS-001`、`BYTE-018`、`JD-005`、`BOSS-021`、`BOSS-022`。

| 字段 | 冻结内容 |
| --- | --- |
| Trigger | **推断**：支付/交易异常、风险告警、客户尽调、投研请求、合规复核。 |
| 人类角色 | **事实+推断**：支付 AI、反欺诈/反洗钱、安全评测、投研；业务运营、风控分析师、合规、客户运营、研究负责人。 |
| RoutableAgent | 交易风险 Agent、证据检索 Agent、投研分析 Agent、合规检查 Agent。 |
| ExternalSystem | 交易流水、客户/商户档案、规则引擎、案例库、研究/行情系统；具体接口待验证。 |
| 事实来源 | 交易记录、KYC/KYB 档案、规则命中、历史案例、研究材料及其时间戳；行情/投研结论必须标来源和时效。 |
| 决策权 | Agent 只能形成风险或投研建议；冻结/放行资金、提升风险等级、拒绝客户、发布外部投研结论由具名人类按 `AuthorityGrant` 决定。 |
| Handoff | 异常识别 → 证据聚合 → 风控/合规复核 → 处置或申诉 → 规则 Owner。 |
| Human Gate | 资金处置、客户拒绝、重大风险结论、对外投研发布、政策例外。 |
| 业务指标 | 已处置风险事项、资金损失避免值、投研采用率；金额口径由模拟数据定义。 |
| 风险指标 | 误报/漏报率、越权资金动作数、未解释风险结论数、申诉改判率。 |
| 效率指标 | 告警到具名 owner 时长、证据聚合时长、Gate 决策时长、重开率。 |
| 异常路径 | 交易与客户档案冲突 → 阻断动作并升级合规；模型置信不足或 provider 失败 → 仅记录非权威 trace；执行超时 → receipt 为 `unknown`，先查账再重试。 |
| 共性字段 | 与 3.1 相同；本场景重点压力测试 temporal authority、具名 Gate、幂等执行回执和 evidence freshness。 |
| 场景扩展字段 | `transactionId`、`riskTier`、`regulationRef`、`instrumentId`、`customerDueDiligenceRef`，位于 `scenarioExtensions.finance`。 |

### 3.3 视频生成：多模态内容生产

证据 ID：`BYTE-014`、`BAIDU-005`、`OPPO-001`、`BYTE-004`、`BYTE-016`。

| 字段 | 冻结内容 |
| --- | --- |
| Trigger | **推断**：视频/图像 brief、素材生产需求、批量生成、质量回检或发布准备。 |
| 人类角色 | **事实+推断**：多模态模型/生成团队；创意、品牌、运营、审核、版权/法务、算法/渲染工程。 |
| RoutableAgent | 脚本/分镜 Agent、生成编排 Agent、质量检查 Agent、版权/安全检查 Agent。 |
| ExternalSystem | 素材库、品牌规范库、模型/渲染服务、编辑工具、审核与发布系统。 |
| 事实来源 | brief 版本、品牌规范、输入素材许可、生成参数/批次、质量检测、版权/安全检查结果。 |
| 决策权 | Agent 可生成候选和质检建议；创意定稿、品牌例外、版权/人物风险和大规模投放由具名人类决定。 |
| Handoff | brief → 分镜/素材 → 批量生成 → 质量/安全复核 → 发布/迭代。 |
| Human Gate | 品牌主视觉、人物/版权风险、敏感内容、大规模投放或预算越界。 |
| 业务指标 | 素材采用率、投放/内容效果、单位可用素材成本。 |
| 风险指标 | 品牌规范违例、版权/安全漏检、错误发布、无来源素材数。 |
| 效率指标 | brief 到首版时长、每可用素材生成轮次、复核时长、GPU/Token/渲染资源利用率。 |
| 异常路径 | 素材许可不明或检查冲突 → Gate；生成服务失败 → receipt 失败且不标记“已完成”；品牌规范更新 → 旧 `ContextVersion` 失效并重新检查。 |
| 共性字段 | 与 3.1 相同；本场景重点验证大对象只存引用、上下文版本和多次外部执行回执。 |
| 场景扩展字段 | `assetId`、`briefVersion`、`brandPolicyVersion`、`renderBatchId`、`rightsClaimRef`，位于 `scenarioExtensions.videoGeneration`。 |

### 3.4 本地生活：履约、运营与大规模 Agent 协作

证据 ID：`MEITUAN-S01`、`MEITUAN-S02`、`MEITUAN-S03`、`BOSS-003`。其中三条为 strategy/product 信号，不能冒充岗位或效果证据。

| 字段 | 冻结内容 |
| --- | --- |
| Trigger | **推断**：订单高峰、履约异常、门店/商家运营问题、员工自动化请求。 |
| 人类角色 | **事实+推断**：企业 Agent 工作台相关团队；运营、调度、商家运营、客服、风控、区域负责人、研发。 |
| RoutableAgent | 履约诊断 Agent、商家运营 Agent、客服 Agent、知识 Agent、升级路由 Agent。 |
| ExternalSystem | 订单、配送/地图调度、商家、用户、客服、员工协作系统。 |
| 事实来源 | 订单/履约事件、司机/商家状态、服务工单、补偿政策、区域运营观测。公开的用户/订单/员工/Agent 数量仅是规模信号。 |
| 决策权 | Agent 可诊断和给补偿/调度建议；大额补偿、批量调度、商家处罚和敏感回复由配置中的具名负责人决定。 |
| Handoff | 事件监测 → Agent 诊断 → 责任团队接单 → 人工处置 → 结果回写/复盘。 |
| Human Gate | 大额或批量补偿、批量调度、商家处罚、政策例外、敏感客户回复。 |
| 业务指标 | 履约完成率、订单取消率、商家问题闭环率；不把规模信号当效果。 |
| 风险指标 | 错误补偿、错误处罚、批量调度事故、敏感信息回复、无 owner 超时事项。 |
| 效率指标 | 告警到接单时长、异常解决时长、人工接触次数、交接澄清率。 |
| 异常路径 | 多区域同时高峰 → 按影响分级并升级区域负责人；地图/订单状态冲突 → 标记证据冲突；补偿执行未知 → 查 receipt 后才允许重试。 |
| 共性字段 | 与 3.1 相同；本场景重点验证并发 WorkCase、批量 Trigger、优先级、receipt 去重和降级。 |
| 场景扩展字段 | `orderId`、`merchantId`、`dispatchRegion`、`compensationBand`、`peakWindow`，位于 `scenarioExtensions.localServices`。 |

### 3.5 企业自动化：知识、办公与跨部门流程

证据 ID：`BAIDU-003`、`BYTE-010`、`BYTE-011`、`BYTE-015`、`OPPO-007`。

| 字段 | 冻结内容 |
| --- | --- |
| Trigger | **推断**：员工查询、文档/流程处理、内部服务请求、跨部门审批。 |
| 人类角色 | **事实+推断**：办公 Agent、企业知识库、协作自动化和 IT AI 重构团队；业务员工、流程 Owner、数据 Owner、IT、法务、安全、审批人。 |
| RoutableAgent | 知识检索 Agent、流程执行 Agent、审批辅助 Agent、系统集成 Agent。 |
| ExternalSystem | OA、知识库、ERP、CRM、工单、HR/财务系统；报告事实覆盖营销、供应链、研发、财务、HR、办公。 |
| 事实来源 | 权限受控文档、流程规则、业务记录、审批历史、系统字段；摘要必须保留 source ref、权限范围和新鲜度。 |
| 决策权 | 流程 Owner 决定规则，数据 Owner 决定访问，业务审批人决定结果采用；Agent 不得扩大权限或自行批准不可逆变更。 |
| Handoff | 请求进入 → 权限/上下文校验 → 跨系统准备 → 人工审批 → 执行回执与证据归档。 |
| Human Gate | 越权请求、对外发布、财务/HR 变更、不可逆系统写入、规则例外。 |
| 业务指标 | 请求完成率、知识答案采用率、自动化覆盖的合格事项数。 |
| 风险指标 | 权限泄露、过期知识采用、错误审批、不可逆写入、缺少来源答案。 |
| 效率指标 | 员工节省时间、请求周期、跨系统人工复制次数、首次正确交接率。 |
| 异常路径 | 权限不一致 → 零模型调用或最小化上下文并升级数据 Owner；来源冲突 → Exception；外部系统部分成功 → 为每个 action 分别保存 receipt，不做整体成功假象。 |
| 共性字段 | 与 3.1 相同；本场景重点验证 scoped context、数据分类、跨系统动作批次和部分失败。 |
| 场景扩展字段 | `requestId`、`dataClassification`、`businessSystemFieldRef`、`approvalRouteRef`、`documentSetRef`，位于 `scenarioExtensions.enterpriseAutomation`。 |

### 3.6 供应链：采购、物流与异常处置

证据 ID：`BYTE-012`、`JD-006`、`HUAWEI-005`、`OPPO-007`、`MEITUAN-S02`。

| 字段 | 冻结内容 |
| --- | --- |
| Trigger | **推断**：采购需求、供应商异常、库存/物流偏差、履约成本超标。 |
| 人类角色 | **事实+推断**：采购 Agent、物流 AI、企业供应链 IT 团队；采购、计划、仓储、物流、财务、法务、供应商负责人。 |
| RoutableAgent | 采购需求 Agent、供应商风险 Agent、库存/履约诊断 Agent、合同证据 Agent。 |
| ExternalSystem | ERP、SRM、WMS、TMS、合同/票据库、供应商主数据。 |
| 事实来源 | 采购单、库存、运输事件、供应商档案、合同版本、发票/付款状态；每个系统保留 source-of-truth 字段。 |
| 决策权 | Agent 可评估影响和给方案；供应商准入/切换、订单/价格/合同变更、加急运输、索赔和付款由具名授权人决定。 |
| Handoff | 异常事件 → 影响评估 → 方案比选 → 具名批准 → 多系统执行 → 结果追踪。 |
| Human Gate | 供应商切换、合同/价格变更、付款、大额库存处置、重大加急成本。 |
| 业务指标 | 准时足量交付率、缺货/积压、采购或物流成本、索赔回收。 |
| 风险指标 | 未授权合同/付款、重复订单、供应商风险漏检、错误库存处置、执行无回执。 |
| 效率指标 | 异常发现到 owner 时长、方案到批准时长、人工跟进次数、端到端处置周期。 |
| 异常路径 | ERP/SRM 数据冲突 → Exception 并冻结写入；供应商不可达 → Escalation；多系统部分成功 → 保存分项 receipt 和补偿 ActionIntent；付款未知状态先查账再重试。 |
| 共性字段 | 与 3.1 相同；本场景是 ActionIntent/ExecutionReceipt、补偿动作、证据冲突和 Accepted Handoff 的主展示压力。 |
| 场景扩展字段 | `supplierId`、`purchaseOrderId`、`shipmentId`、`contractVersion`、`inventoryNodeId`，位于 `scenarioExtensions.supplyChain`。 |

### 3.7 客服：多 Agent 服务与客户成功

证据 ID：`BYTE-017`、`JD-009`、`JD-012`、`BAIDU-006`、`BAIDU-002`。

| 字段 | 冻结内容 |
| --- | --- |
| Trigger | **推断**：用户咨询、投诉、售后、服务异常、企业客户项目风险。 |
| 人类角色 | **事实+推断**：多 Agent 客服、智能服务、客户成功团队；一线客服、专家坐席、运营、产品、质量/政策负责人。 |
| RoutableAgent | 意图识别 Agent、知识 Agent、执行 Agent、质检 Agent、升级路由 Agent。 |
| ExternalSystem | CRM、工单、知识库、订单/账户、质检、客户反馈系统。 |
| 事实来源 | 对话/工单、客户与订单记录、知识版本、政策、历史处置与质检结果。 |
| 决策权 | Agent 可回复低风险已授权问题或提出动作；退款/补偿、政策例外、重大投诉升级和知识发布由具名人类决定。 |
| Handoff | 识别 → 检索/准备 → 风险/置信判断 → 人工接管 → 质检与知识回流。 |
| Human Gate | 低置信度、高损失、高情绪、政策例外、重大客户承诺。 |
| 业务指标 | 一次解决率、客户问题闭环率、客户成功/留存代理指标。 |
| 风险指标 | 错误承诺、错误退款/补偿、敏感信息泄露、知识过期采用、升级漏失。 |
| 效率指标 | 首次响应、解决时长、人工接管率、交接恢复时长、重复解释次数。 |
| 异常路径 | 客户记录冲突或身份不明 → 禁止账户动作；知识低置信 → Gate；客户断线 → WorkCase 保持 active；执行超时 → receipt unknown 并查询。 |
| 共性字段 | 与 3.1 相同；本场景重点验证高并发、短时 SLA、长事项升级和跨 Agent handoff。 |
| 场景扩展字段 | `conversationId`、`ticketId`、`customerTier`、`sentimentBand`、`compensationBand`，位于 `scenarioExtensions.customerService`。 |

### 3.8 AI Coding：研发全流程与工程效能

证据 ID：`BYTE-007`、`BYTE-008`、`BYTE-009`、`OPPO-006`、`BAIDU-001`。

| 字段 | 冻结内容 |
| --- | --- |
| Trigger | **推断**：需求进入、代码变更、测试失败、发布准备、线上故障。 |
| 人类角色 | **事实+推断**：Coding Agent、评测、研发平台团队；需求 Owner、开发、测试、代码 Owner、安全、发布负责人。 |
| RoutableAgent | 规划 Agent、编码 Agent、测试 Agent、评审 Agent、故障诊断 Agent。 |
| ExternalSystem | 代码库、CI/CD、测试、缺陷、制品库、发布与监控系统；CLI/MCP/SDK/Skill/Sandbox 是工具边界，不是业务 owner。 |
| 事实来源 | issue/需求版本、代码 commit、测试报告、review、制品签名、部署/监控事件。 |
| 决策权 | Agent 可提出计划、代码和测试；需求接受、代码合并、测试豁免、生产发布与回滚由具名人类及系统 policy 决定。 |
| Handoff | 需求 → 计划 → 代码/测试 → 人工 review → 发布 Gate → 监控/回滚。 |
| Human Gate | 合并到受保护分支、测试豁免、权限变更、生产发布、不可逆数据迁移。 |
| 业务指标 | 合格变更交付率、部署成功率、缺陷修复完成率。 |
| 风险指标 | 失败测试豁免、未评审合并、生产事故、秘密泄漏、越权仓库/部署动作。 |
| 效率指标 | lead time、review 周期、测试诊断时长、回滚恢复时长、返工率。 |
| 异常路径 | 测试/安全检查失败 → Gate/Exception；分支变化导致上下文过期 → 新 ContextVersion；部署 receipt unknown → 查询部署系统，禁止重复发布。 |
| 共性字段 | 与 3.1 相同；本场景重点验证工具调用与权威动作分离、版本冲突、并发修改和 rollback receipt。 |
| 场景扩展字段 | `repositoryRef`、`changeSetRef`、`ciRunId`、`releaseId`、`environment`，位于 `scenarioExtensions.aiCoding`。 |

### 3.9 内容治理：审核、风险与申诉闭环

证据 ID：`BYTE-016`、`TENCENT-001`、`TENCENT-002`、`TENCENT-003`、`TENCENT-004`。四条腾讯记录存在公开索引与“暂无岗位开放”冲突，统一按 C 级使用，不声称实时招聘。

| 字段 | 冻结内容 |
| --- | --- |
| Trigger | **推断**：内容/商家准入、风险命中、用户举报、审核申诉、规则更新。 |
| 人类角色 | **事实+推断**：电商治理、商业审核、内容风险、视频号安全团队；审核员、政策、法务、安全、产品、算法。 |
| RoutableAgent | 内容理解 Agent、政策/规则 Agent、证据聚合 Agent、申诉辅助 Agent。 |
| ExternalSystem | 内容库、规则库、审核队列、举报、处罚、申诉系统。 |
| 事实来源 | 原始内容引用、规则版本、模型/规则命中、举报材料、历史审核、申诉证据；拒绝解释必须引用版本。 |
| 决策权 | Agent 可预审和建议；高影响处罚、政策例外、终局申诉、规则发布由具名人类决定。 |
| Handoff | 机器预审 → 人工复核 → 处置 → 申诉 → 规则/样本 Owner。 |
| Human Gate | 高影响账号/商家处罚、政策例外、终局申诉、批量规则发布。 |
| 业务指标 | 合格审核量、违规处置闭环率、申诉闭环率。 |
| 风险指标 | 误杀/漏检、无解释处罚、申诉改判率、政策版本错用、越权处罚。 |
| 效率指标 | 审核时延、申诉周期、澄清率、重复复核率。 |
| 异常路径 | 规则冲突/过期 → 阻断并升级政策 Owner；证据不足 → 澄清而非处罚；外部处罚失败 → receipt failed；申诉改判 → 新事件而非覆盖旧决定。 |
| 共性字段 | 与 3.1 相同；本场景重点验证决定不可覆盖、规则版本、终局 Gate 和完整申诉 replay。 |
| 场景扩展字段 | `contentId`、`policyVersion`、`enforcementLevel`、`appealId`、`accountImpactClass`，位于 `scenarioExtensions.contentGovernance`。 |

### 3.10 终端 OS / IoT：端云协同与量产

证据 ID：`OPPO-003`、`OPPO-004`、`XIAOMI-S03`、`XIAOMI-S04`、`BOSS-002`。小米两条是研究课题，不能冒充独立岗位或量产效果。

| 字段 | 冻结内容 |
| --- | --- |
| Trigger | **推断**：系统级智能调用、跨设备任务、端侧资源受限、量产/设备故障。 |
| 人类角色 | **事实+推断**：系统级 Agent、AIOS、OS 集成、IoT/边缘调度团队；OS、应用、硬件、模型、测试、产品/量产负责人。 |
| RoutableAgent | 设备控制 Agent、端云路由 Agent、个人记忆 Agent、系统诊断 Agent。 |
| ExternalSystem | 设备能力目录、权限/隐私服务、传感器、云模型、OTA、量产测试/故障系统。 |
| 事实来源 | 设备状态、能力/权限、固件版本、传感器观测、端云执行日志、量产测试与故障单。 |
| 决策权 | Agent 可选择建议执行路径；设备权限、敏感数据使用、资源预算、量产准入、物理动作和故障降级由具名人类/确定性系统 policy 决定。 |
| Handoff | 用户/设备意图 → 权限与状态 → 端云编排 → 高风险动作确认 → 执行/回执 → 故障复盘。 |
| Human Gate | 隐私敏感数据、支付、物理设备控制、不可逆动作、量产准入、重大降级。 |
| 业务指标 | 任务成功率、可用设备覆盖、量产通过率。 |
| 风险指标 | 未授权设备动作、隐私数据越界、错误 OTA/量产放行、未知执行状态。 |
| 效率指标 | 端到端时延、故障定位/恢复时长、功耗/内存预算达标率、人工确认时延。 |
| 异常路径 | 端云状态分裂 → 以设备/执行系统 receipt 为准并进入 unknown；离线 → 保持意图未执行；能力/固件不兼容 → Exception；安全级别不足 → 零动作。 |
| 共性字段 | 与 3.1 相同；本场景重点验证离线/未知状态、物理动作 Gate、端云回执和资源指标。 |
| 场景扩展字段 | `deviceId`、`deviceCapabilityRef`、`firmwareVersion`、`executionLocation`、`safetyClass`，位于 `scenarioExtensions.edgeIot`。 |

## 4. 跨场景共性结论

### 4.1 进入统一内核的最小对象

`WorkCase`、`Trigger`、`GoalVersion`、`Evidence`、`ContextVersion`、`HumanPrincipal`、`RoutableAgent`、`ExternalSystem`、`AuthorityGrant`、`HandoffOffer`、`HandoffAcceptance`、`HumanGate`、`ActionIntent`、`ExecutionReceipt`、`ExceptionRecord`、`Escalation`、`MetricObservation`、`BusinessEvent`、`ReplayProjection`。

`WorkItem` 不作为第二聚合根：如果 CRM、工单、代码库或设备平台已有叶子任务，RelayOS 只保存 `ExternalRecordRef`。部门、策略、图例、adapter 配置是控制对象，不是 Agent。

### 4.2 必须留在场景配置或外部系统的内容

- 商品、交易、内容、订单、采购单、设备、代码变更等 domain ID；
- 行业规则、风险等级、补偿带、量产等级、品牌规范、监管条款；
- 外部系统的完整业务事实和二进制材料；
- 场景词汇、角色名称、Agent 责任、触发与 Gate policy、指标公式；
- 模拟数据与展示叙事。

### 4.3 十场景共同验收断言

每个场景必须用同一 API 和 domain command 证明：

1. Trigger 建立 WorkCase 后能定位目标、owner、事实来源和下一步；
2. 目标版本变化不会覆盖历史版本；
3. HandoffOffer 在接受前不改变 owner；
4. 只有指定接收者对仍有效的 offer 接受后 owner 才改变；
5. 只有具名 HumanPrincipal 能解决分配给自己的 Gate；
6. provider 失败、结构无效、歧义或越权时权威写入为 0；
7. 外部动作没有授权或没有 receipt 时不能声称完成；
8. 事件从空投影可重建同一 canonical state；
9. 每场景至少产生一个业务、一个风险、一个效率 `MetricObservation`；
10. 场景扩展不得引入专用状态迁移、专用 API 或专用 UI 分支。

## 5. 场景停止条件

- 任一场景必须把场景扩展字段提升为无边界的通用 JSON 才能运行：停止并重做 adapter/引用边界。
- 任一场景必须新增专用 owner、Gate、handoff 或 action 状态机：停止通用化，不复制内核。
- 模拟数据无法给业务、风险、效率指标定义数据源、Owner、阈值和失败处理：该场景不得标记联调完成。
- C 级或 strategy_topic 证据被写成实时岗位、预算、已达成效果或企业私有流程：立即纠正事实边界。
- 三个展示重点通过、其余七个未通过时，不得宣称“十场景支持”。
