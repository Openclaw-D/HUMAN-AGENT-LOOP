# Lane 1 — Append-only Versioned Ledger Lab Contract

状态：`DISPOSABLE CANDIDATE / NOT PRODUCT FREEZE`

该 lane 只验证同一 Financing Leasing Case 的追加式信息版本、来源追踪、幂等写入和影响候选传播。它不拥有事项生命周期，不自动修改政策、信审、商务或资产结论，也不证明这是最终持久化方案。

## Public API

`src/versioned-ledger.mjs` 必须导出：

```js
export class VersionedLedgerError extends Error {}
export function appendVersionedLedger(input) {}
```

函数同步执行，不得返回 Promise/thenable，不得修改 input。

## Fixed enums

业务阶段固定顺序：

`OPPORTUNITY → DUE_DILIGENCE → POLICY → CREDIT_REVIEW → COMMERCIAL → ASSET`

记录 kind：

- `CLAIM`：当事人或业务陈述，不自动成为事实；
- `MODEL_CANDIDATE`：模型候选，仅允许 MODEL 主体提交，authority=none；
- `EVIDENCE`：证据引用；
- `VERIFIED_FACT`：已核验事实，仅允许 HUMAN 或 SYSTEM 主体形成；
- `HUMAN_DECISION`：有权人员决定，仅允许 HUMAN 主体形成；
- `EXTERNAL_RECEIPT`：外部动作回执，仅允许 SYSTEM 主体代表 EXTERNAL source 形成。

主体 type：`HUMAN | SYSTEM | MODEL`。来源 type：`HUMAN | SYSTEM | MODEL | EXTERNAL`。

## Input

输入及所有嵌套对象必须是普通对象（prototype 为 `Object.prototype` 或 `null`）、只包含列出的自有字符串键且不得含 symbol key：

```js
{
  caseId: nonEmptyString,
  ledger: LedgerEntry[],
  command: {
    entryId: nonEmptyString,
    idempotencyKey: nonEmptyString,
    recordId: nonEmptyString,
    kind: LedgerKind,
    content: {
      value: nonEmptyString,
      evidenceRefs: uniqueNonEmptyString[]
    },
    source: {
      type: 'HUMAN'|'SYSTEM'|'MODEL'|'EXTERNAL',
      sourceId: nonEmptyString
    },
    recordedAt: validIso8601WithTimezone,
    subject: {
      type: 'HUMAN'|'SYSTEM'|'MODEL',
      subjectId: nonEmptyString,
      role: nonEmptyString
    },
    applicability: {
      stages: uniqueStage[],
      scopeRef: nonEmptyString
    },
    previousEntryId: nonEmptyString|null,
    changeReason: nonEmptyString,
    affectedConclusionIds: uniqueNonEmptyString[]
  }
}
```

`validIso8601WithTimezone` 接受 `YYYY-MM-DDTHH:mm:ss[.fraction](Z|±HH:mm)`；日历日期和时间必须真实有效，小数秒可选。

`LedgerEntry` 只包含 command 的字段（不含 `affectedConclusionIds`），并增加：

```js
{
  version: positiveInteger,
  versionLabel: `V${version}`
}
```

同一 `recordId` 的版本必须从 1 连续递增；V1 的 `previousEntryId=null`，后续版本必须指向该 record 当前最新 entry。已有 ledger 中 `entryId` 与 `idempotencyKey` 必须全局唯一，版本链必须有效。

## Validation and error priority

业务计算前依次校验：整体/嵌套 exact shape、类型与非空字符串 → enum、ISO 时间、数组唯一性 → 已有 ledger ID/版本链 → 主体权限 → command idempotency/entryId/version predecessor。

错误为 `VersionedLedgerError`，`name='VersionedLedgerError'`，`details` 必须是普通对象且不引用 input。code：

- `INVALID_INPUT`
- `DUPLICATE_ID`
- `INVALID_LEDGER_CHAIN`
- `UNAUTHORIZED_SUBJECT`
- `IDEMPOTENCY_CONFLICT`
- `VERSION_CONFLICT`

任一失败必须同步抛错，ledger 零写入。

## Idempotency and append behavior

- 若 command 的 `idempotencyKey` 已存在，且其全部 command 语义与已有 entry 相同，返回 `IDEMPOTENT_REPLAY`，不得追加；`affectedConclusionCandidates=[]`。
- 同 key 不同语义抛 `IDEMPOTENCY_CONFLICT`。
- 新 command 的 `entryId` 已存在，或输入 ledger 自身存在重复 ID，抛 `DUPLICATE_ID`。
- 新 record 只能以 V1/null predecessor 创建；已有 record 只能基于最新 entry 追加 V(n+1)，否则抛 `VERSION_CONFLICT`。
- 禁止覆盖、删除或原地修改任何历史 entry。

## Success output

只返回：

```js
{
  schemaVersion: 'versioned-ledger.lab.v0',
  caseId,
  status: 'APPENDED'|'IDEMPOTENT_REPLAY',
  appendedEntry: deepCopiedLedgerEntry,
  ledger: deepCopiedLedgerEntries,
  affectedConclusionCandidates: Array<{
    conclusionId,
    reason: 'LEDGER_VERSION_CHANGED',
    recordId,
    fromEntryId: string|null,
    toEntryId: string
  }>,
  authority: {
    modelAuthority: 'NONE',
    automaticConclusionRewrite: false,
    projectDecisionAuthority: 'NONE'
  }
}
```

APPENDED 时 candidates 按 `conclusionId` 字典序排列；它们只表示需要重新计算、核验或 Human Gate 的候选，不得改写任何结论。applicability stages 在 entry 中按固定阶段顺序规范化。

所有输出数组/对象必须与 input 以及输出中的其他副本隔离。禁止静默 trim、去重、纠正或添加字段。自有 `__proto__`、`constructor`、`prototype` 或其他未知键均为 `INVALID_INPUT`，不得污染原型。

## Z boundary

Z 只读本文件和 `test/versioned-ledger.test.mjs`，只写 `src/versioned-ledger.mjs`。禁止读取父目录/其他 lane/evidence，禁止联网、依赖安装、Git、服务、凭据和产品文件。实现后只运行一次：

`node --test test/versioned-ledger.test.mjs`

