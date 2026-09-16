# 智谱 coding checkpoint

任务类型：repair

## 固定目标

独立接手并审计当前 CP2-HANDLER-02B candidate；仅在冻结契约未满足时，在四个 ownership 文件内做最小修复，使 `record_candidate` 可靠地从 server-owned prepared Candidate 生成 canonical Candidate Receipt 与具名 Human Gate，同时保持 `accept_evidence` 完全兼容。

## 冻结契约

- Public executor 保持同步、非 Promise。Caller exact union 只允许既有 `accept_evidence` 与 `{requestId,idempotencyKey,operation:'record_candidate',expectedContextVersion,payload:{caseId,preparedCandidateRef}}`。
- Caller 不得提供 Candidate 内容、actor、capability/governance/admission proof、Gate actor/assignment、Event/Receipt/Gate/Context IDs 或权威结果。
- 固定 transaction priority：session → Case replay → scoped idempotency → Authority exact action `prepare_candidate_draft` → stale Context → prepared Candidate lookup/binding → `authority=none` 与 CandidateDraft/evidence provenance → Governance replay/identity → governance freshness → `evaluateCapabilityAdmission` → named Human assignment → generated IDs → aggregate replay → atomic commit。
- 只有 Admission `outcome=eligible` 且 `reasonCode=ELIGIBLE` 可继续。Candidate 永远 `authority=none`。
- 成功必须在一个 commit 中追加 `candidate_recorded` 与 `pending_human_review`，写一条 Candidate Receipt、一条 idempotency result，且不推进 ContextVersion。
- Same scoped key/hash 在状态推进后 replay original defensive clone；跨 operation/ref 的 same key 必须 `IDEMPOTENCY_CONFLICT`。
- Stable failures 只使用当前 candidate 已冻结的 codes，包括 `HUMAN_GATE_ASSIGNMENT_MISSING`。任何失败或 fault injection 都必须 zero-write。
- 所有 server construction dynamic keys 使用 prototype-safe Map；canonical duplicate key 必须拒绝而非覆盖；transaction records 与 result/read 必须 deep clone。
- 所有 generated IDs 必须避让完整 historical/store identity namespace。
- 禁止实现 Human decision、Routing/Adapter、handoff、POST、HTTP、SQLite、durable persistence、frontend 或 docs。

## 当前失败证据

没有已知 public failure。当前 paused candidate 的 controller baseline 为 public handler 25/25、existing controller 1/1、full 372/372、typecheck/lint/build green。你的任务不是重做设计，而是 cold-read 审计这四个文件；发现明确缺口才修复，否则保持文件不变并报告 no-change。

## Allowed reads

每个路径最多使用一次 `Get-Content -Raw -LiteralPath`，不得用搜索或目录枚举替代：

- `C:\Users\22673\Desktop\Anthropic\jianwei-v3\site\lib\v4\work-command-types.ts`
- `C:\Users\22673\Desktop\Anthropic\jianwei-v3\site\lib\v4\work-store.ts`
- `C:\Users\22673\Desktop\Anthropic\jianwei-v3\site\lib\v4\work-command-handler.ts`
- `C:\Users\22673\Desktop\Anthropic\jianwei-v3\site\test\v4-work-command-handler.test.mjs`
- `C:\Users\22673\Desktop\Anthropic\jianwei-v3\site\lib\v4\work-aggregate.ts`
- `C:\Users\22673\Desktop\Anthropic\jianwei-v3\site\lib\v4\authority-policy.ts`
- `C:\Users\22673\Desktop\Anthropic\jianwei-v3\site\lib\v4\capability-governance-reducer.ts`
- `C:\Users\22673\Desktop\Anthropic\jianwei-v3\site\lib\v4\capability-admission.ts`
- `C:\Users\22673\Desktop\Anthropic\jianwei-v3\site\lib\v4\capability-admission-types.ts`

## Allowed writes

每个文件只有你一个 writer；如无必要修复则不要写：

- `C:\Users\22673\Desktop\Anthropic\jianwei-v3\site\lib\v4\work-command-types.ts`
- `C:\Users\22673\Desktop\Anthropic\jianwei-v3\site\lib\v4\work-store.ts`
- `C:\Users\22673\Desktop\Anthropic\jianwei-v3\site\lib\v4\work-command-handler.ts`
- `C:\Users\22673\Desktop\Anthropic\jianwei-v3\site\test\v4-work-command-handler.test.mjs`

## Excluded

- 不得读取 `.glm53-control`、`.glm53-evidence`、任何 controller test、Memory、credentials、environment secrets 或聊天记录。
- 不得读写 aggregate、Authority、Governance reducer、Admission evaluator、API/routes/docs/index/V3/frontend/package files。
- 不得使用目录枚举、`rg`/search、Git、网络、安装、构建、lint、typecheck、provider/config、localhost 或额外 test command。
- 不得创建、删除、移动、重命名任何文件；不得修改依赖或运行进程服务。

## Command Gate

Controller 已完成 fixture syntax/loadability、manifest admission 与 runner preflight。你只能按 Allowed reads 各读一次；必要时用 file-change tool 写 Allowed writes；实现或确认 no-change 后运行下面 acceptance command恰好一次。测试失败后停止并报告，不得再次运行或继续修复。

`node --experimental-strip-types --test --experimental-test-isolation=none .\test\v4-work-command-handler.test.mjs`

## Route v2 admission

Profiles：exact-shape、clone、state。Required terms：`record_candidate`、`authority=none`、`prepare_candidate_draft`、`pending_human_review`、`evaluateCapabilityAdmission`、`IDEMPOTENCY_CONFLICT`、`HUMAN_GATE_ASSIGNMENT_MISSING`。这是单 lane、single writer、workspace-write、glm-5.3-flash/high checkpoint。

## Stop conditions

- 发现冻结契约与现有 Aggregate/Authority/Governance/Admission contract 不兼容时停止，不改 read-only modules。
- provider_error、rate_limit、quota、authentication、network、timeout、permission denial 或 scope_violation 时立即停止。
- acceptance 失败、需要第二次 test、需要额外 inspection/command 或需要越过 Allowed writes 时停止。

## Final evidence

只报告：是否修改、修改的 allowed files、唯一 acceptance command/exit code/test count、任何 stop condition、transport terminal、usage/wall、permission denial、副作用与残留进程。不要复制完整文件、prompt、credential 或无关日志。
