# 智谱 coding checkpoint

任务类型：`implementation`

## 固定目标

只实现同步内存态 `submit_credit_decision`：具名 Human 在已有 `pending_human_review` 后，以 `approve_credit` 原子写入 `credit_approved` Event、独立 canonical Decision Receipt、Projection 与 idempotency response。

## 冻结契约

- 新 command：`V4SubmitCreditDecisionCommand = { requestId, idempotencyKey, operation: 'submit_credit_decision', expectedContextVersion, payload: { caseId, action: 'approve_credit', rationale } }`。keys exact-own；`operation`/`action` 必须 exact literal，不可 trim 成合法值；opaque IDs 沿现有 bounded/canonical 规则；`rationale` trim 后长度 1..2000，Event/Receipt 存 canonical trimmed 文本；API 同步且非 Promise。
- 必须新增独立 `V4CreditDecisionReceipt`：字段严格为 `decisionReceiptId`, `receiptType: 'credit_decision'`, `status: 'committed'`, `action: 'approve_credit'`, `caseId`, `attemptId`, `actorId`, `contextVersion`, `authoritySource: 'named_human'`, `authorityDecisionOutcome: 'allowed'`, `authorityDecisionId`, `policyVersion`, `gateId`, `candidateId`, `evidenceReceiptIds`, `rationale`, `eventId`, `sequence`。新增 `V4SubmitCreditDecisionCommandReceipt` 作为 response；response 不是 canonical receipt。
- `CreditApprovedEvent` 必须增加 `gateId`, `candidateId`, `evidenceReceiptIds`, `rationale`。这些 lineage 值由 server/current aggregate 得出；caller 不得提交。aggregate exact replay 必须验证 active pending Gate、exact Actor/Context、Candidate context、非空且 exact Evidence lineage，以及 authority/Decision Receipt ID 不复用。
- store 的 transaction state 与 case snapshot 必须有 `decisionReceipts: V4CreditDecisionReceipt[]`，初始为空，clone/snapshot/read 均 defensive deep clone。transaction failure 时 Event、Decision Receipt、Projection、idempotency 全部 zero-write。
- ID namespace：Event `V4-WORK-EVENT-*`；Decision Receipt `V4-DECISION-RECEIPT-*`；Authority Decision `V4-AUTHORITY-DECISION-*`。完整 Case 历史和 store state 都参与 collision check。
- Authority action exact `{ family: 'professional_decide', name: 'credit_decide' }`。Actor/session/assignments/grants/denies/current policy/current Context 必须 server-derived。成功还需 session Actor 是 `currentHumanGate.requiredActorId` 且有效 Human identity。capability/system_service/authorized_rule、role-only、wrong actor、denied/unknown 都 fail closed。Candidate 仍然 `authority=none`。
- 成功后只推进 credit（workflow `credit_approved`），清除 Gate、形成 namedHumanDecision；commercial/asset/commencement 不变。不得实现 supplement/reject/veto/handoff。
- 冻结 error priority：`INVALID_COMMAND → SESSION_NOT_FOUND → CASE_NOT_FOUND → CORRUPT_HISTORY → idempotent replay / IDEMPOTENCY_CONFLICT → AUTHORITY_UNKNOWN → AUTHORITY_DENIED → STALE_CONTEXT → HUMAN_GATE_NOT_PENDING → HUMAN_GATE_ACTOR_MISMATCH → DECISION_LINEAGE_INVALID → TRANSACTION_FAILED`。Authority 必须早于 caller stale Context；Gate/lineage 在 fresh Context 后。新增 error literal 仅可为 `HUMAN_GATE_NOT_PENDING`, `HUMAN_GATE_ACTOR_MISMATCH`, `DECISION_LINEAGE_INVALID`。

## 当前失败证据

新实现 checkpoint。aggregate 已有 `credit_approved` pure event vocabulary，但 handler/store 只有 `accept_evidence`、`record_candidate` 与 Evidence/Candidate receipts。

## Allowed reads

- `C:\Users\22673\Desktop\Anthropic\jianwei-v3\site\lib\v4\work-command-types.ts`
- `C:\Users\22673\Desktop\Anthropic\jianwei-v3\site\lib\v4\work-aggregate.ts`
- `C:\Users\22673\Desktop\Anthropic\jianwei-v3\site\lib\v4\work-store.ts`
- `C:\Users\22673\Desktop\Anthropic\jianwei-v3\site\lib\v4\work-command-handler.ts`
- `C:\Users\22673\Desktop\Anthropic\jianwei-v3\site\lib\v4\authority-types.ts`
- `C:\Users\22673\Desktop\Anthropic\jianwei-v3\site\lib\v4\authority-policy.ts`
- `C:\Users\22673\Desktop\Anthropic\jianwei-v3\site\test\v4-work-command-handler.test.mjs`
- `C:\Users\22673\Desktop\Anthropic\jianwei-v3\site\docs\v4\V4_BACKEND_REFACTOR_CONTROL.md`
- `C:\Users\22673\Desktop\Anthropic\jianwei-v3\site\docs\v4\V4_CONTRACT.md`
- `C:\Users\22673\Desktop\Anthropic\jianwei-v3\site\docs\v4\V4_ACCEPTANCE.md`
- `C:\Users\22673\Desktop\Anthropic\jianwei-v3\site\package.json`

## Allowed writes

唯一 writer，只能写：

- `C:\Users\22673\Desktop\Anthropic\jianwei-v3\site\lib\v4\work-command-types.ts`
- `C:\Users\22673\Desktop\Anthropic\jianwei-v3\site\lib\v4\work-aggregate.ts`
- `C:\Users\22673\Desktop\Anthropic\jianwei-v3\site\lib\v4\work-store.ts`
- `C:\Users\22673\Desktop\Anthropic\jianwei-v3\site\lib\v4\work-command-handler.ts`
- `C:\Users\22673\Desktop\Anthropic\jianwei-v3\site\test\v4-work-command-handler-03a.test.mjs`

## Excluded

禁止读取 hidden controller test 或 task pack；禁止目录枚举、搜索、Git、依赖安装、网络、凭据、localhost、真实 API/data、V3、frontend、HTTP POST、SQLite/durable persistence、authorized_rule、Routing/Adapter、supplement/reject/veto/handoff，以及项目 AGENTS、runner/provider/auth 修改。

## Command Gate

Controller 已完成 fixture syntax/loadability、manifest admission 与 runner preflight。新 fixture 缺少 solution 是初始状态，未运行必然失败的 missing-solution test。

Worker 只允许：每个 allowed read 使用 `Get-Content` 读取一次；通过 file-change 工具写 allowed writes；实现后运行下列 acceptance command **恰好一次**。禁止 `Test-Path`、额外 parser/lint、目录枚举、搜索、Git、重复读取和其它 inspection command。

`node --experimental-strip-types --test --experimental-test-isolation=none .\test\v4-work-command-handler-03a.test.mjs`

## Route v2 admission

manifest v2 profiles：exact-shape、clone、state。单 lane，`glm-5.3-flash` / `high` / `workspace-write`，新 JSONL。hidden controller test 不在 allowed reads。

## Stop conditions

契约冲突、范围冲突、测试失败、permission denial、rate limit、quota、auth、network、timeout 时停止；不得自行扩展写入范围或静默由 controller 接管。

## Final evidence

返回修改范围、实际 command/exit code、唯一 worker test、terminal、usage、wall、denial、副作用与 residue；不要宣布 Control accepted。
