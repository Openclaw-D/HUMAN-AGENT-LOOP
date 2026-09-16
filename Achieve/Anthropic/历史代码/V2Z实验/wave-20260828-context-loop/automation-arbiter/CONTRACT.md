# Lane 4 — Deterministic Automation Arbiter Lab Contract

状态：`DISPOSABLE CANDIDATE / NOT PRODUCT FREEZE`

该 lane 只验证一个待执行步骤在显式输入下应返回 AUTO、ASK_HUMAN、HUMAN_GATE 或 BLOCK 哪一类候选。它不调用模型、不执行动作、不完成外部业务，也不赋予模型任何权力。

## Public API

```js
export class AutomationArbiterError extends Error {}
export function arbitrateAutomation(input) {}
```

同步、确定性、非 Promise/thenable，不修改 input。同一合法输入必须得到 deepEqual 输出。

## Fixed stages and step kinds

阶段：`OPPORTUNITY | DUE_DILIGENCE | POLICY | CREDIT_REVIEW | COMMERCIAL | ASSET`。

允许自动候选 kinds：

- `INFORMATION_EXTRACTION`
- `VALIDATION`
- `SUPPLEMENT_REQUEST`
- `ROUTING`
- `DRAFTING`
- `MONITORING`

必须 Human Gate 的 kinds：

- 政策：`POLICY_EXCEPTION | RULE_CONFLICT`
- 信审：`FINAL_CREDIT_DECISION | CORE_CREDIT_TERMS`
- 商务/起租：`CONTRACT_EFFECTIVE | FUND_DISBURSEMENT | LEASE_START`
- 资产高影响动作：`COLLECTION_ESCALATION | RESTRUCTURING | LITIGATION | ASSET_DISPOSAL`

## Input

所有对象 exact shape、普通对象且只包含列出的自有字符串键：

```js
{
  caseId:nonEmptyString,
  evaluatedAt:validIso8601WithTimezone,
  stage:Stage,
  step:{
    stepId:nonEmptyString,
    kind:StepKind,
    evidenceStatus:'COMPLETE'|'MISSING'|'CONFLICT'|'UNKNOWN',
    evidenceRefs:uniqueNonEmptyString[],
    permissionStatus:'AUTHORIZED'|'UNAUTHORIZED'|'UNKNOWN',
    policyStatus:'CLEAR'|'EXCEPTION'|'CONFLICT'|'UNKNOWN'|'NOT_APPLICABLE',
    externalReceiptRequirement:'NOT_REQUIRED'|'REQUIRED',
    externalReceiptStatus:'NOT_REQUIRED'|'CONFIRMED'|'MISSING'|'UNKNOWN',
    humanInputRequired:boolean,
    requestedBy:{
      type:'HUMAN'|'SYSTEM'|'MODEL',
      subjectId:nonEmptyString,
      role:nonEmptyString,
      claimedAuthority:'NONE'|'EXECUTE'
    },
    modelConfidence:number|null
  }
}
```

ISO grammar 为 `YYYY-MM-DDTHH:mm:ss[.fraction](Z|±HH:mm)`，日期真实有效、小数秒可选。modelConfidence 若非 null 必须为 0..1 的有限数，但不得用于授予权限或绕过 Gate。MODEL requestedBy 只能 claimedAuthority=NONE，否则 `UNAUTHORIZED_SUBJECT`。

## Deterministic priority

校验通过后按以下顺序，命中后不再降级为更自动的结果：

### 1. BLOCK — fail closed

按以下固定顺序累计 reasons：

- evidenceStatus=MISSING → `EVIDENCE_MISSING`
- CONFLICT → `EVIDENCE_CONFLICT`
- UNKNOWN → `EVIDENCE_UNKNOWN`
- permissionStatus=UNAUTHORIZED → `PERMISSION_UNAUTHORIZED`
- UNKNOWN → `PERMISSION_UNKNOWN`
- policyStatus=UNKNOWN → `POLICY_UNKNOWN`
- receipt requirement=REQUIRED 且 status=MISSING → `RECEIPT_MISSING`
- REQUIRED 且 UNKNOWN → `RECEIPT_UNKNOWN`
- receipt requirement/status 组合不一致（NOT_REQUIRED 但 status 非 NOT_REQUIRED；REQUIRED 但 status=NOT_REQUIRED）→ `RECEIPT_STATE_INVALID`

存在任一 BLOCK reason 时 disposition=BLOCK，requiredHumanGate=null。证据或 policy 的 CONFLICT 在这里表示自动执行失败关闭；若基础证据完整、权限明确，则下面明确的规则冲突/政策例外 step 才进入 Human Gate。

### 2. HUMAN_GATE

基础条件未 BLOCK 时：

- kind POLICY_EXCEPTION/RULE_CONFLICT 或 policyStatus EXCEPTION/CONFLICT → `{gateType:'POLICY_EXCEPTION_OR_RULE_CONFLICT',requiredRole:'POLICY'}`；reason=`POLICY_HUMAN_GATE`。
- kind FINAL_CREDIT_DECISION/CORE_CREDIT_TERMS → `{gateType:'FINAL_CREDIT_DECISION_OR_TERMS',requiredRole:'CREDIT_REVIEW'}`；reason=`CREDIT_HUMAN_GATE`。
- kind CONTRACT_EFFECTIVE/FUND_DISBURSEMENT/LEASE_START → `{gateType:'COMMERCIAL_ACTIVATION',requiredRole:'COMMERCIAL'}`；reason=`COMMERCIAL_HUMAN_GATE`。
- kind COLLECTION_ESCALATION/RESTRUCTURING/LITIGATION/ASSET_DISPOSAL → `{gateType:'ASSET_HIGH_IMPACT_ACTION',requiredRole:'ASSET'}`；reason=`ASSET_HUMAN_GATE`。

政策 gate 优先于 kind 对应的其他 gate。

### 3. ASK_HUMAN

仅对 auto-eligible kind，若 humanInputRequired=true，返回 ASK_HUMAN，reason=`HUMAN_INPUT_REQUIRED`，requiredHumanGate=null。它只请求非权威补充，不等于 Human Gate。

### 4. AUTO

其余 auto-eligible kind 返回 AUTO，reason=`LOW_RISK_DETERMINISTIC_AUTOMATION`。AUTO 仍只是执行候选；该函数本身不执行或完成动作。

## Exact output

```js
{
  schemaVersion:'automation-arbiter.lab.v0',
  caseId,
  evaluatedAt,
  stage,
  stepId,
  disposition:'AUTO'|'ASK_HUMAN'|'HUMAN_GATE'|'BLOCK',
  reasons:string[],
  consideredEvidenceRefs:deepCopiedString[],
  requiredHumanGate:{gateType,requiredRole}|null,
  authority:{
    modelAuthority:'NONE',
    projectDecisionAuthority:'NONE',
    externalActionCompleted:false,
    deterministicRuleOnly:true
  }
}
```

## Errors and safety

`AutomationArbiterError`，name 同类名、details 为不引用 input 的普通对象。code：`INVALID_INPUT | DUPLICATE_ID | UNAUTHORIZED_SUBJECT`。

顺序：exact shape/type/non-empty → enum/ISO/numeric/duplicate evidence IDs → subject authority → deterministic rules。失败零权威写入。未知字段、自有 `__proto__`、`constructor`、`prototype` 或 symbol key 均 INVALID_INPUT。输出与 input 无嵌套别名，禁止静默修正。

## Z boundary

Z 只读本文件和 `test/automation-arbiter.test.mjs`，只写 `src/automation-arbiter.mjs`。禁止父目录/其他 lane/evidence、联网、安装、Git、服务、模型调用和凭据。实现后只运行一次：

`node --test test/automation-arbiter.test.mjs`

