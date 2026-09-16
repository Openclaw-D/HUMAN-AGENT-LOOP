# 融资租赁事项政策产物应用实验契约 v0

状态：`LAB CONTRACT / DISPOSABLE / NOT PRODUCT FREEZE`

本目录是见微 V2Z 的隔离后端实验。它只用于暴露接口、校验、排序、克隆和权威边界问题，不修改或补充 `C:\Users\22673\Desktop\Anthropic` 中的产品冻结语义，也不得作为产品已实现、已接系统或已验收的证据。

## 0. 大业务流中的位置

当前候选大体系把同一个 Financing Leasing Case 沿以下业务流推进：

> 商机 → 尽调 → 政策能力应用 → 信审/风控判断 → 商务执行与起租 → 资产存续

各环节结果可能影响后续环节并形成反馈。见微后续要验证的是“**大业务流 + 小协同内核 + 若干可插拔能力接口**”，不是堆叠垂直 Agent。

`buildPolicyApplication` 只是政策能力应用环节的首个候选挂载接口，其输出只能作为未来更大 `LeasingCaseFlow` 的消费输入。它：

- 不拥有或推进融资租赁事项生命周期；
- 不批准或拒绝项目，也不替代信审/风控判断；
- 不定义商机、尽调、信审、商务、起租或资产存续阶段的对象、状态、接口或反馈机制；
- 不证明 `LeasingCaseFlow`、协同内核或任何外部能力已经实现。

## 1. 模块接口

`src/policy-application.mjs` 必须导出：

```js
export class PolicyApplicationError extends Error {}
export function buildPolicyApplication(input) {}
```

`buildPolicyApplication` 是同步函数。它不得返回 `Promise` 或 thenable。

## 2. 输入

输入必须是普通对象，并且只包含以下三个自有字符串键：

```js
{
  caseId: string,
  appliedAt: string,
  artifacts: Array<{
    kind: string,
    artifactId: string,
    version: string,
    result: string,
    evidenceRefs: string[]
  }>
}
```

- `caseId`、`artifactId`、`version` 和每个 `evidenceRefs` 元素必须是长度大于零的字符串。不做 trim、大小写转换、去重或其他静默修正。
- `artifacts` 可以为空；缺失的政策产物由输出显式表达。
- 每个 artifact 必须是普通对象，并且只包含上面列出的五个自有字符串键。
- 输入对象和 artifact 的 prototype 只能是 `Object.prototype` 或 `null`；不得包含 symbol key 或额外自有键。
- `appliedAt` 必须是带时区的完整 ISO-8601 datetime：`YYYY-MM-DDTHH:mm:ss[.fraction](Z|±HH:mm)`。年月日和时分秒必须是实际有效值；不接受日期单独值、缺失时区、无效日历日期或 JavaScript 可自动归一化的日期。

允许的 kind 及固定顺序：

1. `MODEL_SCORE`
2. `STRATEGY`
3. `ANTI_FRAUD`
4. `RULE`
5. `ENGINE`
6. `DATA`

每个 kind 最多出现一次。`result` 只允许：`CLEAR`、`HIT`、`UNKNOWN`。

## 3. 校验与错误

任何业务计算前必须先完成输入校验。非法输入必须同步抛出 `PolicyApplicationError`，禁止静默丢弃、补齐、改名或转换字段。

错误必须满足：

```js
error instanceof Error === true
error.name === 'PolicyApplicationError'
error.code === 'INVALID_INPUT' || error.code === 'DUPLICATE_ARTIFACT_KIND'
Object.getPrototypeOf(error.details) === Object.prototype
```

- 合法 kind 重复时使用 `DUPLICATE_ARTIFACT_KIND`。
- 其余整体 shape、类型、额外字段、枚举、空字符串和日期错误使用 `INVALID_INPUT`。
- `details` 的诊断键不作为产品契约，但必须是普通对象，且不得包含输入对象引用。

## 4. 成功输出

成功时返回且只返回：

```js
{
  schemaVersion: 'policy-application.lab.v0',
  caseId,
  appliedAt,
  artifactRefs: [
    { kind, artifactId, version, result, evidenceRefs }
  ],
  readiness:
    | 'READY_FOR_CREDIT_REVIEW'
    | 'POLICY_INPUT_INCOMPLETE'
    | 'POLICY_EXCEPTION_REQUIRED',
  missingKinds: string[],
  exceptionReasons: Array<{ kind, result }>,
  authority: {
    policyHumanApprovalRequired: false,
    projectDecisionAuthority: 'NONE',
    consumer: 'CREDIT_REVIEW'
  }
}
```

- `artifactRefs` 按固定 kind 顺序排列，只包含契约定义的五个字段，并对 artifact 与 `evidenceRefs` 数组进行深拷贝。
- `missingKinds` 按固定 kind 顺序列出未提供的种类。
- `exceptionReasons` 始终按固定 kind 顺序列出当前已提供 artifact 中所有 `HIT` 或 `UNKNOWN`；它不改变下面的 readiness 优先级。
- readiness 优先级：
  1. 只要存在缺失 kind，返回 `POLICY_INPUT_INCOMPLETE`；
  2. 仅在六类齐全时，只要存在 `HIT` 或 `UNKNOWN`，返回 `POLICY_EXCEPTION_REQUIRED`；
  3. 仅在六类齐全且全部 `CLEAR` 时，返回 `READY_FOR_CREDIT_REVIEW`。
- `HIT` 不表示项目拒绝，`CLEAR` 不表示项目批准。政策产物不拥有项目决策权。

## 5. 不变性与安全

- 不得修改 input、`artifacts`、artifact 或 `evidenceRefs`。
- 输出不得与输入共享数组或对象引用；调用后任一方向的嵌套修改不得影响另一方。
- 不得把用户提供的键复制为对象结构。包含自有 `__proto__` 键的输入属于额外字段错误，必须抛出 `INVALID_INPUT`，且不得污染任何原型。

## 6. Z 实现边界

- Z 只可读取 `CONTRACT.md` 与 `test/policy-application.test.mjs`。
- Z 只可创建或修改 `src/policy-application.mjs`。
- 禁止联网、安装依赖、Git 操作、修改 provider/login/config、读取凭据或访问 `C:\Users\22673\Desktop\Anthropic`。
- 实现完成后只运行一次：`node --test test/policy-application.test.mjs`。
- 若契约或测试冲突，停止并报告，不得自行扩展对象、状态或产品语义。
