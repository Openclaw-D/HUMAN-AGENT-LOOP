# S1 提案 · 客户级授信领域 ADR（任务 01）

状态：**设计提案（待总控冻结，非已批准契约）**。日期：2026-09-16。依据：`JW_customer_credit_backend_tasks/00_READ_FIRST.md`、`01_CUSTOMER_CREDIT_KERNEL.md` §4、远端 main `5497576` 上的 `Back/CONTRACT.md`（v1.3）与 `V02_FRONT_BACK_MAPPING.md`、S0 核验（`LOCAL_BASELINE.md`）。

本文不宣称仓库已有任何此处描述的实体、路由或能力；产品实现（S2+）待本提案冻结后按 `Back/A/**` 范围另行授权实施。模型/Agent authority=none；正式权威属于人。

## D1 客户 = 企业法律主体，禁止自动合并

- 新实体 `Customer`：`tenantId`、`customerId`、`legalEntityRef`（统一社会信用代码等法定标识）、`displayName`、`status`、`version`（乐观锁）。企业微信联系人是渠道信息，**不是**客户法律主体的替代或证明。
- 新实体 `CustomerRelationship`：`relationshipId`、`fromCustomerId`、`toCustomerId`（或外部主体引用）、`type ∈ {control, guarantee, supplier, related_group, …}`、`evidenceRefs[]`、`verificationStatus ∈ {unverified, verified, disputed}`、`validFrom/validTo`。
- 关系不确定时保留 `unverified` 待核验，**不得**据此自动合并客户档案（测试 A02/A03）。同名、同电话、同联系人均不构成合并依据；合并只能由人类正式决定并记录 `DecisionRecord`。
- 状态机（提案）：`prospective → active → suspended → closed`；任何状态变更写 `DecisionRecord` 或系统事件，不可静默。

## D2 三层业务分层：Customer → CreditFacility → FinancingRequest

- `Customer`（法律主体）→ `CreditFacility`（一次人类批准的授信额度）→ `FinancingRequest`（该额度下一笔具体融资/支用）。
- 直租（direct_lease）与回租（sale_leaseback）的必要要件保留在 `FinancingRequest`（交易层）：`productType`、租赁物清单引用、合同引用、交易链引用；不为此拆分两种额度体系。
- 现有 `Project` 保留为执行/场景实例，新增可空 `customerId` 关联；旧 `projectId` 不被静默重用，不能把多个企业的项目仅按名称挂到同一客户（S2 迁移期未匹配者标 `legacy_unassigned`）。

## D3 评估与额度严格分离；候选 authority=none

- 新实体 `CreditAssessment`：`assessmentId`、`customerId`、`evidenceSnapshot`（证据与事实版本冻结引用）、`ruleVersion`、`caliberVersion`、`inputVersion`、`status`、候选输出。
- 状态机：`draft → collecting → candidate_ready → awaiting_human_review`。评估终点是"待人类审阅"；批准/拒绝由人类动作另行记录，评估本身不产生额度效力。
- 资料变化只触发**新评估**：有利证据可能提高可支持金额，不利证据可能降低、暂停或不支持；金额不随资料数量单调增加（测试 A04/A05）。候选输出字段可以是金额/条件（A18），但带 `authority: "none"` 标记，仅能进入 `awaiting_human_review`，永远不能直接激活额度或改写账本。
- 依据失效（supersede/冲突/规则更新）按依赖映射将受影响评估标 `stale`；`stale` 评估不得作为新正式决定的依据（S4 实现，机制此处定型）。

## D4 额度账本：互斥三态 + 同事务账目，余额是推导值

- 新实体 `CreditFacility`：`facilityId`、`customerId`、`approvedAmountMinor`、`currency`、`effectiveFrom/effectiveTo`、`revolving`（默认 false，见待决政策）、`productScope[]`、`conditions[]`、`approvalChainRef`（→ `DecisionRecord`）、`basisVersion`（评估+规则+证据版本）、`status`、`version`。
- 状态机：`proposed → approved_inactive → active → suspended | expired | closed`。**拒绝是评估决定（`DecisionRecord`），不存在"被拒额度"处于任何占用状态**；`approved_inactive` 只能来自人类批准。
- 新实体 `ExposureEntry`（追加式账目）：`entryId`、`facilityId`、`customerId`、`entryType ∈ {reserve, reserve_expire, reserve_release, commit, commit_cancel, settle, adjust, …}`、`amountMinor`（正数，方向由 entryType 决定）、`currency`、`requestId`、`financingRequestId`、`txId`（与业务写同数据库事务）、`createdAt`、`seq`。**不删除、不改写原账**；取消/结算用补偿或结算事件留痕。
- 互斥三态：`reserved`（有效预占）→ `committed_undisbursed`（承诺未出账）→ `outstanding`（已用未偿本金）。同一金额任一时刻只属于其中一格；"有效占用" = 按账目推导的三态之和，**不是**可被客户端覆盖的余额字段。
- 可用额度（仅 `active`、未过期、条件满足、依据有效时）：`available = max(0, approvedAmountMinor − outstanding − committed_undisbursed − activeReserved)`。冻结、暂停、到期、关键复核未决时**新增支用可用额为 0**（存量展示保留）。
- 降额低于存量敞口时：保留实际敞口历史，设施显示 `over_limit` 超额状态并禁止新增支用；不得篡改历史使余额"看起来合规"（测试 A16）。
- 额度上限：1,000 万元人民币为客户级**产品上限配置**（`config.customerCreditCapCnyMinor = 1_000_000_000` 分），不是监管限额、不是默认批准额；币种必须显式一致，跨币种比较拒绝（A06）。公司资本、集中度、关联组约束单独建约束（D7），不因客户未达上限而默认可放。

## D5 金额与数值

- 一切货币金额内部用**整数分**（`*Minor` 字段，int64），JSON 序列化一律字符串或整数（提案：整数），禁止浮点；币种 `currency` 必填（默认账本按单币种设施约束，跨币种汇兑不在本轮）。
- 比率/覆盖率等派生值输出为带 `unit`/`formulaVersion` 的结构化字段（沿用 C calc 输出纪律），不参与额度账本运算。

## D6 并发与幂等（S3 实现的契约基线）

- 所有额度占用经**单一约束入口**（客户 → 主额度）：数据库事务锁（`SELECT … FOR UPDATE` 按固定顺序 `customerId → facilityId` 加锁，关联组场景固定组内排序），或实现时证明等价的并发控制。
- 幂等键作用域 = `(tenantId, principal, action, resourceType, resourceId, requestId)`。**权限校验必须发生在返回任何缓存回执之前**——不得用他人 requestId 读取敏感结果（A10/A11）。
- 同 requestId + 同有效载荷重放 → 返回原效应（同一账目，不新增）；同 requestId + 异载荷 → 显式冲突（A08/A09），原数据零副作用。
- 预占有效期只允许自动清理"确定未发送/未承诺"的请求；外部执行状态 `unknown` 的占用**不得**超时自动释放，必须持有并进入对账/人工复核（A12），防止释放后重用导致双重支用。本轮外部出账只对受控模拟适配器测试，不宣称 exactly-once（A13 用幂等结算事件处理）。

## D7 正式动作与权限（人类权威）

- 新实体 `DecisionRecord`：`decisionId`、`humanPrincipal`（可信身份，非 UI 自报）、`action`、`roleRef`（服务端授权目录中的职责）、`permissionRef`（已批准权限矩阵条目）、`subjectType/subjectId`、`ruleVersion`、`factVersion/evidenceSnapshotRef`、`rationale`、`conditions[]`、`beforeVersion/afterVersion`、`decidedAt`。
- `complete`、`accept`、`decide` 不改为同义词：验收技术产物（accept goal）≠ 批准客户授信（decide credit）。`jianwei` **不**默认是所有额度动作的超级审批人（修订 R2 映射 §4 的一刀切做法在授信域不适用）。
- 额度批准/激活/暂停/例外/支用确认的"角色 × 动作 × 金额档"权限，从**服务端授权目录 + 已批准权限矩阵**读取（S1_SCHEMA_PROPOSAL §权限矩阵为提案起点）；矩阵缺失该条目 → `policy_pending`，动作拒绝，不猜测。任何人类测试身份（tok-*）不等于生产身份。
- 每个写命令执行时重新验证全部前提：可信 principal → tenant/customer 范围 → 动作权限 → `expectedVersion` → 幂等 → 规则与证据新鲜度 → 条件与上限。UI 隐藏按钮不是安全边界（A19/A10）。
- 批准事务内**复查**当前依据版本与阻断状态（stale/政策冻结），避免"检查时通过、提交前变化"竞态（A15/A14）；历史已批准记录保留不改写，后续动作可冻结待复核。`staleReviewAck` 仅作技术兼容项，不得通用放行不可豁免规则。

## D8 证据与事实分层（S2 落地，契约此处定型）

- `EvidenceArtifact`（原始材料，含发票、购销合同等）与 `FactAssertion`（关于业务事实的断言，引用 artifact）分离；两者多对多引用可追溯。
- 发票与购销合同**并存**（修订 R2 映射 §3 的"同一 kind 取代"设计）；只有"同一文档的更正版"才按显式 `supersedes` 关系取代。合同较晚上传**不得**抹去发票金额或掩盖冲突（A20 冲突双留痕，禁止 last-write-wins）。
- 四域共享同一来源可追溯的感知与证据；同一份材料的四次复述不是四份独立证明。

## D9 API 版本化与兼容

- 新业务 API 以 `/api/v2/**` 发布（路由与 Schema 见 `S1_API_V2_SCHEMA_PROPOSAL.md`）；旧 `/api/v1/**` 保持明确兼容期（见 `S1_MIGRATION_AND_COMPAT.md`），不在本轮改动其行为。
- 修复旧 `quota|price|rate` 子串禁键的方式：v2 采用**严格结构化候选结果 Schema**（字段白名单 + 类型 + authority=none 强制），v1 既有安全校验原样保留，不删校验、不放任任意 JSON。
- 所有 v2 读、事件、回执、媒体元数据一律校验 tenant/customer 范围（A10）。

## D10 账本属性测试与审计重建

- 账本正确性以属性测试证明：随机 `reserve/commit/settle/cancel/retry` 序列（固定种子，失败序列留档），检查金额守恒、有效占用 ≤ 批准额、无未授权状态跃迁、由 `ExposureEntry` + `DecisionRecord` + 事件流可重建任意时点状态（A01–A24 映射见 `S1_MIGRATION_AND_COMPAT.md` §4）。

## 后果与未决

- 本 ADR 冻结后：S2 落客户归集与证据映射；S3 落账本与并发；S4 落权限与 stale。四域 Agent 策略（任务 03）不在本 ADR 范围。
- 待决政策及 safe default 集中列于 `S1_MIGRATION_AND_COMPAT.md` §3；未冻结前按 safe default 行为，不得自行猜测公司规则。
