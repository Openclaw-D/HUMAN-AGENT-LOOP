# 见微 V4 实现契约 —— 四域后端垂直切片（本 Goal 冻结版）

状态：`FROZEN FOR THIS SLICE / 2026-09-03 / ZCODE EXECUTION —— 2026-09-04 与 Root Authority D076–D080 对账（§16），correction checkpoint 全绿`

上位权威：工作区根部 `NORTH_STAR.md`、`DECISIONS.md`，执行书 `docs/v4/ZCODE_BACKEND_GOAL.md`（只读）。
执行约束：`jianwei-v3/site/AGENTS.md`。

本文件是 ZCode 四路 lane 与主 Agent 整合的唯一共享接口来源。范围只覆盖本切片真实能力；未实现边界见 §13，不得对外声称超出本文的能力。

## §1 对象与类型（exact，Lane A 原样落地为 `lib/v4life/types.ts` 唯一类型源）

```ts
export type V4LifeDomain = 'policy' | 'credit' | 'commerce' | 'asset';
export type V4LifeActorRole = 'business' | 'policy' | 'credit' | 'commerce' | 'asset' | 'system';
export type V4LifeEvidenceKind =
  | 'upstream_context' | 'financial_statement' | 'contract_draft'
  | 'asset_history_feedback' | 'supplement';

export interface V4LifeActor { actorId: string; role: V4LifeActorRole; displayName: string; }

export interface V4LifeEvidencePayload { summary: string; amountCny?: number; tags: string[]; }

export interface V4LifeEvidence {
  evidenceId: string; caseId: string; kind: V4LifeEvidenceKind; title: string;
  submittedBy: string; submittedAt: string; version: 1; payload: V4LifeEvidencePayload;
}

export type V4LifeWorkItemStatus =
  | 'blocked' | 'in_progress' | 'awaiting_gate' | 'completed' | 'stopped_dependency';

export type V4LifeDependencyKind = 'evidence' | 'receipt' | 'workitem';
export interface V4LifeDependency { kind: V4LifeDependencyKind; id: string; }

export interface V4LifeWorkItem {
  workItemId: string; caseId: string; domain: V4LifeDomain; title: string;
  dependencies: V4LifeDependency[]; status: V4LifeWorkItemStatus;
  assignedRole: V4LifeActorRole; gateId?: string;
  outputSummary?: string; submittedBy?: string; submittedAt?: string; completedAt?: string;
}

export interface V4LifeGate {
  gateId: string; caseId: string; domain: V4LifeDomain; title: string;
  requiredRole: V4LifeActorRole; workItemId: string;
  status: 'pending' | 'open' | 'decided'; openedAt?: string;
}

export interface V4LifeDecision {
  outcome: 'approved' | 'rejected' | 'returned'; actorId: string; reason: string; decidedAt: string;
}
export interface V4LifeReceipt { receiptId: string; gateId: string; decision: V4LifeDecision; }

export interface V4LifeCandidate {
  candidateId: string; caseId: string; domain: V4LifeDomain; workItemId?: string;
  kind: 'contradiction' | 'missing_document'; summary: string; basis: string[];
  authority: 'none'; producedBy: 'deterministic-v1'; createdAt: string; dedupeKey: string;
}

export interface V4LifeContribution {
  contributionId: string; actorId: string; domain: V4LifeDomain; workItemId: string;
  kind: 'evidence_review' | 'cross_check' | 'material_prep' | 'risk_finding';
  summary: string; recordedAt: string; retainedAfterVeto: true;
}

export interface V4LifeCaseMeta {
  caseId: string; displayName: string; disclaimer: string;
  financingAmountCny: number; purpose: string; upstreamNote: string;
}
```

## §2 事件（唯一权威记录，全量载荷）

```ts
export type V4LifeEventPayload =
  | { type: 'CASE_INITIALIZED'; caseId: string }
  | { type: 'EVIDENCE_ACCEPTED'; evidence: V4LifeEvidence }
  | { type: 'WORK_ITEM_STARTED'; workItemId: string }
  | { type: 'WORK_ITEM_SUBMITTED'; workItemId: string; actorId: string; outputSummary: string }
  | { type: 'CONTRIBUTION_RECORDED'; contribution: V4LifeContribution }
  | { type: 'CANDIDATE_ISSUED'; candidate: V4LifeCandidate }
  | { type: 'GATE_OPENED'; gateId: string; workItemId: string }
  | { type: 'DECISION_RECORDED'; gateId: string; decision: V4LifeDecision; receipt: V4LifeReceipt | null }
  | { type: 'WORK_ITEM_COMPLETED'; workItemId: string; by: string }
  | { type: 'WORK_ITEM_STOPPED'; workItemId: string; reason: 'upstream_gate_rejected' };

export interface V4LifeEvent { seq: number; at: string; actor: string; payload: V4LifeEventPayload; }
```

- `seq` 从 1 开始、按 case 单调递增、不可跳号、不可覆盖；事件只追加。
- `rev = 事件总数`。每个状态变化必须落为带全量载荷的事件；Projection 可由 §9 的 fold 重建等价读模型（deepEqual，忽略 `generatedAt`）。
- Projection、Event、Receipt 对外不得暴露引擎内部可变引用：查询返回深克隆。

## §3 状态机与依赖三分法

WorkItem 合法迁移（其他一律拒绝）：

```text
blocked        → in_progress          （依赖全部满足且无被否决的 receipt 依赖）
blocked        → stopped_dependency   （任一 receipt 依赖 outcome=rejected；仅此原因）
in_progress    → awaiting_gate        （submitWork 且该项有 gateId）
in_progress    → completed            （submitWork 且该项无 gateId）
awaiting_gate  → completed            （对应 Gate 批准/否决落定后由引擎落成）
awaiting_gate  → in_progress          （对应 Gate 退回）
```

Gate 迁移：`pending → open`（linked workItem 提交时）；`open → decided`（approved/rejected，产生 Receipt）；`open → pending`（returned，不发 Receipt）。`decided` 不可再变。

依赖满足规则：

```text
evidence 依赖：对应 evidenceId 已接受        → 满足（Evidence 到达即启动，跨域并行）
workitem 依赖：对应项 status=completed       → 满足
receipt   依赖：对应 Gate outcome=approved   → 满足
              对应 Gate outcome=rejected     → 该 blocked 项 → stopped_dependency
              对应 Gate returned             → 继续等待
```

否决只级联到 `blocked` 且真实依赖该 Receipt 的工作项；`in_progress/awaiting_gate/completed` 的项、既有 Evidence、Candidate、Contribution、事件一律保留。重新提交（补件后 linked item 再次 awaiting_gate）时同一 Gate 允许再次决定：`decided` Gate 在 linked item 重新提交后允许开启新一轮，Receipt 按轮次追加（receiptId 序号递增）。此为退回重做语义。

## §4 角色权限

- `submitWork`：`actor.role === item.assignedRole`，否则 `ROLE_MISMATCH`。
- `recordDecision`：`actor.role === gate.requiredRole`，否则 `ROLE_MISMATCH`。
- `appendEvidence`：`submittedBy` 必须是已存在 Actor（任何角色可提交材料）。
- 未知 `actorId` → `ACTOR_NOT_FOUND`。Agent/模型不在 Actor 空间内，永远无法调用这三个命令的正式路径。

## §5 Candidate 确定性规则与去重

只在 `EVIDENCE_ACCEPTED` 后扫描，`authority='none'`，`producedBy='deterministic-v1'`：

- **R1 contradiction**：同时存在 `financial_statement`（tags 含 `revenue_declining`）与 `contract_draft`（`amountCny ≥ 1_000_000`）→ 面向 `workItemId='WI-C2'`，`basis=[financial.evidenceId, contract.evidenceId]`（按此顺序）。
- **R2 missing_document**：`upstream_context` 缺少必需 tags `['business_license','due_diligence_report']` 中任一 → 面向 `workItemId='WI-C1'`，`basis=[context.evidenceId]`。

`dedupeKey = kind + '|' + workItemId + '|' + [...basis].sort().join(',')`；已存在同 `dedupeKey` 的 Candidate 不再发。Candidate 永不改变正式状态。

## §6 命令、幂等与版本竞争

```ts
export interface V4LifeCommand { commandId: string; expectedRev: number; }
export interface V4LifeAppendEvidenceCommand extends V4LifeCommand {
  evidenceId: string; kind: V4LifeEvidenceKind; title: string; submittedBy: string; payload: V4LifeEvidencePayload;
}
export interface V4LifeSubmitWorkCommand extends V4LifeCommand { workItemId: string; actorId: string; outputSummary: string; }
export interface V4LifeRecordDecisionCommand extends V4LifeCommand {
  gateId: string; actorId: string; outcome: V4LifeDecision['outcome']; reason: string;
}
```

校验顺序（任何一步失败即失败关闭，不产生事件）：

```text
1. 字段校验（§6.1）           → INVALID_ENGINE_INPUT
2. Actor 存在                 → ACTOR_NOT_FOUND
3. commandId 幂等：
   同 key + 同规范化 payload   → replay：返回原结果（status='replayed'，rev 为原接受时的 rev），不追加事件
   同 key + 异规范化 payload   → IDEMPOTENCY_CONFLICT
4. expectedRev === 当前 rev    → 否则 VERSION_CONFLICT
5. 对象状态规则（§3/§4）       → 对应错误码
6. evidenceId 自然键：
   同 id + 同规范化 payload    → replay（无论 commandId 是否相同；不同 commandId 的内容重放不写幂等记录）
   同 id + 异规范化 payload    → EVIDENCE_CONFLICT
```

§6.1 字段校验：`commandId/evidenceId/workItemId/gateId/actorId` 为非空 string；`expectedRev` 为 ≥0 整数；`title/summary/reason` 非空 string 且 ≤2000 字符；`tags` 数组 ≤20 项、每项非空 ≤64 字符；`amountCny` 缺省或有限数 ≥0；`outcome ∈ {approved, rejected, returned}`。`title` 另限 ≤200 字符。

规范化 payload = 去除 `commandId/expectedRev` 后按键名递归排序的稳定 JSON。初始化 `seed.initialEvidence` 由引擎内部追加，豁免 commandId/expectedRev，但事件载荷完整。

## §7 引擎公共 API（frozen，Lane A 实现；不得改名/改签名）

```ts
export interface V4LifeEngineOptions {
  eventLog?: V4LifeEventLog;       // §9；注入则每次追加先过 log
  now?: () => string;              // 测试时钟
}
export interface V4LifeEngine {
  caseId: string;
  rev: number;
  appendEvidence(command: V4LifeAppendEvidenceCommand): V4LifeAppendEvidenceResult;
  submitWork(command: V4LifeSubmitWorkCommand): V4LifeSubmitWorkResult;
  recordDecision(command: V4LifeRecordDecisionCommand): V4LifeRecordDecisionResult;
  getProjection(): V4LifeProjection;
  getEvents(afterSeq: number, limit?: number): { events: V4LifeEvent[]; nextSeq: number; hasMore: boolean };
}
export function createV4LifeEngine(seed: V4LifeSeedInput, options?: V4LifeEngineOptions): V4LifeEngine;
```

结果类型：

```ts
export interface V4LifeAppendEvidenceResult {
  status: 'accepted' | 'replayed'; rev: number; evidence: V4LifeEvidence; startedWorkItemIds: string[];
}
export interface V4LifeSubmitWorkResult {
  status: 'accepted' | 'replayed'; rev: number; workItem: V4LifeWorkItem; gate?: V4LifeGate;
}
export interface V4LifeRecordDecisionResult {
  status: 'accepted' | 'replayed'; rev: number;
  receipt: V4LifeReceipt | null;   // returned 时为 null
  stoppedWorkItemIds: string[]; completedWorkItemIds: string[];
}
```

`getEvents`：`limit` 默认 100、上限 500；返回 `seq > afterSeq` 的前 `limit` 条、`nextSeq`（当前事件总数）与 `hasMore`。

种子输入 `V4LifeSeedInput` 维持现状字段：`case/actors/workItems/gates/initialEvidence`（见 §11 fixture）。id 格式：`contrib-<n>`、`rcpt-<gateId>-<n>`（n 为 case 内计数器，从 1 起）。

## §8 Projection

```ts
export interface V4LifeProjection {
  case: V4LifeCaseMeta;
  rev: number;
  domains: Array<{ domain: V4LifeDomain; workItems: V4LifeWorkItem[]; gates: V4LifeGate[]; candidates: V4LifeCandidate[] }>;
  openGates: V4LifeGate[];
  receipts: V4LifeReceipt[];
  contributions: V4LifeContribution[];
  evidence: V4LifeEvidence[];
  evidenceCount: number;
  eventCount: number;
  generatedAt: string;
}
```

domains 固定顺序 `policy, credit, commerce, asset`；全部数组为深克隆新引用。

## §9 存储 port 与重放（Lane B 专责）

```ts
export interface V4LifeEventLog {
  append(caseId: string, expectedLastSeq: number, events: V4LifeEvent[]):
    { ok: true } | { ok: false; reason: 'SEQ_CONFLICT'; lastSeq: number };
  loadAll(caseId: string): V4LifeEvent[];
}
export function createInMemoryEventLog(): V4LifeEventLog & {
  exportSnapshot(caseId: string): V4LifeEvent[] | null;
  importSnapshot(caseId: string, events: V4LifeEvent[]): void;
  listCaseIds(): string[];
};
export function rebuildProjection(seed: V4LifeSeedInput, events: V4LifeEvent[], generatedAt?: string): V4LifeProjection;
```

- `append` 以 `expectedLastSeq` 做条件追加；不匹配返回 `SEQ_CONFLICT`（引擎映射为 500 级内部一致性错误，不静默覆盖）。
- `rebuildProjection` 从 seed 骨架（items 全 blocked、gates 全 pending）出发折叠事件，得到与在线引擎 deepEqual（忽略 `generatedAt`）的 Projection。
- 禁止声称选择了任何生产数据库；本切片只有内存适配器。

## §10 HTTP 层（Lane C 专责）

路由（全部 `Cache-Control: no-store`，JSON）：

| 方法 | 路径 | 请求 | 成功响应 |
| --- | --- | --- | --- |
| GET | `/api/v4life/cases/:caseId` | — | 200 Projection |
| POST | `/api/v4life/cases/:caseId/evidence` | AppendEvidenceCommand | 201 accepted / 200 replayed |
| POST | `/api/v4life/cases/:caseId/work` | SubmitWorkCommand | 200 |
| POST | `/api/v4life/cases/:caseId/decisions` | RecordDecisionCommand | 201 accepted / 200 replayed |
| GET | `/api/v4life/cases/:caseId/events?afterSeq=&limit=` | — | 200 `{events,nextSeq,hasMore}` |

- 错误 envelope 统一为 `{ "error": "<CODE>" }`；HTTP 映射见 §12。未知错误一律 `{ "error": "INTERNAL_ERROR" }` 500，不泄露内部细节。
- 非 demo caseId → `CASE_NOT_FOUND` 404。
- runtime 提供组合根与测试隔离：`getOrCreateV4LifeDemoEngine()`、`getV4LifeEngine(caseId)`、`injectV4LifeEngine(caseId, engine)`、`resetV4LifeRuntime()`。
- 集成测试直接 import route handler 函数以 `Request` 对象进程内调用，不启动网络服务。

## §11 Golden Case 合成 fixture（frozen；Lane A 落 seed，Lane D 按此断言）

- caseId `demo-sme-robot-500w`；显示名"某四足机器人科技企业·流动资金与设备采购（合成演示案例）"；金额 5,000,000；声明为虚拟演示。
- Actors：`actor-business-chen`(business 陈经理)、`actor-policy-li`(policy 李审)、`actor-credit-zhang`(credit 张审)、`actor-commerce-wang`(commerce 王经理)、`actor-asset-zhou`(asset 周工)。
- WorkItems / 依赖：

| id | domain | 依赖 | role | gate |
| --- | --- | --- | --- | --- |
| WI-P1 | policy | ev-upstream-context | policy | PG-1 |
| WI-C1 | credit | ev-upstream-context | credit | — |
| WI-C2 | credit | ev-financial-statement | credit | — |
| WI-C3 | credit | receipt PG-1 ＋ workitem WI-C1 ＋ WI-C2 | credit | CG-1 |
| WI-B1 | commerce | ev-contract-draft | commerce | — |
| WI-A1 | asset | ev-upstream-context | asset | — |

- Gates：PG-1 政策准入 Gate（policy, → WI-P1）；CG-1 信审签批 Gate（credit, → WI-C3）。
- 初始 Evidence：`ev-upstream-context`（tags: `['business_license']`，by chen）→ 必触发 R2；启动 WI-P1/WI-C1/WI-A1 三域并行。
- 四个核心证明点：① 上游 Context 到达即三域并行启动；② WI-C3 硬等待 PG-1 Receipt；③ PG-1 rejected → WI-C3 stopped_dependency 且 WI-C1 贡献保留、WI-B1 不受影响；④ PG-1 approved → WI-C3 启动并可完成签批链路。

## §12 错误码总表

| code | HTTP | 语义 |
| --- | --- | --- |
| INVALID_ENGINE_INPUT | 400 | 字段缺失/类型/长度非法 |
| ACTOR_NOT_FOUND | 400 | 未知 actorId |
| EVIDENCE_INVALID | 400 | Evidence 载荷非法 |
| CASE_NOT_FOUND | 404 | caseId 不存在 |
| WORK_ITEM_NOT_FOUND | 404 | workItemId 不存在 |
| GATE_NOT_FOUND | 404 | gateId 不存在 |
| ROLE_MISMATCH | 403 | 角色与必经权限不符 |
| EVIDENCE_CONFLICT | 409 | 同 evidenceId 异载荷 |
| IDEMPOTENCY_CONFLICT | 409 | 同 commandId 异载荷 |
| VERSION_CONFLICT | 409 | expectedRev 不等于当前 rev |
| WORK_ITEM_NOT_ACTIVE | 409 | 工作项状态不允许提交 |
| GATE_NOT_OPEN | 409 | Gate 尚未开启 |
| GATE_ALREADY_DECIDED | 409 | Gate 本轮已决定 |
| SEQ_CONFLICT | 500 | 事件日志条件追加失败（内部一致性） |
| INTERNAL_ERROR | 500 | 未分类错误，不泄露内部信息 |

## §13 未实现边界（不得声称已具备）

当前边界（2026-09-04 对账更新；方括号内为相对初版的变化）：

- 存储默认纯内存；[opt-in 文件持久化已交付]：设置 `V4LIFE_DATA_DIR` 后事件账本 + 命令日志落盘（JSONL append-only，重启 refold 恢复，端到端重启验证通过）。仍无事务数据库。
- 幂等：commandId 已跨重启（durable command journal 已交付）；[非原子性：journal.append 发生在事件 commit 之后，进程在两写之间崩溃可能事件已入而日志未记——该窗口内重启后重发同命令按自然键/新命令处理，不产生重复写]。
- 无认证体系/RBAC/租户隔离（仅有角色-权限校验语义）；无真实模型调用（Candidate 全部确定性规则）；无生产部署；无多 case 工厂；[前端已有 /work 五角色工作台与 /work/screen 大屏镜像（§14），仍非完整产品交付]。
- 生产试点仍需要：事务数据库或持久事件账本、唯一约束、认证/RBAC、审计与保留策略、durable journal 与事件写入的原子化（§15）。

## §14 Workspace 最小扩展（2026-09-04 冻结，服务 `/work` 五角色工作台）

### §14.1 Projection 增加 actors

`V4LifeProjection` 增加只读 `actors: V4LifeActor[]`（深克隆，顺序同 seed）。页面不得自备角色 ID/姓名副本；筛选、计数、等待原因与 next-action 文案一律由纯 selector 从 canonical Projection 派生，不新增 summary/domain endpoint。

### §14.2 四域正式承接链（不改为全串行）

保留 §11 全部对象，新增：

| 对象 | domain | 依赖 | gate |
| --- | --- | --- | --- |
| WI-B2 商务条款确认与合同承接 | commerce | receipt CG-1(approved) ＋ workitem WI-B1(completed) | BG-1 |
| WI-A2 租赁物条件与贷后巡检计划确认 | asset | receipt BG-1(approved) ＋ workitem WI-A1(completed) | AG-1 |
| BG-1 商务承接 Gate | commerce | requiredRole=commerce，workItemId=WI-B2 | — |
| AG-1 资产承接 Gate | asset | requiredRole=asset，workItemId=WI-A2 | — |

语义不变：可提前准备（WI-P1/WI-C1/WI-A1 于上游 Context 到达即并行；合同草案 Evidence 启动 WI-B1；财务 Evidence 启动 WI-C2）；仅 WI-C3、WI-B2、WI-A2 三个高成本正式承接等待前序 Receipt。批准/否决产生不可变 Receipt；退回不发；否决只停真实依赖项且贡献保留。Golden Case happy path 延伸至 AG-1 Receipt。

### §14.3 Demo reset

`POST /api/v4life/demo/reset`：仅接受固定合成 case `demo-sme-robot-500w`（body 可省略或 `{caseId}`）；重建进程内 demo runtime 并返回 200 + 全新 canonical Projection。`NODE_ENV === 'production'` 时该路由失败关闭返回 `404 {"error":"CASE_NOT_FOUND"}`。UI 必须标注“重置合成演示”，不得表述为撤销正式业务决定。reset 不进入事件账本（无 Reset 事件），旧引擎实例直接丢弃。

### §14.4 Client 命令纪律（前端必须遵守）

每次用户动作生成一次 `commandId`（UUID）；pending 期间禁止重复提交；传输失败重试必须复用完全相同 commandId+payload；`VERSION_CONFLICT` 先刷新 Projection、不自动重放用户意图；`IDEMPOTENCY_CONFLICT` 明确提示同键异载荷；错误映射为中文并保留 exact code；未知错误只显示 `INTERNAL_ERROR`。禁止 optimistic authority：WorkItem/Gate/Receipt 视图只能来自服务端响应或重新 GET 的 Projection。轮询 2–3s、页面 hidden 暂停、卸载 abort。

### §14.5 仍不实现

真实模型（Candidate 保持 deterministic 并展示 basis/producedBy/authority=none）；文件上传；通知中心；假在线状态；管理 KPI；多 case。

## §15 幂等重建边界与持久化前置（2026-09-04，Codex 验收后补录）

1. **进程内幂等边界**：`commandId` 幂等记录（commandRecords）不写入事件流，经 `options.eventLog.loadAll` 重建（refold）后不保留。重启/重建后同 `commandId` 重发：evidence 走 `evidenceId` 自然键仍返回 `replayed`；work/decision 会因 rev 已推进返回 `VERSION_CONFLICT`（失败关闭，无重复写）。**任何持久化部署前必须补 durable command journal**，否则 §6 幂等语义只在工作进程生命周期内成立。
2. **持久化适配器（opt-in）**：`createFileEventLog`（§9 port 实现，JSONL append-only）+ runtime `V4LIFE_DATA_DIR` 环境变量接线；未设置时纯内存行为不变。真实重启端到端验证见 `docs/v4/BACKEND_PROGRESS.md` 优化 Wave 小节。
3. **契约漂移提示**：本文件冻结于 Root Authority `V4L-D076`–`D080` 之前，尚未覆盖 contextVersion / Input Event / 收集窗口语义；§13 与 §14 的关系以 Root Authority 为准，统一版本另行冻结（event-log 重建语义以 §2 + 本节为准）。
4. **P1-BE-01 加固补录（2026-09-04）**：`context_batch` 命令族已进入 durable command journal；构造期拒绝 journal `result.rev` 超前于事件流的错配。文件 event log 与 journal 仍非原子事务：journal 写失败后同进程可 replay，跨重启由自然键或状态规则失败关闭；这不等于 exactly-once transaction，也不替代生产事务数据库。


## §16 Root Authority 对账（D076–D080，2026-09-04）

本节把工作区 `DECISIONS.md` V4L-D076–D080 与当前实现对账，消除"契约早于 Root Authority"的漂移。对账后本文件与 §13/§14/§15 共同构成当前真相；P1 增量语义见 §16.3。

### §16.1 逐条对账

| 决定 | 当前实现状态 |
| --- | --- |
| D076 共享 Context + 不可变输入版本；caseRev 随权威事件递增；contextVersion=M.m | **机制已实现，产品内容仍为 Candidate**：caseRev 为引擎 `rev`；InputEvent 与 M.m 版本、投影和重放已落地。默认 `p1CandidateSemantics='off'` 不开放窗口命令，demo 显式 opt-in；精确 kind、角色与接入面待 P1 用户确认。 |
| D077 OPEN→STABILIZING→SEALED 收集窗口 | **机制已实现并默认隔离**：状态机与回放已落地；strict 默认投影为 `status='NONE'` 空窗口，demo 才启用当前角色映射和隐含 `major=1 SEALED`。角色、自动封存/重开与初始批次均未冻结。 |
| D078 轻量总路由 + 四域 Workflow + 共享原子能力；总路由不产 Receipt | **语义一致**：引擎四域依赖/分发与 Gate 权限模型满足"总路由不产生正式决定"；能力池登记机制未建 |
| D079 能力池登记（Owner/schema/authority=none/无凭据导出） | **未实现**（当前无外部能力接入；Candidate 为确定性规则且 authority=none 已满足精神） |
| D080 Studio 只服务开发运维；前端非 canonical state | **满足**：正式状态只由后端校验并投影；/work 与 /work/screen 均为 Projection 消费面 |

### §16.2 §13/§14/§15 关系

§13 = 未实现边界（当前真相）；§14 = /work 工作面最小扩展；§15 = 幂等重建边界与持久化前置。三者互不矛盾，均为当前契约的组成层；本节为 Root Authority 对账层。

### §16.3 P1 增量（scenario frozen / content next）

新客回租 Golden Case 的场景优先级已冻结；P1 内容仍为 `SCENARIO FROZEN / CONTENT CANDIDATE / USER ACCEPTANCE OPEN`。Evidence 可选扩展、核验事件、Risk Thread、InputEvent 与收集窗口机制已作为向后兼容 Candidate 落地；未确认的角色、自动封存、初始批次和正式 Receipt 语义已退出 strict 默认路径，仅在合成 demo 显式 opt-in。待确认清单仍以 `versions/V4/P1_GOLDEN_CASE_CONTRACT.md` §11 与 `docs/v4/P1_SCHEMA_EXTENSION_PROPOSAL.md` 为准；seed 内容在用户确认前不改。
