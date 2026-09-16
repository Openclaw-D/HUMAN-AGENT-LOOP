# 智谱 coding checkpoint

任务类型：repair

## 固定目标

修复 CP2-HANDLER-02B/R1 的两个已确认缺口：`record_candidate` 的 Gate assignee 必须解析到 server-owned `V4ActorIdentity` 中真实的具名 Human；Store 构造期 Actor、Session、Case canonical duplicate keys 必须 fail closed。完成后仍只到 Candidate → pending Human Gate，不执行 Human Decision。

## 冻结契约

- 现有 command/result/Receipt exact shape 与 synchronous non-Promise API 不变；不新增 operation。
- `V4WorkStoreSeed` 在 `work-store.ts` 内新增可选 `actors?: V4ActorIdentity[]`；`V4WorkTransactionContext` 新增 `actors: Map<string,V4ActorIdentity>`。不得修改只读的 `work-command-types.ts` 或 `authority-types.ts`。
- Actor directory 是 server-owned construction state；transaction 获得 defensive deep clone。
- Actor key 是 canonical actorId；Actor/Session/Case 空白 key 抛 `INVALID_WORK_STORE_SEED`；canonical duplicate key 抛 `DUPLICATE_WORK_STORE_KEY`，禁止 `Map.set` 覆盖。prepared Candidate/Governance/Assignment 既有 semantics 不变。
- `record_candidate` 在 assignment parse 后查询 Actor directory。Missing、invalid exact shape、capability、authorized_rule、system_service 都映射 `HUMAN_GATE_ASSIGNMENT_MISSING`。
- 只允许 `internal_human` 或 `external_human`。Internal identity 必须满足现有 exact shape；external identity 必须满足 exact shape，且 `externalInvitation.caseId` 等于 current Case。
- `requiredActorId` 仍不得等于 capabilityId 或 candidateId。被分配不授予 professional decision Authority；Candidate 始终 `authority=none`。
- 固定 priority：INVALID_COMMAND → SESSION_NOT_FOUND → CASE_NOT_FOUND → CORRUPT_HISTORY → scoped replay/conflict → `prepare_candidate_draft` Authority → stale Context → prepared Candidate → Governance → classification/stage → Admission → assignment → Actor directory → transaction/aggregate failure。Exact replay 必须先于 Actor lookup。
- Success 仍为 cloned per-Case transaction 内 exactly two Events + one Candidate Receipt + pending Gate + Projection + idempotency result，一次 commit，不改变 ContextVersion。
- identity/duplicate/validation/fault failure 全部 zero-write；replay 8× 不重复 Event/Receipt/Gate。
- seed/input/result/store read/transaction Actor Map 必须 defensive clone。

## 当前失败证据

现有 candidate 只验证 assignment.requiredActorId 是非空且不等于 capability/candidate，没有 server-owned Actor directory lookup；Store constructor 对 Session/Case 仍直接 Map.set。Controller 已创建 hidden Gate，但该文件禁止读取或运行。

## Allowed reads

每个文件最多用一次 `Get-Content -Raw -LiteralPath`：

- `C:\Users\22673\Desktop\Anthropic\jianwei-v3\site\lib\v4\work-command-types.ts`
- `C:\Users\22673\Desktop\Anthropic\jianwei-v3\site\lib\v4\work-store.ts`
- `C:\Users\22673\Desktop\Anthropic\jianwei-v3\site\lib\v4\work-command-handler.ts`
- `C:\Users\22673\Desktop\Anthropic\jianwei-v3\site\lib\v4\authority-types.ts`
- `C:\Users\22673\Desktop\Anthropic\jianwei-v3\site\test\v4-work-command-handler.test.mjs`

## Allowed writes

你是以下三个文件的唯一 writer；只能用 file-change tool 修改：

- `C:\Users\22673\Desktop\Anthropic\jianwei-v3\site\lib\v4\work-store.ts`
- `C:\Users\22673\Desktop\Anthropic\jianwei-v3\site\lib\v4\work-command-handler.ts`
- `C:\Users\22673\Desktop\Anthropic\jianwei-v3\site\test\v4-work-command-handler.test.mjs`

## Excluded

- 禁止读取或运行 `v4-work-command-handler-02b-r1-controller.test.mjs`、`v4-work-command-handler-controller.test.mjs`、task pack、manifest、JSONL、Memory、credentials 或聊天。
- 禁止修改 `work-command-types.ts`、`authority-types.ts`、aggregate、Authority policy、Governance、Admission、CP1C/routes/index/docs/V3/frontend/package。
- 禁止 Human decision、professional_decide、Decision Receipt、Handoff、POST、SQLite/persistence、Routing/Adapter。
- 禁止 directory enumeration、search/rg、Git、install、network、provider/config/login、localhost、创建/删除/移动文件和额外 test/command。

## Command Gate

Controller 已完成 fixture syntax/loadability、manifest admission、contract parity 与 runner preflight。你只允许：每个 Allowed read 读取一次；用 file-change tool 修改 Allowed writes；实现完成后运行以下 public acceptance command恰好一次。首次失败立即停止，不得修复后重跑。

`node --experimental-strip-types --test --experimental-test-isolation=none .\test\v4-work-command-handler.test.mjs`

## Route v2 admission

Fresh single lane；glm-5.3-flash/high；workspace-write；profiles exact-shape、clone、state。Required terms：`record_candidate`、`V4ActorIdentity`、`internal_human`、`external_human`、`HUMAN_GATE_ASSIGNMENT_MISSING`、`DUPLICATE_WORK_STORE_KEY`、`authority=none`。Max command events 12；每 allowed read 最多一次；forbid directory enumeration；reject unclassified commands。Frozen ROI：benefit 95、cost 58、net 37、ratio 1.64，minimum net 20、minimum ratio 1.5。

## Stop conditions

- 现有 `V4ActorIdentity` 无法在不修改 `authority-types.ts` 时证明 Human kind，停止并报告 exact incompatibility。
- 必须改变 command/result/API、Authority policy、aggregate 或引入新 operation，停止。
- provider_error、rate_limit、quota、authentication、network、timeout、permission denial、scope violation、重复 read/test、额外 command 或 acceptance failure 时保留 evidence 并停止；不得第二次调用。

## Final evidence

只报告 changed allowed files、唯一 acceptance command/exit/test count、terminal、usage/wall、scope/command count、denial/side effects/residue 与 stop condition。不要复制 prompt、完整源码、controller hidden test、credential 或无关日志。
