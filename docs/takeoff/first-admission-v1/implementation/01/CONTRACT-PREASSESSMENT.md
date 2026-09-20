# 契约冻结 · 首次回租准入预评估确认（A 权威面增量）

版本：**v2.6 增量（TAKEOFF-FA-1.0.0）**｜发布日期：2026-09-20｜writer：ZCode·A 权威路｜状态：**FROZEN（本文件发布后，字段以本文为准；实现与样例实测核对记录见 TEST_RESULTS.md）**

消费者：Front（02 路）、Edge（04 路）、Connectors（03 路）、集成验收（04 路）。其他路只读本契约；接口异议按仓库约定写各自目录的 `interface-change-request.md`。

基线：`main@8c6d3b0`（不回退）；现行契约 `Back/CONTRACT.md` §0–§12 全部有效，本增量全部为**加法**，不改变旧 `decide`（reject/withdraw）、`facility.approve`、`submitCandidate` 既有字段语义。登记指针同步写入 `Back/CONTRACT.md` §13。

---

## 1. 语义边界（最高基线 01 文件第 2/8 节的落实）

- `confirm-preassessment` = **有权人员确认预评估结论**（支持 / 附条件支持 / 不支持）。确认只产生 `scope=preassessment_only` 的预评估结果：**不创建、不激活、不预占任何正式额度；不创建融资申请；不写敞口账本。**
- 预评估确认 ≠ `facility.approve` ≠ 额度激活 ≠ 可提款。禁止借正式授信接口或占位设施完成预评估。
- 行政撤回沿用既有 `POST /api/v2/assessments/:assessmentId/decide` `decision=withdraw_assessment`（→ `superseded`），语义一字不改；与"不支持"结论严格区分（撤回不是风险拒绝）。
- 旧 `reject_assessment` 语义不变；本轮产品的负面终结走本命令 `outcome=not_support`。

## 2. 新命令

### 2.1 `POST /api/v2/assessments/:assessmentId/confirm-preassessment`

请求体（camelCase；凭据走 `X-Principal-Credential` 头，同既有约定）：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `requestId` | string 1..128 | 是 | 幂等键；同号同载荷单效果，异载荷 409 |
| `tenantId` | string ≤64 | 是 | 与评估租户一致，不一致按 404（不泄露存在性） |
| `assessmentVersion` | int ≥1 | 是 | 乐观锁：必须等于 `credit_assessments.version` 当前值 |
| `outcome` | string | 是 | `support` \| `support_with_conditions` \| `not_support` |
| `candidateRevision` | int ≥1 | 条件 | 正/附条件结论必填且须等于当前候选修订号；`not_support` 且存在候选时必填；无候选时省略 |
| `inputVersion` | int ≥0 | 否 | 调用方持有的输入版本期望；提供时必须等于当前 `input_version` |
| `ruleVersion` | string ≤64 | 否 | 调用方持有的规则版本期望；提供时必须等于生效规则版本（候选声明优先，缺省用评估行） |
| `snapshotHash` | string ≤128 | 否 | 调用方持有的快照哈希期望；提供时必须一致 |
| `conditions` | string[] ≤20 项、每项 ≤500 | 条件 | `support_with_conditions` 必须非空；`support` 与 `not_support` 必须为空数组或省略 |
| `rationale` | string 1..2000 | 是 | 结论主要依据（负面终结同样必须记录依据） |

未知字段一律 400 `INVALID_INPUT`（与 `submitCandidate` 同一严格 Schema 口径）。载荷不含任何授权/角色字段；身份与权限只来自服务端认证上下文。

成功响应 200：

```jsonc
{
  ok: true,
  confirmationId: "pac-<hex>",        // preassessment_confirmations 主键
  scope: "preassessment_only",        // 恒定；机器可断言
  assessmentId, customerId, tenantId,
  outcome,                            // 原样回显
  status: "preassessment_confirmed",  // 评估新状态
  assessmentVersion: <确认后版本>,     // = 请求版本 + 1
  candidateRevision: <int|null>,
  inputVersion: <int>,
  snapshotHash, ruleVersion,
  conditions: [...], rationale,
  confirmedBy: "<principalId>", confirmedAt: "<ISO>"
}
```

### 2.2 服务端门序（事务内全部重查；任一失败零写入）

固定顺序（与既有锁序/幂等纪律一致）：

1. **幂等外层**：`withCommandV2(action='assessment.confirm-preassessment')`——requestId 校验、鉴权、载荷哈希；外层命中不直接返回，落事务经全部门后锁内 `replayed` 出口（撤权/改派后重放不借缓存）。
2. **评估行锁** `FOR UPDATE`；租户/客户授权 `scopeByRow`（越权统一 404）。
3. **人类身份**：`requireHuman`——agent/service principal 一律 403 `PERMISSION_DENIED`。
4. **目录角色**：`requireDirectoryRole(['credit'])`——服务端目录信审角色；**业务（business）等角色默认无此权限**；载荷声明无效。测试用明确合成的 `credit` 身份（如 `tok-credit`）。
5. **锁内幂等复查** `ctx.replayed(tx)`。
6. **载荷 Schema**：outcome 白名单、conditions 与 outcome 匹配、revision/version 类型。
7. **版本门**：`assessmentVersion` ≠ 当前行版本 → 409 `VERSION_CONFLICT {serverVersion}`；`candidateRevision` ≠ 当前候选修订 → 409 `VERSION_CONFLICT {scope:'candidate', serverCandidateRevision}`；显式传入的 `inputVersion`/`ruleVersion`/`snapshotHash` 不匹配 → 409 `STALE_BASIS`。
8. **状态门**：
   - `support`/`support_with_conditions`：要求 `status='awaiting_human_review'` 且存在候选；
   - `not_support`：允许 `collecting | candidate_ready | awaiting_human_review`（重大拒绝依据已核实即可记录负面终结，不要求无决策价值的工作先刷绿）；
   - 其余状态（含 `preassessment_confirmed`、`superseded`、`rejected`）→ 409 `NOT_READY`。
9. **结果相关硬门（按 outcome 区分）**：
   - 正/附条件：`stale=false`；快照工件逐一仍现行（`FOR SHARE` 查 `superseded_by/duplicate_of`）；候选登记 `inputVersion` = 当前 `input_version`（旧方案不得在输入前移后确认）；**客户当前最新 Gate 回执非 `CLEAR`（`HARD_BLOCK`/`NEEDS_EVIDENCE`/`HOLD_FOR_REVIEW`）→ 409 `GATE_BLOCKED`（附 `gateReceiptId/gateResult/ruleIds/reasonCodes`；不可豁免门，解冻只随新收口产生；回执为 `CLEAR` 但其 `ruleset_version` 已非当前激活规则包 → 409 `STALE_BASIS`，须按当前规则重新收口；无回执→409 GATE_BLOCKED；无激活规则、候选规则与回执/激活规则不一致、回执 evidenceRefs 与评估快照集合不一致→409 STALE_BASIS；空证据不放行。来源材料为快照依据，解析派生记录不作为额外独立证据）**；无未处理关键差异（复用 `assertNoBlockingFindings(action='preassessment.confirm')`）→ 409 `REVIEW_REQUIRED`；快照内同一 `factKey` 存在多份现行冲突断言 → 409 `REVIEW_REQUIRED {conflicts}`（重要冲突阻断正面确认；解冻走补证/纠正/复核，不可一键豁免）。
   - `not_support`：以上硬门**不适用**（冻结/冲突/硬阻断不阻止有依据的负面记录，快照按当时实况入档）。
10. **写入（同事务）**：`credit_assessments.status='preassessment_confirmed'`、`version+1`；`preassessment_confirmations` 插入（UNIQUE(assessment_id)，二次确认被状态门拒绝）；`decision_records`（action=`preassessment.confirm`，role_ref=`credit`，permission_ref=`directory:credit`）；`audit_events`；outbox 事件 `PREASSESSMENT_CONFIRMED`；幂等回执。
11. **账本不变量（机器断言口径）**：本命令对 `credit_facilities`、`financing_requests`、`exposure_entries` **零新增、零变化**。测试在命令前后整表快照比对。

### 2.3 错误码

| HTTP | code | 场景 |
|---|---|---|
| 400 | `INVALID_INPUT` | 载荷非法（未知字段/outcome/conditions 不匹配/缺版本） |
| 403 | `PERMISSION_DENIED` | agent/service；无 `credit` 目录角色 |
| 403 | `PRINCIPAL_UNTRUSTED` | 凭据无法验证（假身份） |
| 404 | `NOT_FOUND` | 评估不存在/跨租户/越权（不泄露存在性） |
| 409 | `VERSION_CONFLICT` | `assessmentVersion` 或 `candidateRevision` 已前移（附服务端当前值） |
| 409 | `STALE_BASIS` | stale=true（正/附条件）；快照工件被取代；候选 inputVersion 落后；显式 rule/snapshot 期望不符 |
| 409 | `REVIEW_REQUIRED` | 未处理关键差异；快照内事实冲突（仅阻断正/附条件） |
| 409 | `GATE_BLOCKED` | 客户最新 Gate 回执非 CLEAR（HARD_BLOCK/NEEDS_EVIDENCE/HOLD_FOR_REVIEW；仅阻断正/附条件；附回执与规则明细） |
| 409 | `NOT_READY` | 状态门（重复确认、撤回后确认、无候选的正/附条件） |
| 409 | `IDEMPOTENCY_REPLAY_CONFLICT` | 同 requestId 异载荷 |
| 200 | `replayed:true` | 并发同号同载荷重放返回原响应 |

## 3. 候选方案修订历史（`submitCandidate` 兼容扩展）

### 3.1 请求字段（全部可选，与既有白名单并存）

| 新字段 | 类型 | 校验 |
|---|---|---|
| `suggestedTermMonths` | int 1..240 | 建议期限（月） |
| `referencePriceMinor` | int ≥0 | 参考价格（分） |
| `priceUnit` | string ≤64 | 价格单位口径（如 `per_annum_rate_bps`/`upfront_fee_minor`）；提供价格时必填 |
| `priceBasis` | string ≤128 | 价格口径说明；提供价格时必填 |
| `basisRefs` | string[] ≤50 | 依据工件 id；逐件校验属本客户且现行 |
| `runRefs` | string[] ≤20、每项 ≤128 | 模型/分析运行引用 |
| `changeReason` | string ≤500 | 与上一版相比的变化理由 |
| `ruleVersion` | string ≤64 | 产出时规则版本（服务端记录，确认时复核） |

既有字段（`tendency/supportableAmountMinor/currency/conditions/rationale/producedBy/warnings`）语义不变；未知字段仍 400；`authority` 仍禁带（服务端恒 `none`）。

### 3.2 服务端行为（加法）

- 服务端盖章：`revision = 该评估历史最大修订 + 1`；`inputVersion = 评估当前 input_version`；`producedAt`。调用方不能自报 revision。
- 每次提交**追加一行**到 `assessment_candidates`（历史永不改写）；既有 `credit_assessments.candidate` jsonb 列继续同步写"当前版"（含新字段），老消费者零破坏。
- 状态门加法放宽：`awaiting_human_review` 亦可在候选修订（补证重算→方案修订）；此时状态保持 `awaiting_human_review` 不回退。`collecting|draft → candidate_ready` 原语义不变；`stale=true` 仍 409 `STALE_BASIS`（迟到旧结果不得覆盖新版，T08）。
- 响应加法新增：`revision`、`inputVersion`、`producedAt`。

### 3.3 候选历史读回

`GET /api/v2/assessments/:assessmentId/candidates`（内部读，权限同 `GET /assessments/:id`：客户联系人 403、越权 404）：

```jsonc
{ ok: true, assessmentId, candidates: [ { revision, tendency, suggestedAmountMinor|null, currency,
    suggestedTermMonths|null, referencePriceMinor|null, priceUnit|null, priceBasis|null,
    conditions, rationale, producedBy, warnings, basisRefs, runRefs, changeReason|null,
    ruleVersion, inputVersion, producedAt, isCurrent: bool } ], currentRevision: int|null }
```

## 4. 评估读回加法（`GET /api/v2/assessments/:assessmentId` 及按客户清单）

既有字段全部不变；新增：

```jsonc
inputVersion: int,                    // 输入版本（快照受影响取代事件 +1；历史不从零伪造）
candidateRevision: int|null,          // 当前候选修订号
preassessment: {                      // null=尚无确认
  confirmationId, outcome, scope: "preassessment_only",
  conditions, rationale, confirmedBy, confirmedAt,
  assessmentVersion, candidateRevision, inputVersion, snapshotHash, ruleVersion,
  needsReview: bool, reviewReason: string|null, reviewMarkedAt: string|null
} | null
```

**新证据失效投影**：确认后，若快照内工件被显式 `supersede`（重要新证据/纠正），A 在同一事务内将受影响评估标 `stale`（既有行为）**并且**将 `preassessment_confirmations.needs_review=true`（附 `review_reason/review_marked_at`），同时发出事件 `PREASSESSMENT_REVIEW_FLAGGED`。**历史确认永不覆盖、永不删除**——读方只看到"旧结论 + 需复核"标记，不得默认重开或改写正式决定。

## 5. 加法迁移计划（`migrations/012_takeoff_preassessment.sql`）

只新增对象/列/枚举值，不删不改既有行；回退方式 = 保留对象停用入口（与 008–011 同一口径）。

1. `ALTER TABLE credit_assessments ADD COLUMN input_version int NOT NULL DEFAULT 0;`
2. `credit_assessments.status` CHECK 约束扩展：新增 `'preassessment_confirmed'`（先 DROP 旧 CHECK 再 ADD；不改动既有枚举值与行数据）。
3. 新表 `assessment_candidates`：候选修订历史（UNIQUE(assessment_id, revision)；含 §3 全部字段 + tenant/customer FK + produced_at）。
4. 新表 `preassessment_confirmations`：UNIQUE(assessment_id)；含 §4 投影字段 + needs_review 三列 + role_ref/permission_ref；`scope` CHECK 恒 `preassessment_only`。
5. 一次性回填：对既有 `candidate IS NOT NULL` 的评估行，从 legacy jsonb 生成 `revision=1` 历史行（字段缺失即 NULL，不编造）；`input_version` 保持 0（历史事实不推定）。
6. 不 seed 任何"生产"权限/政策数据；预评估确认授权走服务端目录角色（无矩阵新条目需求）。

## 6. 新事件

| 事件 | 载荷 |
|---|---|
| `PREASSESSMENT_CONFIRMED` | `{confirmationId, assessmentId, customerId, outcome, candidateRevision, scope:'preassessment_only', confirmedBy}` |
| `PREASSESSMENT_REVIEW_FLAGGED` | `{confirmationId, assessmentId, reason:'snapshot_artifact_superseded', superseded, newArtifactId}` |

## 7. 二十格读模型的责任边界

A 只提供权威原子读取面（工件清单+处理状态、事实断言/冲突、评估+候选历史+确认读回）；**不新建聚合平台、不写第二份格状态**。二十格投影由 Edge 按现有读取面聚合，分母未知输出 `null`，未闭合最高 75%，不按时间推进（口径见 03 文件 §4）。

## 8. 真实样例（请求/响应/错误）

> §8.1–8.4 为按冻结字段编写的代表性样例；**原始实测报文**（真实内核 + 隔离库全链采集，含 GET 读回/候选历史/重放回执）见同目录 `SAMPLES-OBSERVED.md`。409 场景的逐字段断言见 `Back/A/test/preassessment-confirm.test.mjs`（PA-06/07/08/09/10/11/15）。

### 8.1 正面确认（支持）

请求：

```json
{
  "requestId": "req-confirm-001",
  "tenantId": "t1",
  "assessmentVersion": 4,
  "candidateRevision": 2,
  "outcome": "support",
  "rationale": "经营现金流覆盖、设备权属清晰、无未处理差异"
}
```

响应：

```json
{
  "ok": true,
  "confirmationId": "pac-a1b2c3d4e5f6",
  "scope": "preassessment_only",
  "assessmentId": "ass-x1",
  "customerId": "cust-x1",
  "tenantId": "t1",
  "outcome": "support",
  "status": "preassessment_confirmed",
  "assessmentVersion": 5,
  "candidateRevision": 2,
  "inputVersion": 1,
  "snapshotHash": "9f86d081884c7d65…",
  "ruleVersion": "rules-synth-takeoff-1",
  "conditions": [],
  "rationale": "经营现金流覆盖、设备权属清晰、无未处理差异",
  "confirmedBy": "cindy",
  "confirmedAt": "2026-09-20T08:30:00.000Z"
}
```

### 8.2 附条件支持（conditions 非空）

```json
{
  "requestId": "req-confirm-002",
  "tenantId": "t1",
  "assessmentVersion": 4,
  "candidateRevision": 2,
  "outcome": "support_with_conditions",
  "conditions": ["补齐近 12 个月纳税申报表后放款前复核", "设备保险第一受益人变更"],
  "rationale": "负债线索未完全核实，需补证后条件化支持"
}
```

### 8.3 负面结论（无候选也可，硬门不适用）

```json
{
  "requestId": "req-confirm-003",
  "tenantId": "t1",
  "assessmentVersion": 2,
  "outcome": "not_support",
  "rationale": "政策硬条件不满足已核实（行业禁入类），其余分析不再需要"
}
```

### 8.4 错误样例

```json
// 409 VERSION_CONFLICT：评估版本已前移
{ "ok": false, "error": "VERSION_CONFLICT", "message": "评估版本已前移：请求 4，当前 6", "serverVersion": 6 }

// 409 REVIEW_REQUIRED：快照内同一事实键冲突阻断正面确认
{ "ok": false, "error": "REVIEW_REQUIRED", "message": "快照存在未解决事实冲突：equipment_price——补证/纠正/复核后才能正面确认", "conflicts": [{ "factKey": "equipment_price", "assertionCount": 2 }] }

// 403 PERMISSION_DENIED：业务角色无信审确认权
{ "ok": false, "error": "PERMISSION_DENIED", "message": "动作 assessment.confirm-preassessment 需要服务端目录角色 credit（载荷声明无效）" }

// 409 STALE_BASIS：确认前重要新证据取代快照工件
{ "ok": false, "error": "STALE_BASIS", "message": "评估依据已失效：快照工件 art-01 已被取代，须重新评估后确认" }

// 409 NOT_READY：重复确认
{ "ok": false, "error": "NOT_READY", "message": "评估当前 preassessment_confirmed：预评估结论已确认，不可再次确认" }
```

## 9. 消费方动作（04/02 路）

- Edge：新增 `confirm-preassessment` 代理路由（凭据服务端保管；客户归属从会话/权威评估确定，不收前端自报客户）；读回用 §4 加法字段。
- Front：确认交互绑定 `assessmentVersion + candidateRevision`，冲突时按 `serverVersion/serverCandidateRevision` 刷新重试；确认后展示 `scope=preassessment_only` 徽标与 `needsReview` 提示。
- 04 集成验收按 T09/T10/T11/T12 断言，含账本零变化整表比对。

## 10. 本契约与旧语义的兼容声明

- `decideAssessment`（reject/withdraw）、`proposeFacility/approveFacility/...`、`submitCandidate` 既有字段与错误语义**零变化**；`submitCandidate` 仅加法放宽与加法字段。
- `credit_assessments.status` 新枚举值 `preassessment_confirmed` 为加法；存量行数据零迁移改写（仅候选历史回填式新增行）。
- 幂等、锁序（客户→评估行）、审计、事件、错误码映射全部复用既有机制。

## 11. 五域词表扩展（OBS-03-01，2026-09-20 增补）

TAKEOFF 五列词表 `business/policy/credit/commerce/asset` 全线进入 A：`DOMAINS` 扩展、分析运行/豁免/依据包 domainDeps 校验统一引用（词表外仍 400）；迁移 `013_five_domain_vocab.sql` 重建四表 `domain` CHECK（只放宽枚举、零行改写）。**03 路接通=其 `aRegisterDomains` 配置加 `'business'`，零代码变更**；既有四域调用与数据零影响；必需域政策仍由显式配置声明，fail-closed 语义不变。登记见 `Back/CONTRACT.md` §13.4。

## 12. 首次回租需求登记（2026-09-20 增补；迁移 `014_admission_request.sql`）

客户**首次回租需求**（商机列：产品/申请金额/用途/设备范围）是评估级客户表述，**不是融资申请**——绝不写 `financing_requests`（正式申请须绑定额度设施，预评估轮禁止；PA-18 以账本整表比对断言）。

### 12.1 创建时携带（`POST /api/v2/customers/:customerId/assessments` 加法可选字段 `request`）

```jsonc
request: {
  productType: "sale_leaseback",        // 必填；本轮恒定（其他值 400）
  requestedAmountMinor: int|null,       // 申请金额（分；客户表述；未知省略=null，页面待补）
  currency: "CNY",                      // 缺省 CNY
  requestedTermMonths: int|null,        // 1..240
  purpose: string|null,                 // 用途 ≤200
  equipmentScope: string[],             // 设备范围 ≤50 项（描述或材料引用）
  note: string|null                     // ≤500
}
```

严格 Schema（未知字段 400）。服务端盖章 `declaredBy/declaredAt`，`revision=1`。

### 12.2 创建后修正（新命令）

`POST /api/v2/assessments/:assessmentId/admission-request`：人类 `business|credit` 目录角色（商机归属；agent/service 403）；绑定 `requestId/tenantId/assessmentVersion`（乐观锁，冲突 409 `VERSION_CONFLICT` 附 `serverVersion`）+ 同形 `request`。语义：**整块快照式替换**（不与旧版合并）；`revision+1`；首次 `declaredAt` 保留、`updatedAt` 刷新；审计 + 事件 `ADMISSION_REQUEST_UPDATED`；评估 `version+1`。状态门：结论确认后（`preassessment_confirmed`）与终态一律 409 `NOT_READY`——需求随结论冻结。

### 12.3 读回

`GET /api/v2/assessments/:id` 与按客户清单加法新增：`request`（规范形状，含 `revision/declaredBy/declaredAt/updatedAt`）与顶部镜像字段 `requestedAmountMinor`（同值；Edge `admission-projection` 既有读取路径零改动即可取到）。存量评估无需求 → 两处均 `null`（页面"待补"，未知≠0）。
