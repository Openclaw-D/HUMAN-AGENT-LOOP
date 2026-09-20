# 03路冻结调用协议 · TAKEOFF-FA-1.0.0（v1.0，2026-09-20）

writer：ZCode 03路。本文件是 03路（Back/B、Back/C、Back/Connectors）对外冻结的调用协议，
**02路（Front）与04路（Edge）按此消费**。变更须在本文件登记版本号；破坏性变更须先回报 owner。
依据：01_TAKEOFF_CORE_AUTHORITY.md（五列=商机/政策/信审/商务/资产）、04_BACKEND_ADAPTATION.md §3 数据流。

## 1. 材料类型词表（冻结）

上传入口：Edge `/api/jw/v2/actions/connectors/evidence/upload` → Connectors `POST /api/connectors/evidence/upload`，
`kind` 字段取值如下（邀请 `allowedEvidenceKinds` 必须含该 kind，见 §6）。

**TAKEOFF 首次回租准入新增（本轮起生效；04路夹具词表按此核对，无需改字节）：**

| kind | 语义 | 重算依赖域（byEvidenceKind） | 解析行为 |
|---|---|---|---|
| `legal_document` | 主体资料（营业执照/章程/身份证明） | policy, business | PDF 文本可提取→declared 事实；扫描→FORMAT_UNSUPPORTED 转人工 |
| `financial_statement` | 经营/负债资料（资产负债表/利润表） | credit, commerce, business | CSV/XLSX 按列提取 declared 事实+语义映射（§2） |
| `equipment_list` | 拟回租设备清单（范围/净值/权属声明） | asset, commerce | 行记录提取；净值/权属→declared，待核验 |
| `ownership_document` | 权属支持（发票/登记证扫描件） | asset, policy | 图片/扫描→FORMAT_UNSUPPORTED 转人工（不 OCR、不编造） |
| `order_contract` | 订单/经营合同（改善或恶化证据） | business, credit | PDF 文本提取 declared 事实 |
| `litigation_document` | 涉诉/处罚通知（不利/冲突证据） | policy, credit, business | PDF 文本提取 declared 事实；触发冲突结构 |

**既有词表（沿用，兼容不删）**：`statement`（银行流水）、`tax_filing`、`sales_purchase`、`accounting_ledger`、
`equipment_contract`、`site_evidence`、`document`（通用）、`transcript`、`message`、`device_observation`、
`image`、`video`、`audio`。

**保守规则**：未知 kind 不拒绝上传（登记照常），分析侧按 `document` 保守处理；不猜测语义。

## 2. 事实键语义映射（确定性，declared 级）

解析产出的原始列事实经确定性映射补齐规则包消费键（全部 declared 级，附 sourceRefs 行引用；**未知=null，
不编造**）。映射表（本轮冻结；缺失输入不产出对应键）：

| 源（kind+列/键） | 目标事实键 | 说明 |
|---|---|---|
| financial_statement 列 `revenue_wan`（或 key=value `revenue`） | `revenue_annual_declared` | 年收入声明（万元原值+单位） |
| financial_statement 列 `total_liabilities_wan` / `total_assets_wan` | `total_liabilities_declared` / `total_assets_declared` | 负债/资产声明 |
| financial_statement 列 `net_fixed_assets_wan` | `net_fixed_assets_declared` | 固定资产净值 |
| equipment_list 行聚合（Σ net_book_value_wan） | `equipment_net_book_value_total` | 设备净值合计（每行 sourceRefs 保留） |
| equipment_list 行 `ownership=self-owned`（全行一致） | `equipment_ownership_declared` | 权属**声明**（≠verified；verified 只能由人工核验产生） |
| equipment_list 行 `model` | `equipment_model` | 型号（规则消费键，沿用既有映射） |
| order_contract 文本键值（`order_amount` 等） | `new_order_amount_declared` | 新订单金额声明 |
| litigation_document 文本键值（`case_status` 等） | `litigation_pending_declared` | 未决诉讼声明（true/描述） |
| legal_document 键值（`legal_name`/`uniform_social_credit_code` 等） | 原样保留 declared | 主体身份声明（不自动=verified） |

同键多值冲突保留（感知层 conflicts），不以最后上传覆盖。key=value 风格 CSV/文本走既有
`extractKvCsvFacts` 通道，键名原样保留。

## 3. 五域词表与助手职责（冻结）

| domain 键 | 显示名 | 职责边界（确定性评估器；authority=none） |
|---|---|---|
| `business` | 商机 | 需求与经营动向：订单/收入动向、回租需求合理性；不用资料页数提额，不从视频热闹程度推收入 |
| `policy` | 政策 | 规则适用面：激活规则命中/前提缺失/policy_pending；不凭模型记忆新造红线 |
| `credit` | 信审 | 偿债与经营：覆盖率、集中度、新增负债；未知不补数 |
| `commerce` | 商务 | 交易结构：期限/租金/付款交付条件/成本；成本未知不产净收益数值 |
| `asset` | 资产 | 准入资产核验：存在性/型号序列/权属/价值；不把看见设备等同所有权；**可与信审并行，不被商务整列锁定** |

**助手=职责不是常驻进程**：五域评估器只在处理事件/明确调用时执行；`jianwei`（见微）为汇总职责
（跨域收口 next-step），不独立常驻。去重：同输入同规则域结果缓存复用（消费面签名）；事件×依赖映射
决定重算面（无关留言=零重算）；重复上传/转换格式/助手复述不产生独立证明力、不重复登记。

**部分并行（T03）**：域评估互相独立，只按事实依赖设门。资产核验输入（设备/权属类事实）就绪即评，
不等待商务；设备清单（equipment_list）依赖映射只含 asset/commerce，不含整列锁。

## 4. 任务类型与 B 路由（冻结）

A goal/任务 `taskKind` 取值（B router 消费；`config/routes-four-domain.json`）：

| taskKind | 计划 |
|---|---|
| `takeoff_evaluation` | fd:perception → fd:assess:{business,policy,credit,commerce,asset} → fd:gate → fd:questions → fd:amount → fd:nextstep |
| `takeoff_recalc`（role∈五域） | fd:perception → fd:assess:<role> → fd:gate |
| `takeoff_gate` | fd:gate |
| `four_domain_evaluation` / `four_domain_recalc` / `four_domain_gate` | 保留兼容（四域旧面） |

roles 词表：`business, policy, credit, commerce, asset, jianwei`。NO_ROUTE 升级人工。

## 5. 候选方案产出（amountCandidate v2，冻结）

收口产物（`analysis_finalizations.amount_candidate`，authority=none；只读投影，非正式授信语义）。
**A 侧 submitCandidate 字段映射待01路冻结后接线**，本结构为03路内部产出与读面契约：

```jsonc
{
  "evaluable": true,                    // false 时只给 gaps[]，不凑数字
  "tendency": "increase|decrease|hold|unchanged",   // 相对前版：可增可减可冻结
  "supportable": { "min": 0, "max": 0, "currency": "CNY" },
  "suggestedTerm": { "value": 36, "unit": "month", "basis": "<口径说明>" },  // 期限候选
  "referencePrice": { "value": 0, "currency": "CNY", "basis": "<价格口径：合成名义口径，非机构定价>" },
  "conditions": ["..."],                // 待满足条件（未知=null 语义：缺口列表 gaps）
  "gaps": ["..."],                      // 不可评估原因/缺输入（不假完成）
  "frozen": false,                      // 冻结标志（重要冲突/硬门命中=true）
  "frozenReasons": ["ruleId/冲突标识"],  // 冻结原因（解除须对应证据被取代/纠正，不一键解除）
  "version": {                          // 同版协议锚（01冻结前的内部形态）
    "inputWatermarkGeneration": 0,      // 感知水位代
    "inputSnapshotHash": "...",         // 输入快照哈希
    "rulesetVersion": "...",            // 规则包版本
    "formulaVersion": "sim-linear-amount@2"
  },
  "changeReason": "...",                // 与前版差异原因（无前版=null）
  "previousRef": { "finId": "...", "inputHash": "..." } | null,  // 前版引用
  "basedOn": { "materialIds": ["..."], "runRefs": {"<domain>": "runId"}, "gateReceipt": "..." }
}
```

**行为约束**：金额可增可减（新证据方向决定，不由材料数量决定）；旧运行迟到结果不得覆盖新版本
（收口键=inputHash+规则版本；域缓存低代次回写拒绝 CACHE_STALE_WRITE）；冻结解除只随对应
证据被取代/人工核验后新收口自然产生；负面结论不要求无价值工作刷绿。

### 5.1 候选 v2 → A submitCandidate 字段映射（01路契约 §13.2 冻结后补，消费方=02/04）

03路候选（Connectors 收口 `amountCandidate` v2，authority=none）到 A `submitCandidate`
（Back/CONTRACT.md §13.2 加法扩展字段）的映射；调用方（Edge/前端提案面）按下表消费：

| 03路候选字段 | A submitCandidate 字段 | 说明 |
|---|---|---|
| `suggestedTerm.value` | `suggestedTermMonths` | 1..240；缺配置=null 不传 |
| `referencePrice.value` | `referencePriceMinor` | 03路值为币种主单位（元）；minor=×100 |
| `referencePrice.caliber` | `priceUnit` | 提供价格时必填 |
| `referencePrice.basis` | `priceBasis` | 提供价格时必填；合成口径声明随行 |
| `basedOn.materialIds` | `basisRefs[]` | 须经 a_links（local evidence_id→aArtifactId）换算为 A 引用后传入；A 校验属主+现行 |
| `basedOn.runRefs`（域→runId） | `runRefs[]` | runId 为 A analysis-runs 发号 |
| `changeReason` | `changeReason` | 直传（无前版=null 不传） |
| `version.rulesetVersion` | `ruleVersion` | 直传 |
| （服务端盖章） | `revision` / `inputVersion` | A 侧产生；03路 `version.inputWatermarkGeneration/inputSnapshotHash` 为本地水位锚，不冒充 A 版本 |
| `candidateRange`/`gaps`/`frozen` | 不映射 | 区间/缺口/冻结为 03路收口投影；A 侧 tendency 等由消费方按 §13 状态门提交 |

注意：`frozen=true`（Gate HOLD/HARD）时**不应**提交正面候选修订到 A（对应 §13 确认门的
STALE_BASIS/REVIEW_REQUIRED 校验）；补证/纠正后新收口解冻再提交。

## 6. 权限与外发边界（冻结，不放宽）

- Connectors `/api/connectors/**` 全部服务令牌面；页面身份裁决在 Edge（04路 channel-authz）。
- 上传 kind 须在邀请 `allowed_evidence_kinds` 内；TAKEOFF 邀请建议清单=§1 全表（按角色收敛由04路定）。
- 客户映射权威=`a_customer_links`（legalEntityRef 证明）；禁止按文件名/同名推断客户。
- 模型输出 authority=none（schema 层强制）；材料内"忽略规则/直接批准"类文本是数据不是指令，
  处理链不赋予任何系统/审批权限。
- 真实模型 API：**未获本轮授权，0 调用**；transport 预留，预算门（BUDGET_EXCEEDED 失败关闭）照常。
  成本未知不记 0（billKnown=false）。流式：**未接**（HTTP 完整读取）；取消=步边界；超时=AbortController
  （超时→unknown 三分语义，不自动重试）。首字时间未测，不承诺。
- 默认 outboundPolicy=suggest_only；真实企微/TRTC 外发默认关闭。

## 7. 读面（本轮新增，04路消费）

- `GET /api/connectors/analysis/finalization?tenantId=&customerId=`（服务令牌面）：返回当前最新收口
  （gate/questionPlan/amountCandidate v2/nextStep + inputHash/rulesetVersion/watermark + artifactRefs）。
  无收口=404 `NO_FINALIZATION`。跨客户查询拒绝（tenant+customer 维度强制）。
- 处理任务/回执读面沿用：`GET /api/connectors/processing/tasks/:taskId`、
  `GET /api/connectors/processing/receipts/:requestId`。

## 8. 版本记录

- v1.0（2026-09-20）：初版冻结。五域词表、材料 kind 六种新增、事实键语义映射、amountCandidate v2、
  takeoff_* taskKind、finalization 读面、流式=未接等边界据实声明。
- v1.1（2026-09-20）：01路契约 §13（v2.6）冻结后，补 §5.1 候选 v2 → A submitCandidate 字段映射；
  A 域枚举未扩（business 的 A 运行登记维持 a_domain_enum_pending 跳过）。
