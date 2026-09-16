# Lane 2 — Local Reassessment Loop Lab Contract

状态：`DISPOSABLE CANDIDATE / NOT PRODUCT FREEZE`

该 lane 验证“融资租赁事项保持当前宏观阶段，同时打开一个可追溯局部重新判断循环”的候选语义。它不冻结主生命周期方案，不自动推进/倒退主阶段，也不允许模型闭合回流。

## Public API

```js
export class ReassessmentLoopError extends Error {}
export function applyReassessmentCommand(input) {}
```

函数同步执行，不返回 Promise/thenable，不修改 input。

## Fixed stages and allowed routes

固定阶段：

`OPPORTUNITY → DUE_DILIGENCE → POLICY → CREDIT_REVIEW → COMMERCIAL → ASSET`

只允许以下实验回流：

- `CREDIT_REVIEW → DUE_DILIGENCE`
- `DUE_DILIGENCE → OPPORTUNITY`
- `COMMERCIAL → DUE_DILIGENCE`
- `COMMERCIAL → CREDIT_REVIEW`
- `ASSET → CREDIT_REVIEW`
- `ASSET → POLICY`

OPEN 的 sourceStage 必须等于 input.currentStage。无论 OPEN/CLOSE，成功输出的 mainStage 都必须保持 input.currentStage。

## Actors

Actor exact shape：

```js
{ type:'HUMAN'|'SYSTEM'|'MODEL', actorId:nonEmptyString, role:nonEmptyString }
```

- owner 必须是 HUMAN。
- OPEN requestedBy 只允许 HUMAN 或 SYSTEM；MODEL 只能提出候选，不能凭自身权力打开循环。
- CLOSE closedBy 必须是 HUMAN。
- 模型 authority 始终为 NONE。

## Input

```js
{
  caseId: nonEmptyString,
  currentStage: Stage,
  loops: ReassessmentLoop[],
  command: OpenCommand|CloseCommand
}
```

OpenCommand exact shape：

```js
{
  type:'OPEN',
  loopId:nonEmptyString,
  idempotencyKey:nonEmptyString,
  sourceStage:Stage,
  targetStage:Stage,
  reason:nonEmptyString,
  questions:uniqueNonEmptyString[],
  requiredEvidence:uniqueNonEmptyString[],
  affectedConclusionIds:uniqueNonEmptyString[],
  owner:Actor(HUMAN),
  requestedBy:Actor(HUMAN|SYSTEM),
  openedAt:validIso8601WithTimezone
}
```

CloseCommand exact shape：

```js
{
  type:'CLOSE',
  loopId:nonEmptyString,
  idempotencyKey:nonEmptyString,
  closedAt:validIso8601WithTimezone,
  closedBy:Actor(HUMAN),
  resolution:nonEmptyString,
  closeReceipt:{
    receiptId:nonEmptyString,
    status:'CONFIRMED',
    sourceSystem:nonEmptyString,
    receivedAt:validIso8601WithTimezone,
    evidenceRefs:uniqueNonEmptyString[]
  }
}
```

`validIso8601WithTimezone` 为 `YYYY-MM-DDTHH:mm:ss[.fraction](Z|±HH:mm)`，小数秒可选且日期必须真实有效。

ReassessmentLoop exact shape：

```js
{
  loopId,
  openIdempotencyKey,
  sourceStage,
  targetStage,
  reason,
  questions,
  requiredEvidence,
  affectedConclusionIds,
  owner,
  requestedBy,
  openedAt,
  attempt:positiveInteger,
  status:'OPEN'|'CLOSED',
  closedAt:string|null,
  closedBy:Actor|null,
  resolution:string|null,
  closeIdempotencyKey:string|null,
  closeReceipt:Receipt|null
}
```

OPEN record 的所有 close 字段必须为 null；CLOSED record 的 close 字段必须完整。closedAt/receipt.receivedAt 不得早于 openedAt。

## Loop bounds and idempotency

- 同一 `(sourceStage,targetStage)` 同时最多一个 OPEN loop，违反时 `ACTIVE_LOOP_EXISTS`。
- 同一路由最多创建 3 次 loop；第 4 次 `LOOP_LIMIT_REACHED`。这是防止无界自动循环的 lab safety，不是产品冻结上限。
- loopId、所有 open/close idempotencyKey 和 receiptId 必须在 input.loops 中唯一。
- OPEN 同 idempotencyKey 且语义完全一致返回 `IDEMPOTENT_REPLAY`；同 key 不同语义 `IDEMPOTENCY_CONFLICT`。
- CLOSE 已闭合 loop 使用相同 close idempotencyKey 和相同闭合语义时返回 replay；否则冲突。
- 不存在 loop、错误状态或无 receipt/reason 的闭合必须失败关闭，不修改 loops。

## Success output

```js
{
  schemaVersion:'local-reassessment.lab.v0',
  caseId,
  status:'OPENED'|'CLOSED'|'IDEMPOTENT_REPLAY',
  mainStage:input.currentStage,
  loops:deepCopiedLoops,
  loop:deepCopiedAffectedLoop,
  authority:{
    mainStageChanged:false,
    modelAuthority:'NONE',
    automaticLooping:false,
    projectDecisionAuthority:'NONE'
  }
}
```

OPEN 追加新 loop；CLOSE 在输出副本中闭合目标 loop，保留所有 open 字段并附加回执。输出不得与 input 共享对象/数组引用。

## Errors and validation

`ReassessmentLoopError`：name 同类名，details 为不引用 input 的普通对象。code：

- `INVALID_INPUT`
- `DUPLICATE_ID`
- `INVALID_ROUTE`
- `UNAUTHORIZED_SUBJECT`
- `IDEMPOTENCY_CONFLICT`
- `ACTIVE_LOOP_EXISTS`
- `LOOP_LIMIT_REACHED`
- `LOOP_NOT_FOUND`
- `INVALID_TRANSITION`

顺序：exact shape/type/non-empty → enum/ISO/array uniqueness → existing loop integrity/duplicate IDs → actor authority → route/currentStage → idempotency → active/limit/transition。失败零权威写入。

所有对象 exact shape；未知、自有 `__proto__`、`constructor`、`prototype` 或 symbol key 均 INVALID_INPUT，禁止静默修正与原型污染。

## Z boundary

Z 只读本文件和 `test/reassessment-loop.test.mjs`，只写 `src/reassessment-loop.mjs`。禁止父目录/其他 lane/evidence、联网、安装、Git、服务和凭据。实现后只运行一次：

`node --test test/reassessment-loop.test.mjs`

