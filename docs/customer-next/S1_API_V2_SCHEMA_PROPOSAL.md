# S1 提案 · v2 API、实体/事件 Schema、权限矩阵与错误码（任务 01）

状态：**设计提案（待总控冻结）**。本文描述的是目标契约，**不是仓库现有能力声明**；v2 路由未实现。冻结后由单一 writer 汇入共享契约（`Back/CONTRACT.md`），实现范围 `Back/A/**`。

通用约定（所有 v2 端点）：

- 鉴权：`X-Principal-Credential`（沿用 v1 可信 principal 机制；测试身份 tok-* 不等于生产身份）。
- 幂等：所有写命令带 `Idempotency-Key` 头；作用域 = `(tenantId, principal, action, resourceType, resourceId, requestId)`。
- 乐观锁：写命令体含 `expectedVersion`；不匹配 → `VERSION_CONFLICT`。
- 范围校验：路径中的 `customerId/facilityId` 必须属于 principal 的 tenant/customer 授权范围，读、写、事件、回执一致（A10）。
- 金额：`*Minor` 整数分 + `currency`（如 `"CNY"`）；禁止浮点。

## 1. 路由提案

```
# 客户
POST   /api/v2/customers                          创建企业法律主体档案
GET    /api/v2/customers/{customerId}             读取（含推导敞口汇总）
POST   /api/v2/customers/{customerId}/relationships      声明关系（附证据引用）
GET    /api/v2/customers/{customerId}/relationships
POST   /api/v2/relationships/{relationshipId}/verify     人工核验关系（DecisionRecord）

# 评估
POST   /api/v2/customers/{customerId}/assessments        创建评估（冻结 evidence snapshot + ruleVersion）
GET    /api/v2/assessments/{assessmentId}
POST   /api/v2/assessments/{assessmentId}/submit-review  collecting → awaiting_human_review

# 额度
POST   /api/v2/customers/{customerId}/facilities         proposed（提案，含候选评估引用）
POST   /api/v2/facilities/{facilityId}/approve           → approved_inactive（人类，DecisionRecord）
POST   /api/v2/facilities/{facilityId}/activate          → active（复查条件/依据，事务内裁决）
POST   /api/v2/facilities/{facilityId}/suspend           → suspended
GET    /api/v2/facilities/{facilityId}                   含推导 available/occupancy/over_limit

# 融资申请与额度占用
POST   /api/v2/customers/{customerId}/financing-requests         draft→submitted
GET    /api/v2/financing-requests/{frId}
POST   /api/v2/financing-requests/{frId}/reserve                 预占（账目 reserve）
POST   /api/v2/reservations/{frId}/release                       释放（补偿账目）
POST   /api/v2/financing-requests/{frId}/commit                  承诺（reserved→committed_undisbursed）
POST   /api/v2/financing-requests/{frId}/settle                  结算（→outstanding；本轮仅受控模拟适配器）

# 事件
GET    /api/v2/customers/{customerId}/events?after=seq           客户域事件增量（outbox 投影）
```

## 2. 实体 Schema（TypeScript 风格，wire 字段）

```ts
interface Customer {
  customerId: string; tenantId: string;
  legalEntityRef: string;            // 统一社会信用代码等，租户内唯一约束
  displayName: string;
  status: 'prospective' | 'active' | 'suspended' | 'closed';
  version: number; createdAt: string; updatedAt: string;
}

interface CustomerRelationship {
  relationshipId: string; tenantId: string;
  fromCustomerId: string; toCustomerId: string;      // 或 externalEntityRef
  type: 'control' | 'guarantee' | 'supplier' | 'related_group';
  evidenceRefs: string[];                            // EvidenceArtifact id
  verificationStatus: 'unverified' | 'verified' | 'disputed';
  validFrom: string; validTo: string | null;
}

interface CreditAssessment {
  assessmentId: string; customerId: string; tenantId: string;
  evidenceSnapshotRef: string;                       // 冻结的证据/事实版本引用
  ruleVersion: string; caliberVersion: string; inputVersion: string;
  status: 'draft' | 'collecting' | 'candidate_ready' | 'awaiting_human_review' | 'stale' | 'superseded';
  candidate: CreditCandidate | null;                 // authority 恒为 none
  version: number;
}

interface CreditCandidate {           // 严格 Schema，替代 v1 子串禁键（仅 v2 路径）
  authority: 'none';                                 // 强制常量，服务端写入，客户端不可改
  tendency: 'do' | 'cautious_do' | 'do_with_adjusted_terms' | 'no_do';
  supportableAmountMinor: number | null; currency: string;
  conditions: string[]; rationale: string;
  producedBy: string;                                // 模型/工具标识
  warnings: string[];
}

interface CreditFacility {
  facilityId: string; customerId: string; tenantId: string;
  approvedAmountMinor: number; currency: string;     // 整数分
  effectiveFrom: string; effectiveTo: string;
  revolving: boolean;                                // 默认 false，见待决政策 P-02
  productScope: ('direct_lease' | 'sale_leaseback')[];
  conditions: string[];
  approvalChainRef: string[];                        // DecisionRecord id（批准链）
  basisVersion: { assessmentId: string; ruleVersion: string; evidenceSnapshotRef: string };
  status: 'proposed' | 'approved_inactive' | 'active' | 'suspended' | 'expired' | 'closed';
  version: number;
}

interface FinancingRequest {
  frId: string; customerId: string; facilityId: string; tenantId: string;
  productType: 'direct_lease' | 'sale_leaseback';
  amountMinor: number; currency: string;
  equipmentRefs: string[]; contractRefs: string[];
  status: 'draft' | 'submitted' | 'reserved' | 'committed'
        | 'settle_unknown' | 'settled' | 'cancelled' | 'rejected';
  externalRef: string | null;                        // 受控模拟出账适配器引用
  version: number;
}

interface ExposureEntry {              // 追加式，只增不改不删
  entryId: string; seq: number; facilityId: string; customerId: string; tenantId: string;
  entryType: 'reserve' | 'reserve_expire' | 'reserve_release'
           | 'commit' | 'commit_cancel' | 'settle' | 'adjust';
  amountMinor: number; currency: string;             // 恒正，方向由 entryType 决定
  frId: string; requestId: string; txId: string;     // txId=与业务写同事务
  createdAt: string;
}
```

推导视图（`GET facility` 返回，服务端计算）：

```ts
interface FacilityExposureView {
  approvedAmountMinor: number; currency: string;
  outstandingMinor: number; committedUndisbursedMinor: number; activeReservedMinor: number;
  availableForNewDrawMinor: number;   // 冻结/暂停/到期/stale 时强制 0
  overLimit: boolean;                 // 降额低于存量敞口时 true，保留实际敞口
  staleBlockers: string[];            // 依据失效/政策未决阻断清单
}
```

## 3. 事件（outbox 投影，同事务写入）

```
CUSTOMER_CREATED / CUSTOMER_STATUS_CHANGED
RELATIONSHIP_DECLARED / RELATIONSHIP_VERIFIED
ASSESSMENT_CREATED / ASSESSMENT_CANDIDATE_READY / ASSESSMENT_SUBMITTED_FOR_REVIEW / ASSESSMENT_STALE
FACILITY_PROPOSED / FACILITY_APPROVED / FACILITY_ACTIVATED / FACILITY_SUSPENDED / FACILITY_CLOSED
FR_SUBMITTED / RESERVATION_PLACED / RESERVATION_RELEASED / RESERVATION_EXPIRED
FR_COMMITTED / SETTLE_SENT / SETTLE_CONFIRMED / SETTLE_UNKNOWN_RECONCILE_OPENED
LEDGER_ENTRY_APPENDED          // 每个 ExposureEntry 一条，携带 entryType/amount/seq
DECISION_RECORDED              // 每个人类正式决定一条
```

事件体含 `customerId/tenantId/seq/version`；消费方不得从事件反推绕过命令通道的状态变更。

## 4. 权限矩阵（提案起点；生产矩阵须由公司批准后录入授权目录）

原则：矩阵条目缺失 = `policy_pending`，动作拒绝（fail-closed）。测试身份不进生产矩阵。

| 动作 | business | credit | policy | commerce | asset | approver | admin | jianwei | agent |
|---|---|---|---|---|---|---|---|---|---|
| customer.create / relationship.declare | ✓ | – | – | – | – | – | ✓ | – | – |
| relationship.verify | – | ✓ | ✓ | – | – | ✓ | – | – | – |
| assessment.create / submit-review | – | ✓ | – | – | – | – | – | – | – |
| candidate 产出（评估内） | – | – | – | – | – | – | – | – | ✓（authority=none） |
| facility.propose | – | ✓ | – | – | – | – | – | – | – |
| facility.approve | – | – | – | – | – | ✓（金额档待矩阵） | – | ✗（不默认） | – |
| facility.activate / suspend | – | – | – | – | – | ✓ | – | ✗（不默认） | – |
| financing-request.create / reserve / release | ✓ | – | – | – | – | – | – | – | – |
| commit / settle | ✓ | – | – | – | – | ✓（复核档待矩阵） | – | – | – |
| decision.*（正式授信决定） | – | – | – | – | – | 按批准矩阵 | – | 按批准矩阵 | –（永不） |

金额分档（如 ≤100 万 / ≤500 万 / ≤1,000 万）作为矩阵列维度，具体档位数值为**待决政策 P-05**，未录入前一律 `policy_pending`。

## 5. 错误码（v2，结构化返回 `{code, message, details}`）

| code | HTTP | 语义 / 对应测试 |
|---|---|---|
| `PERMISSION_DENIED` | 403 | principal/角色/金额档不满足（A19） |
| `CUSTOMER_SCOPE_VIOLATION` | 403 | 跨客户/租户读写读事件取回执（A10） |
| `POLICY_PENDING` | 409 | 权限矩阵/规则缺失，不猜测（红线未决） |
| `VERSION_CONFLICT` | 409 | expectedVersion 不匹配 |
| `IDEMPOTENCY_REPLAY_CONFLICT` | 409 | 同 requestId 异载荷（A09） |
| `CUSTOMER_MERGE_BLOCKED` | 409 | 仅凭同名/同联系人合并被拒（A02/A03） |
| `FACILITY_NOT_ACTIVE` | 409 | 非 active/过期/暂停下新增支用（A17/A14） |
| `INSUFFICIENT_AVAILABLE_AMOUNT` | 409 | 可用额不足，并发只允许一笔成功（A07/A01） |
| `PRODUCT_CAP_EXCEEDED` | 409 | 超 1,000 万产品上限，含币种与单位细节（A06） |
| `STALE_BASIS` | 409 | 依据已失效，须重新评估（A15/A16） |
| `RESERVATION_IRREVERSIBLE_STATE` | 409 | 外部状态 unknown，禁止自动释放/盲重发（A12/A13） |
| `CURRENCY_MISMATCH` | 409 | 币种不一致（A06） |
| `CONCENTRATION_BLOCKED` | 409 | 公司/关联组集中度约束未过 |
| `NOT_FOUND` | 404 | 资源不存在或范围外（不泄露存在性） |

## 6. 候选 Schema 与旧禁键策略的衔接

- v1 `/api/v1/**` 的 `quota|price|rate|approv|decision|reject` 子串禁键**原样保留**，v1 行为不变。
- v2 候选输出走 `CreditCandidate` 严格 Schema：字段白名单、类型校验、`authority` 服务端强制为 `none`、拒绝未声明字段。B/C 产出经此 Schema 校验后作为评估候选落库；任何字段（含 `supportableAmountMinor`）都无法触碰额度状态机——激活/批准只有人类命令通道（A18/A21）。
- 子串黑名单到结构化白名单的切换是**新增**而非替换：两套并存于各自版本路径，避免"删校验放任 JSON"。
