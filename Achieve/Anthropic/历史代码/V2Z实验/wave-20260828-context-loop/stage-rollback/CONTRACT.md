# Lane 3 — Whole-stage Rollback Lab Contract

状态：`DISPOSABLE COMPARISON CANDIDATE / NOT PRODUCT FREEZE`

该 lane 故意建模“融资租赁事项主阶段整体倒退”的对照候选，用于暴露其历史、并行工作、已完成商务动作与资产存续冲突。它不宣称主阶段倒退已被产品接受；输出仍是 candidateOnly。

## Public API

```js
export class StageRollbackError extends Error {}
export function applyStageRollback(input) {}
```

同步、非 Promise/thenable，不修改 input。

## Stage order

`OPPORTUNITY → DUE_DILIGENCE → POLICY → CREDIT_REVIEW → COMMERCIAL → ASSET`

targetStage 必须严格早于 currentStage；不得同阶段或向前推进。MODEL/SYSTEM 不得以自身权力触发 rollback，triggeredBy 必须是 HUMAN。

## Input

所有对象 exact shape、普通对象且只含列出的自有字符串键：

```js
{
  caseId:nonEmptyString,
  currentStage:Stage,
  stageHistory:StageEvent[],
  decisions:Decision[],
  parallelWork:WorkItem[],
  completedActions:CompletedAction[],
  command:{
    eventId:nonEmptyString,
    idempotencyKey:nonEmptyString,
    targetStage:Stage,
    reason:nonEmptyString,
    triggeredAt:validIso8601WithTimezone,
    triggeredBy:Actor(HUMAN)
  }
}
```

Actor：`{type:'HUMAN'|'SYSTEM'|'MODEL',actorId,role}`，字符串均非空。

StageEvent：

```js
{
  eventId,
  idempotencyKey,
  type:'STAGE_ENTERED'|'STAGE_ROLLBACK',
  fromStage:Stage|null,
  toStage:Stage,
  reason,
  occurredAt:validIso8601WithTimezone,
  actor:Actor
}
```

非空 history 的最后一个 event.toStage 必须等于 currentStage。所有 eventId/idempotencyKey 唯一。

Decision：

```js
{
  decisionId,
  stage:Stage,
  decisionType:'POLICY'|'CREDIT'|'COMMERCIAL'|'ASSET',
  result:nonEmptyString,
  decidedAt:validIso8601WithTimezone,
  decidedBy:Actor(HUMAN)
}
```

WorkItem：`{workId,stage:Stage,status:'OPEN'|'COMPLETED',ownerId}`。

CompletedAction：

```js
{
  actionId,
  stage:Stage,
  kind:'CONTRACT_EFFECTIVE'|'FUND_DISBURSED'|'LEASE_STARTED'|'COLLECTION_ESCALATION'|'RESTRUCTURING'|'LITIGATION'|'ASSET_DISPOSAL'|'OTHER',
  receiptId:nonEmptyString,
  completedAt:validIso8601WithTimezone
}
```

各数组内部 ID 唯一；receiptId 亦唯一。ISO grammar 为 `YYYY-MM-DDTHH:mm:ss[.fraction](Z|±HH:mm)`，日期真实有效、小数秒可选。

## Conflict model

rollback target 之后的现有事实不能被删除或假装撤销。候选按以下固定顺序暴露 conflict，再按 refId 字典序：

1. `ASSET_PERIOD_ACTIVE`：currentStage=ASSET；refId=caseId，stage=ASSET。
2. `OPEN_PARALLEL_WORK`：target 之后仍 OPEN 的 work item。
3. `PRESERVED_DOWNSTREAM_DECISION`：target 之后已有 decision。
4. `COMPLETED_COMMERCIAL_ACTION`：target 之后已完成的 CONTRACT_EFFECTIVE/FUND_DISBURSED/LEASE_STARTED。
5. `COMPLETED_DOWNSTREAM_ACTION`：target 之后其他 completed action。

每项 exact shape：`{type,refId,stage}`。

- 无 conflict：返回 APPLIED candidate，currentStage=target，stageHistory 只追加一个 STAGE_ROLLBACK event，其他历史数组完整深拷贝保留。
- 有任一 conflict：返回 BLOCKED_BY_CONFLICTS，currentStage 与所有历史数组保持语义不变；只返回 rollbackEvent 候选与 conflicts，不追加 event，不反转外部动作。
- 不得删除/覆盖原 event、decision、work 或 completed action。

## Idempotency

若 stageHistory 已有相同 idempotencyKey 的 STAGE_ROLLBACK event，且 eventId、target、reason、time、actor 与 command 相同且 currentStage=event.toStage，则返回 IDEMPOTENT_REPLAY，不追加。相同 key 不同语义抛 `IDEMPOTENCY_CONFLICT`。command eventId 已存在但 key 不同抛 `DUPLICATE_ID`。

## Success output

```js
{
  schemaVersion:'stage-rollback.lab.v0',
  caseId,
  status:'APPLIED'|'BLOCKED_BY_CONFLICTS'|'IDEMPOTENT_REPLAY',
  previousStage:input.currentStage,
  currentStage:Stage,
  stageHistory:deepCopy,
  decisions:deepCopy,
  parallelWork:deepCopy,
  completedActions:deepCopy,
  rollbackEvent:deepCopy,
  conflicts:Array<{type,refId,stage}>,
  requiresHumanResolution:boolean,
  authority:{
    modelAuthority:'NONE',
    automaticExternalReversal:false,
    projectDecisionAuthority:'NONE',
    candidateOnly:true
  }
}
```

APPLIED/REPLAY 的 conflicts=[]、requiresHumanResolution=false；BLOCKED 时为 true。

## Errors and safety

`StageRollbackError` name 同类名、details 普通且不引用 input。code：

- `INVALID_INPUT`
- `DUPLICATE_ID`
- `INVALID_HISTORY`
- `UNAUTHORIZED_SUBJECT`
- `INVALID_ROLLBACK`
- `IDEMPOTENCY_CONFLICT`

顺序：exact shape/type/non-empty → enum/ISO → duplicate/integrity → subject authority → idempotency → rollback direction/conflict computation。失败零权威写入。输出与 input 无嵌套别名。

未知字段、自有 `__proto__`、`constructor`、`prototype` 或 symbol key 均 INVALID_INPUT，不得污染原型或静默修正。

## Z boundary

Z 只读本文件和 `test/stage-rollback.test.mjs`，只写 `src/stage-rollback.mjs`。禁止父目录/其他 lane/evidence、联网、安装、Git、服务与凭据。实现后只运行一次：

`node --test test/stage-rollback.test.mjs`

