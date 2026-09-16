# 智谱 coding checkpoint

任务类型：`repair`

## 固定目标

修复 R0 rejected candidate，保留已冻结的 `submit_credit_decision` command/Event/Decision Receipt/store/Authority/error contract，并证明真实同步三命令链：`accept_evidence → record_candidate → submit_credit_decision → stored canonical Decision Receipt`。

## 冻结契约

- 修复 `work-command-handler.ts` 中 `requestHash()` 后的重复残留代码导致的 syntax failure。
- 保持独立 canonical `V4CreditDecisionReceipt` 与 Candidate `authority=none` 的 R0 contract；不得把 Decision Receipt 降格为 response，也不得扩展到其它 action。
- Decision success 除原 R0 contract 外，必须在 fresh Context 后验证：`current.candidateDraft` 与 active pending Gate exact；`caseState.candidateReceipts` 中恰有一个 canonical receipt exact 匹配 candidateId/context/gateId/requiredActor/evidenceReceiptIds；其 assignmentRef 与 `transaction.creditReviewAssignments.get(caseId)` 当前 assignment exact 相同，requiredActorId 等于 session actor/Gate actor；每个 Candidate evidence receipt 都在 `caseState.evidenceReceipts` 有 canonical committed receipt，并与 Projection accepted Evidence exact。任一缺失、重复或漂移返回 `DECISION_LINEAGE_INVALID`，位于 `HUMAN_GATE_ACTOR_MISMATCH` 后、transaction 前，零写入。
- focused public test 必须真实执行 `accept_evidence`、`record_candidate`、`submit_credit_decision`，不得 raw seed accepted/candidate/gate events；覆盖 canonical Candidate/Evidence Receipt 缺失/重复/assignment drift、exact shape/rationale bounds/dangerous keys、authority/stale/no gate、ID collision/idempotency/transaction zero-write/clone/sync/downstream state。
- existing aggregate approval fixtures 必须加入新 exact Event fields，保留既有 negative semantics。

## 当前失败证据

R0 provider transport 完成但 scope rejected，不能接受：command 24/12，核心文件重复读取，且 `requestHash()` 后残留重复代码。R1 是全新 invocation；不得复用旧 JSONL。

## Allowed reads

- `C:\Users\22673\Desktop\Anthropic\jianwei-v3\site\lib\v4\work-command-types.ts`
- `C:\Users\22673\Desktop\Anthropic\jianwei-v3\site\lib\v4\work-aggregate.ts`
- `C:\Users\22673\Desktop\Anthropic\jianwei-v3\site\lib\v4\work-store.ts`
- `C:\Users\22673\Desktop\Anthropic\jianwei-v3\site\lib\v4\work-command-handler.ts`
- `C:\Users\22673\Desktop\Anthropic\jianwei-v3\site\test\v4-work-command-handler-03a.test.mjs`
- `C:\Users\22673\Desktop\Anthropic\jianwei-v3\site\test\v4-work-aggregate.test.mjs`
- `C:\Users\22673\Desktop\Anthropic\jianwei-v3\site\test\v4-work-command-handler.test.mjs`

## Allowed writes

唯一 writer，只能写：

- `C:\Users\22673\Desktop\Anthropic\jianwei-v3\site\lib\v4\work-command-types.ts`
- `C:\Users\22673\Desktop\Anthropic\jianwei-v3\site\lib\v4\work-aggregate.ts`
- `C:\Users\22673\Desktop\Anthropic\jianwei-v3\site\lib\v4\work-store.ts`
- `C:\Users\22673\Desktop\Anthropic\jianwei-v3\site\lib\v4\work-command-handler.ts`
- `C:\Users\22673\Desktop\Anthropic\jianwei-v3\site\test\v4-work-command-handler-03a.test.mjs`
- `C:\Users\22673\Desktop\Anthropic\jianwei-v3\site\test\v4-work-aggregate.test.mjs`

## Excluded

禁止 controller tests、目录枚举、rg/search、Git、项目 AGENTS、docs、旧 JSONL、runner/canonical/provider/auth、npm wrapper、typecheck/lint/build/full suite、依赖、网络、localhost、V3/frontend/HTTP/SQLite/Routing/authorized_rule。

## Command Gate

只允许每个 read 使用 `Get-Content` 一次、一次 consolidated apply_patch、以及实现后一次且仅一次 acceptance：

`node --experimental-strip-types --test --experimental-test-isolation=none .\test\v4-work-command-handler.test.mjs .\test\v4-work-command-handler-03a.test.mjs .\test\v4-work-aggregate.test.mjs`

禁止任何其它 command、重复读取、预检或单独 test。

## Route v2 admission

single lane, `glm-5.3-flash` / `high` / `workspace-write`; maxCommandEvents=10；exact-shape、clone、state profiles；fresh JSONL；hidden controller test 不在 reads。

## Stop conditions

若无法在 10 commands 内完成，或 contract/manifest/preflight/provider/scope/test 失败，立即停止且不得重试或由 controller 接管。
