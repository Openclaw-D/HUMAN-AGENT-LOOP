# 见微 V3 API and Event Contract

更新：2026-08-30  
状态：`FROZEN CONTROL CONTRACT / IMPLEMENTATION PENDING`  
上位权威：`V3_DIRECTION_FREEZE.md` Gate 1–19  
相关契约：`V3_GOLDEN_CASE_SCENARIO_CONTRACT.md`、`V3_ROLE_PROJECTION_CONTRACT.md`、`V3_DEMO_NARRATIVE_CONTRACT.md`、`V3_ACCEPTANCE_MATRIX.md`

## 1. Contract 目标与停止边界

本契约冻结比赛 Demo 所需的最小 Backend Authority surface：一个 `FinancingLeasingCase` Aggregate、Evidence staging、三次具名 `ContextCommit`、异步五路 Process Run、Role Projection、Human Gate、Management Action、正式起租 Receipt 与 replay。

它不是生产 Backend 设计。当前允许继续使用进程内 demo runtime、固定 Scenario seed 与本地合成 principal；不建设生产数据库、SSO、完整 RBAC、规则部署平台、高可用或真实内网 Adapter。

## 2. V2 可继承与必须替换的边界

### 2.1 必须继承的 engineering invariants

- append-only Authority Event Ledger；
- 单个 runtime epoch 内严格递增 sequence；
- canonical idempotency（幂等性）：同 key 同 payload 精确 replay，同 key 异 payload 冲突；
- bounded request body、invalid / timeout / injected failure 的 fail-closed；
- Context Packet 由 Backend 按 principal 与任务生成；
- model / Agent `authority=none`；
- Projection 可以删除重建，不能反向改写 Authority；
- 正式动作必须形成具名 Receipt。

### 2.2 必须替换的 V2 语义

- 四路 `policy / credit / commerce / asset` 改为五路 `opportunity / policy / credit / commercial / asset`；
- 二十个固定线性 flow 与精确百分比不进入 V3 Authority；
- Evidence 每上传一次立即递增 Context 改为 Evidence staging + 具名 `ContextCommit`；
- 任意字符串 `actor` 改为 server-resolved principal；
- generic decision 改为 typed professional Gate、Management Action 与 Commencement Action；
- current-only Context 改为 baseline snapshot + append-only Diff / Event + checkpoint / replay；
- universal projection 改为 backend-enforced Role Projection；
- 同步生成四条 `candidate_ready` 改为五路独立状态、partial completion 与 stale / superseded。

旧 V2 测试可以作为 regression foundation，但不能作为 V3 Acceptance PASS。

## 3. 核心标识与基础类型

```ts
type ProcessId =
  | "opportunity"
  | "policy"
  | "credit"
  | "commercial"
  | "asset";

type ScenarioRef = {
  scenarioId: "JW-V3-DL-GOLDEN-001";
  scenarioVersion: string;
  seed: string;
  businessItemType: "FinancingLeasingCase";
  dataClass: "synthetic_deidentified_demo";
};

type PrincipalRef = {
  principalId: string;
  roleApplicationId: "leadership" | "business" | "risk" | "external";
  professionalScope?: "policy" | "credit" | "commercial" | "asset" | "management";
  externalParty?: "customer" | "supplier";
  invitationId?: string;
  authority: "confirmed" | "none";
};

type ContextRef = {
  runtimeEpoch: string;
  contextSeq: number;
  contextVersion: string;
  previousContextVersion: string | null;
  transitionCode: "BASELINE" | "T1" | "T2" | "T3";
  diffId: string;
  sourceReceiptIds: string[];
};
```

- `contextSeq` 只在成功 `ContextCommit` 时递增；baseline 为 `0`，T1/T2/T3 分别最多递增一次。
- `contextVersion` 可以显示为 `CTX-0000...CTX-0003`，但跨 reset 的全局 identity 必须包含 `runtimeEpoch`。
- Gate、Management Action、Commencement Action、普通 Chat 与 Process Run 状态更新均绑定当前 Context，不为了制造版本号而递增 Context。
- `caseId=FL-DEMO-001` 是 Golden Case；背景 Case 是独立 read model record，不共享 Golden runtime。

## 4. Evidence staging 与 ContextCommit

### 4.1 Evidence 接受

Evidence 上传、外部回答或结构化事实候选先形成 principal-scoped Evidence Receipt：

```text
evidenceId
evidenceReceiptId
caseId
principalId / invitationId
evidenceType
sourceRef / contentHash
status = accepted | rejected
recordedAt
```

- `accepted` 表示 Evidence 已进入不可覆盖的 staging ledger，不表示已成为当前 Case Context，也不触发五路 run。
- 同一 Evidence 可以被后续一个 `ContextCommit` 引用；已引用 Evidence 不得被静默修改。
- 普通 Chat、Agent answer、未确认文件或解析 candidate 不能直接进入 Context。

### 4.2 `ContextCommit`

一个 `ContextCommit` 把一个逻辑批次的已接受 Evidence / confirmed facts 原子写入新 Context：

```text
requestId / idempotencyKey
transitionCode = T1 | T2 | T3
expectedContextVersion
evidenceReceiptIds[]
confirmedFactIds[]
rationale
```

成功必须在一个 Authority transaction 中：

1. 验证 principal、Scenario transition、Evidence ownership / invitation、必要来源与 `expectedContextVersion`；
2. 追加一个 typed Context Diff；
3. 创建唯一新 `ContextRef`；
4. 将上一 Context 的 current Process Run 标记为 `superseded`；
5. 为五个 `ProcessId` 各创建一条绑定新 Context 的 queued run；
6. 生成 `ContextCommitReceipt`，引用 Diff、Evidence Receipt 与五条 run；
7. 派生 current Role Projection。

上述 1–6 任一失败时，整个 commit 不得产生半套成功状态。Commit 成功后，单条 Process Run 可以独立失败或待补件，不回滚已确认的 Context，其他四路继续运行。

Golden Scenario 的授权固定为：

- T1：`business-owner` 具名确认；
- T2：`external-customer` 在指定 invitation 中确认该风险事实，并执行该 workstep 唯一允许的 commit；
- T3：客户与供应商分别形成 Evidence Receipt，由 `business-owner` 对同一 pending batch 具名确认并只 commit 一次。

## 5. 五路 Process Run

```ts
type ProcessRun = {
  runId: string;
  caseId: string;
  processId: ProcessId;
  boundContextVersion: string;
  sourceEventId: string;
  status:
    | "queued"
    | "running"
    | "partial"
    | "needs_input"
    | "ready_for_gate"
    | "completed"
    | "failed"
    | "superseded";
  readinessBand: 0 | 1 | 2 | 3 | 4;
  riskBand: "unknown" | "low" | "medium" | "high";
  evidenceCoverageBand: 0 | 1 | 2 | 3 | 4;
  gateState: "not_ready" | "ready" | "confirmed" | "rejected" | "returned_for_evidence";
  supersededByContextVersion?: string;
  startedAt?: string;
  updatedAt: string;
};
```

- 一个 `ContextCommit` 必须一次性创建五条 run binding，但五路结果独立产生、不同时间刷新；不得伪装为原子同时完成。
- Demo 可以使用 deterministic scheduler（确定性调度器）模拟不同完成时间，不要求五个 OS worker 或五次真实模型调用；但状态变化必须真实存在于 Backend 并能 polling / replay。
- T2 的 `credit` 必须至少出现 `needs_input` 或 readiness 回退；其余四路按自身影响分别推进、保持或变化，不复制模板。
- 新 Context 产生后，旧 run 只能显示为 stale / superseded；迟到结果不得覆盖 current state。
- readiness、risk、Evidence coverage 分离；V3 UI 不显示精确业务百分比。

## 6. Human Gate、Management Action 与正式起租

### 6.1 Professional Human Gate

```text
requestId / idempotencyKey
expectedContextVersion
processId = policy | credit | commercial | asset
gateMode = HUMAN_CONFIRM | HUMAN_DECIDE
decision = confirm | reject | return_for_evidence
rationale
evidenceReceiptIds[]
```

`HumanGateReceipt` 至少包含：

```text
receiptId / eventId / gateId
caseId / contextVersion
principalId / processId / gateMode / decision
rationale / evidenceReceiptIds[] / recordedAt
```

- 只有四个对应 risk principal 可以提交本专业 Gate；业务、协同、外联和其他专业 principal 均必须被 Backend 拒绝。
- Gate 绑定最新 current Context；对 stale Context 的提交返回 `CONTEXT_VERSION_CONFLICT`。
- Gate 不自动创建新 Context，也不能用模型 candidate 代替 Human Receipt。

### 6.2 Management Action

协同可以在具名确认后形成：

```text
requestId / expectedContextVersion
actionCode
targetPrincipalIds[]
rationale
evidenceOrProjectionRefs[]
```

成功生成 `MANAGEMENT_ACTION_RECORDED` Event 与 Receipt，并出现在目标角色反馈中。它可以追问、要求复核、确定优先级或请求方案，但不能修改专业 Gate 结论、客户事实或起租条件。

### 6.3 Commencement Action

正式起租由 `risk-commercial` 提交，Backend 根据 versioned `CommencementConditionSet` 验证 Scenario 所需 Gate、合同、付款、设备 / 物流查验与 Evidence Receipt：

```text
requestId / expectedContextVersion
conditionSetVersion
requiredReceiptIds[]
rationale
```

成功必须原子产生：

- `LEASE_COMMENCEMENT_RECORDED` Event；
- 引用全部必要上游 Receipt 的 `CommencementReceipt`；
- `commencementBand=5`；
- `lifecycleStatus=active_lease`；
- Case / Portfolio / KPI Projection 的同源更新。

Asset Gate 是否为某个 Scenario 的硬前提由 `CommencementConditionSet` 配置，不在通用 schema 中硬编码。正式起租后五格不因租后风险回退；租后管理不进入当前 Demo 主链。

## 7. Authority Event envelope

```ts
type AuthorityEvent = {
  eventId: string;
  runtimeEpoch: string;
  sequence: number;
  caseId: string;
  scenarioVersion: string;
  type: EventType;
  actor: PrincipalRef;
  correlationId: string;
  causationId: string | null;
  contextVersion?: string;
  recordedAt: string;
  payload: unknown;
};
```

最小冻结 `EventType`：

```text
SCENARIO_BASELINE_INITIALIZED
EVIDENCE_ACCEPTED
CONTEXT_COMMIT_RECORDED
PROCESS_RUNS_SUPERSEDED
PROCESS_RUNS_TRIGGERED
PROCESS_RUN_STATUS_CHANGED
HUMAN_GATE_RECORDED
MANAGEMENT_ACTION_RECORDED
LEASE_COMMENCEMENT_RECORDED
MESSAGE_RECEIVED
CANDIDATE_ANSWER_RECORDED
```

- 每个 Event type 使用自己的 validated payload；不得让任意字符串 payload 承担 Diff、run、Receipt 与 condition reference。
- system / Agent Event 的 `actor.authority=none`；Human Authority Event 必须绑定 canonical principal。
- `sequence` 在 runtime epoch 内严格递增；`eventId`、idempotency scope 和 replay identity 必须包含 epoch，避免 reset 后 `EVT-0001` 冲突。
- Projection 不是权威 Event；可随时从 baseline + Diff / Event + current Scenario read model 重建。

## 8. 最小 API surface

所有 mutating route 使用 bounded JSON、统一 error shape、idempotency key 与 server-resolved principal。路径允许实现阶段做不改变语义的命名调整，但下列 capability 不得缺失：

```text
POST /api/demo/session
POST /api/demo/reset
GET  /api/demo/scenario

GET  /api/cases
GET  /api/portfolio/projection
GET  /api/cases/:caseId/projection
GET  /api/cases/:caseId/events
GET  /api/cases/:caseId/context-versions
GET  /api/cases/:caseId/receipts/:receiptId

POST /api/cases/:caseId/evidence
POST /api/cases/:caseId/context-commits
POST /api/cases/:caseId/messages
POST /api/cases/:caseId/gates/:processId/decisions
POST /api/cases/:caseId/actions/management
POST /api/cases/:caseId/actions/commencement
```

### 8.1 Demo identity 与 reset

- `/api/demo/session` 只选择预置合成 principal / invitation 并创建 server-owned Demo session；它不代表 production auth。
- `/api/demo/reset` 只在明确 Demo / acceptance mode、已知 Scenario 和 controller scope 下启用；每次生成新 `runtimeEpoch`，重建 baseline，清除上轮内存 Evidence、run、Gate、Action 与 Receipt。
- reset 不结束未知进程、不改端口、不依赖浏览器缓存，也不修改背景 Case identity。
- Production claim 中必须明确这是 local synthetic identity 与 in-memory demo persistence。

### 8.2 读取与权限

- `/api/cases` 与 `/projection` 必须使用 `V3_ROLE_PROJECTION_CONTRACT.md` 的 server-side scope；错误 principal / role / invitation fail closed。
- `/events`、`/context-versions` 与 `/receipts/:id` 仍按 principal 最小可见范围过滤；外联不能通过直接 URL 绕过 UI。
- `portfolio/projection` 只返回 role-scoped KPI / Portfolio / sparse Case summary；不建立第二类可写 Aggregate。
- `portfolio/projection` 默认以本期 / 本年 KPI 为主，突出可验证净收入、单位资产产出效率及其目标、应达、实际 / 预测和差值；全周期利润只作为辅助校验与长期影响提示。每个价值指标至少携带 `metricDefinitionId`、`formulaVersion`、`timeScope`、`valueClass=actual|forecast|scenario`、`asOf`、`dataCoverage` 与 `sourceReceiptRefs[]`。
- 净收入基础公式为对应期间总收入减资金成本、渠道成本和附加税；单位资产产出为净收入除以起租金额。尚未接通财务、费用、人力和风险来源时，全周期利润不得返回为 actual。
- 财务、费用、人力或风险输入只有在受控来源与 Receipt 成立后才能进入可审计事实；模型推演和固定参数估算保持 `authority=none`，只派生 forecast / scenario Projection，不得生成财务实际值或替代具名 Human Gate。

### 8.3 统一 error shape

```text
error.code
error.message
error.requestId
error.retryable
```

至少区分：`400 INVALID_INPUT`、`403 scope denial`、`404 unknown resource`、`405 method`、`408 timeout`、`409 idempotency/context conflict`、`413 body too large`、`500 injected/system failure`、`504 model timeout`。任何失败都不得追加成功 Receipt 或显示前端成功。

## 9. Golden Case 规范事件节奏

```text
reset
  SCENARIO_BASELINE_INITIALIZED

T1
  EVIDENCE_ACCEPTED...
  CONTEXT_COMMIT_RECORDED(T1)
  PROCESS_RUNS_TRIGGERED(5)
  PROCESS_RUN_STATUS_CHANGED × N

T2
  EVIDENCE_ACCEPTED(customer risk fact)
  CONTEXT_COMMIT_RECORDED(T2)
  PROCESS_RUNS_SUPERSEDED(T1)
  PROCESS_RUNS_TRIGGERED(5)
  PROCESS_RUN_STATUS_CHANGED × N
  credit => needs_input or readiness regression

T3
  EVIDENCE_ACCEPTED(customer)
  EVIDENCE_ACCEPTED(supplier)
  CONTEXT_COMMIT_RECORDED(T3, two scoped Receipt refs)
  PROCESS_RUNS_SUPERSEDED(T2)
  PROCESS_RUNS_TRIGGERED(5)
  PROCESS_RUN_STATUS_CHANGED × N

Gates / Actions
  HUMAN_GATE_RECORDED(policy, T3)
  HUMAN_GATE_RECORDED(credit, T3)
  HUMAN_GATE_RECORDED(commercial, T3)
  HUMAN_GATE_RECORDED(asset, T3 when condition set requires)
  MANAGEMENT_ACTION_RECORDED(T3, optional in main script)
  LEASE_COMMENCEMENT_RECORDED(T3, upstream Receipt refs)
```

本契约不冻结 `PROCESS_RUN_STATUS_CHANGED` 的精确数量或自然语言输出；它冻结 Event 类型顺序关系、Context binding、Receipt graph 与 T2 信审回退语义。

## 10. Determinism、并发与 replay

- 相同 `scenarioVersion + seed + action script` 三次 full run 的 normalized structure 必须一致：Event type/order relation、T1/T2/T3 transition、五路 binding、stale link、Receipt graph、commencement result 相同。
- `runtimeEpoch`、timestamp 与 event / receipt physical ID 可以变化；验收 comparator 需归一化，不得直接比较这些允许变化字段。
- 两个并发 `ContextCommit` 基于同一 `expectedContextVersion` 时只允许一个成功；另一请求返回 conflict 且不写半套状态。
- 同一 idempotency key 同 payload replay 原结果；异 payload conflict；并发 replay 只产生一次副作用。
- Event pagination 保持 sequence 顺序、无遗漏、无重复；Context replay 能重建 baseline、T1、T2、T3 与正式起租后的 Projection。
- Demo runtime 重启清空是已知限制；正式验收在同一 production build / server process 内完成三次 reset/full run，不通过重启服务救场。

## 11. Acceptance runner contract

实现阶段必须新增 `npm.cmd run v3:acceptance`，最小职责：

1. 创建带 `acceptanceRunId` 的证据目录和 manifest；
2. 记录 workspace / build fingerprint、Scenario、PID、command、port 与 Node version；
3. 运行 `check` 并启动独立 production server；
4. 顺序执行三次 `reset→T1→T2→T3→Gates→commencement→replay`；
5. 执行 normal / invalid / denial / idempotency / concurrency / failure-closed HTTP Gate；
6. 生成 machine-readable Acceptance Matrix result；
7. 缺 Browser evidence 或任何 MUST 失败时保持非零退出；
8. 只清理自己记录的 exact child PID，不接管当前 port 3000 dev Scheduled Task。

Browser evidence 必须与同一 `acceptanceRunId + buildFingerprint + baseUrl` 绑定，由 Codex in-app Browser 完成 1920×1080、1366×768、390×844、四角色、客户 / 供应商、console 与 keyboard Gate。runner 不能用静态 DOM 或旧截图冒充真实浏览器验收。

## 12. 当前明确未冻结

- 五路五个内容槽、规则阈值、评分模型、专业文档模板；
- 生产数据库表、消息队列、SSO、RBAC、审计存储与 HA；
- 真实内网 Adapter、真实客户 / 供应商 invitation 渠道；
- 精确 Event 数量、物理 ID 格式、checkpoint 频率；
- Asset Gate 在所有直租项目中的通用硬前提；
- 起租后租金、开票、资产预警、重组、处置与结清 API；
- 现场演示具体分钟数和完整生产运维能力。

以上开放项不能阻塞 Demo contract 的五路、T1–T3、ACL、正式起租、reset 与 replay，也不得被旧 V2 schema 或前端静态常量反向固定。
