# TAG P0-B1 Frozen Contract — Business/Risk Review Loop

## Status and scope

This document freezes the P0-B1 contract for the dependency-free, in-memory backend loop. It is the authority for this checkpoint. It is a design and acceptance contract: implementation status is recorded only in `STATUS.md` after independent verification.

Scope: one Project and one shared Thread; synthetic human principals; deterministic advisory generation; immutable in-memory records and hash-linked events. Excluded: HTTP/SSE, SQLite, authentication, real models, A2A, MCP, RAG, external tools, and production authority.

## Authority and responsibility boundary

| Identity | May do | Must not do |
| --- | --- | --- |
| Business human | submit, answer a Challenge, add Evidence, invoke advisory work | resolve a Challenge, create a Decision, change policy |
| Risk human with `decide` capability | communicate, resolve/reopen a Challenge, create a `pass` or `veto` Decision | let model signals decide automatically |
| Agent/model | create an `advisoryOnly: true` Artifact with valid Citations | create a Decision or authoritative state |
| Control/policy service | technical validation and deterministic policy output | make a business/risk Decision |
| Workflow Lab | present synthetic input and call frozen command shapes only | persist authority, invent policy, silently fake backend success |

Risk is the sole final decision authority during a risk review. A missing or unverifiable item may lower confidence or create a Challenge; it cannot automatically create `veto`.

## Canonical records and immutability

`ReviewRound` has `id`, `projectId`, `threadId`, `number`, `status`, `submittedBy`, `snapshotId`, `challengeIds`, and optional `decisionId`. States are `submitted`, `needs_input`, `under_review`, `decided`; only `decided` is terminal.

`ContextSnapshot` is an immutable receipt with `id`, `projectId`, `threadId`, `reviewRoundId`, source `threadVersion`, ordered Evidence references (ID, locator, hash), Challenge state, deterministic evidence confidence, and creation Event sequence. A new submission after evidence creates a new Snapshot; no prior Snapshot, Artifact, Goal, or Decision is rewritten.

`Challenge` has `id`, `projectId`, `reviewRoundId`, `snapshotId`, `status` (`open`, `answered`, `resolved`, `reopened`), creator, prompt, mandatory flag, answer evidence/message references, and immutable transition Events. `communicate` opens/reopens a Challenge and sets the round to `needs_input`; it never creates a Decision or closes the Thread.

`Artifact` is immutable and includes `id`, `projectId`, `threadId`, `reviewRoundId`, `snapshotId`, `advisoryOnly: true`, citations, model confidence, and content. Each Citation must target Evidence in the same Project and contain the exact stable Evidence ID, locator, and content hash.

`Decision` is immutable and includes `id`, `projectId`, `threadId`, `reviewRoundId`, `snapshotId`, `principalId`, `outcome`, rationale, exact thread version, and revision linkage. Outcomes are exactly `pass` and `veto`. Reconsideration creates a new ReviewRound and a linked new Decision revision; it never overwrites history.

## Command schema and technical preconditions

Every mutation takes a payload and command envelope:

```text
{ projectId, actor, capability, idempotencyKey, requestHash, expectedVersion }
```

`requestHash` is computed from a deep canonical form: object keys are sorted recursively and arrays retain declared semantic order. The server recomputes it; a supplied mismatch is `REQUEST_HASH_MISMATCH`. Idempotency is scoped to `projectId + actorId + command + idempotencyKey`; the same canonical request replays the original stored result, while a different request returns `IDEMPOTENCY_CONFLICT`.

| Command | Actor/capability | State effect | Success event |
| --- | --- | --- | --- |
| `submitForRiskReview` | business human / `submit` | creates round + Snapshot; `submitted` or `under_review` | `RiskReviewSubmitted`, `ContextSnapshotCreated` |
| `communicateRiskChallenge` | risk human / `communicate` | creates/reopens Challenge; round `needs_input` | `RiskChallengeCommunicated` |
| `answerChallenge` | business human / `answer` | records answer Evidence/message refs; Challenge `answered`; creates new Snapshot | `RiskChallengeAnswered`, `ContextSnapshotCreated` |
| `resolveRiskChallenge` | risk human / `resolve` | Challenge `resolved`; round may return `under_review` | `RiskChallengeResolved` |
| `invokeDeterministicAdvisory` | authorized human / `invoke` plus agent identity | creates cited advisory Artifact for explicit Snapshot | `AdvisoryArtifactCreated` |
| `recordRiskDecision` | risk human / `decide` | creates immutable `pass` or `veto`; round `decided` | `RiskDecisionRecorded` |
| `reconsiderRiskDecision` | authorized human / `reconsider` | creates linked new ReviewRound/Snapshot, preserving old Decision | `RiskDecisionReconsidered` |

All commands enforce Project scope, active membership, the exact listed capability, expected aggregate version, referenced-object scope, and request idempotency before any write. A failed command creates zero record, zero event, and zero idempotency result.

## Run ownership and fencing

`reserveRun` returns an opaque owner token and a monotonically increasing `fencingToken`. Lease takeover creates a new attempt with a greater fencing token. `succeedRun` and `failRun` require the current owner token and fencing token. Any stale owner/attempt returns `RUN_FENCE_CONFLICT` without altering the newer attempt.

## Policy outputs

Policy can return only technical/review guidance: `ready`, `needs_input`, or `manual_review`, plus reasons such as `MANDATORY_CHALLENGE_OPEN` or `ACTIVE_RUN`. Policy/model output never maps to `pass` or `veto`; those outcomes require `recordRiskDecision` by a qualifying risk human.

## Error codes

Required stable errors: `PROJECT_NOT_FOUND`, `THREAD_NOT_FOUND`, `SNAPSHOT_NOT_FOUND`, `REVIEW_ROUND_NOT_FOUND`, `CHALLENGE_NOT_FOUND`, `EVIDENCE_NOT_FOUND`, `CITATION_INVALID`, `ACTIVE_MEMBERSHIP_REQUIRED`, `HUMAN_AUTHORITY_REQUIRED`, `CAPABILITY_REQUIRED`, `DECISION_OUTCOME_INVALID`, `IDEMPOTENCY_KEY_REQUIRED`, `REQUEST_HASH_MISMATCH`, `IDEMPOTENCY_CONFLICT`, `VERSION_CONFLICT`, `RUN_NOT_FOUND`, `RUN_NOT_WRITABLE`, `RUN_FENCE_CONFLICT`, and `STATE_TRANSITION_INVALID`.

Cross-project lookup/reference errors use the same not-found/invalid code and expose no foreign record detail.

## Required acceptance tests

1. Business directly submits with insufficient material; no automatic veto occurs.
2. `communicate → Challenge.open → answer with evidence → new Snapshot → advisory → pass/veto` succeeds, including multiple Challenge cycles.
3. Only a risk human with `decide` can record an allowed final outcome; agent, business, and control fail with no side effects.
4. All Artifact Citations bind to same-project Evidence ID, locator, and hash; invalid and cross-project references fail without leakage.
5. Same deep-semantic request replays once; same key with changed content conflicts.
6. Stale expected version and all validation failures leave records/events/idempotency unchanged.
7. Lease takeover fences old success/failure attempts.
8. Snapshots, Artifacts, and Decisions remain unchanged after new evidence, new rounds, and reconsideration.
9. `npm.cmd test` passes. The Workflow Lab can be considered only after these backend interfaces are stable.

## Front integration boundary

The optional `lab/**` Workflow Lab may use only the command names, record fields, state names, policy labels, event names, and error codes in this document. Until G1 accepts the backend, it must label all data as `simulated/local`, retain no authoritative state, and visibly fail rather than fall back when a future backend adapter is unavailable.

---

# P0-2 Frozen Contract — Durable Local Application

## Checkpoint identity and budget

P0-2 continues the existing P0 Control, P0 Back, and P0 Front tasks. It does not create a new task or product stage.

- Back implementation: approximately 60% of checkpoint effort.
- Front implementation: approximately 25%, starting only after Back G1 acceptance.
- Control contract, independent verification, browser acceptance, and documentation: approximately 15%.

Status: approved and in progress. Nothing in this section is implemented until `STATUS.md` records independent Gate evidence.

## Objective

Deliver one locally usable, restart-safe P0 application:

1. the existing deterministic business/risk state machine remains backend authority;
2. accepted commands, immutable history, idempotency, events, and projections survive restart in SQLite WAL;
3. a local HTTP/SSE adapter exposes the frozen commands and read models;
4. a Sites-compatible local Front renders the shared project conversation, review workflow, Snapshot comparison, Event timeline, and Graph from backend data;
5. the Front never invents authoritative success or writes state outside backend Commands.

This is a complete local P0 loop, not a production system.

## Included and excluded

Included: one synthetic Project, one shared Thread, human Messages with reply/Citation links, the accepted P0-B1 review commands, SQLite WAL, atomic state/event/idempotency/outbox writes, restart recovery, projection checkpoint/rebuild, project-scoped reads, local HTTP JSON, project SSE replay/reset, deterministic advisory output, and a Sites-compatible local Front.

Excluded: real authentication, real organizational authority, real customer data, real models, external tools, A2A, MCP, RAG, uploads, public deployment, production security claims, generic workflow editing, multi-tenant scale, and changes to the frozen `pass`/`veto` authority rule.

## File ownership

- P0 Control owns only root governance documents.
- P0 Back owns `src/**`, `test/**`, backend-only `scripts/**`, and the root `package.json` scripts required to run/test the local backend.
- P0 Front is the only Site-owning writer and owns only `lab/**`, including its own `.openai/hosting.json`, package files, components, styles, and Front tests.
- Runtime databases, logs, generated archives, caches, credentials, and Sites deployment artifacts must remain outside committed source surfaces or be ignored within `lab/**` as appropriate.
- No Git commit/push and no public/private Sites deployment are authorized in P0-2; local Sites preview only.

## Backend authority and persistence invariants

- Use Node's built-in `node:sqlite`; add no root runtime dependency.
- SQLite uses WAL and foreign keys. Schema version is explicit and startup fails closed on an unsupported version.
- One successful Command transaction commits canonical aggregate state, append-only Event(s), IdempotencyRecord, and OutboxRecord atomically.
- Validation or transaction failure creates no authoritative state, Event, idempotency result, or outbox row.
- Stored request hashes use the existing deep canonicalization contract.
- Event sequence and hash continuity are verified on startup. Corruption returns a stable startup/read error and is never silently repaired.
- Projection rebuild starts from canonical stored records/events and produces a stable checksum without rewriting history.
- Database files used by the running app live outside source directories. Tests use isolated temporary databases.
- Thread version remains the optimistic concurrency authority. Concurrent commands against one version yield exactly one accepted version.
- Reconsideration, new Evidence, new Snapshot, new Artifact, and new Decision append history; prior records remain byte-stable in their canonical JSON representation.

## Shared Thread addition

P0-2 restores the visible collaboration surface required by the product objective:

- `appendHumanMessage`: active business/risk human with `message` capability; supports `replyToMessageId` and exact same-project Citations.
- Agent advisory work may append a linked agent Message, but the Message remains advisory and references its immutable Artifact.
- Messages are immutable, monotonically sequenced within the shared Thread, project-scoped, and emitted as Events.

## Local HTTP contract

Default backend origin: `http://127.0.0.1:4174`.

### Reads

- `GET /health` returns runtime/schema readiness without sensitive paths.
- `GET /api/projects/{projectId}/state` returns Project, Thread, Messages, review records, current versions, and last Event sequence.
- `GET /api/projects/{projectId}/graph` returns the coordinate-free backend Graph projection.
- `GET /api/projects/{projectId}/events?after={sequence}` returns only that Project's ordered Events.

### Commands

- `POST /api/projects/{projectId}/commands` accepts `{ command, payload, envelope }`.
- `envelope` contains `actor`, declared `capability`, `idempotencyKey`, `requestHash`, and `expectedVersion` when the aggregate is versioned.
- Supported command names are `appendHumanMessage`, `addEvidence`, `submitForRiskReview`, `communicateRiskChallenge`, `answerChallenge`, `resolveRiskChallenge`, `invokeDeterministicAdvisory`, `recordRiskDecision`, and `reconsiderRiskDecision`.
- A deterministic local bootstrap command/fixture may create the single synthetic demo Project idempotently; it must be clearly marked simulated and unavailable as a production identity mechanism.

### Responses and errors

- Success: `{ data, projectVersion, eventSequence }`.
- Failure: `{ error: { code, message } }`; no stack, filesystem path, SQL, foreign object detail, or secret is returned.
- Technical error/status mapping is stable: invalid schema/hash `400`; authority/capability `403`; scoped not-found `404`; idempotency/version/fencing/state conflict `409`; unavailable/corruption `503`.
- `invokeDeterministicAdvisory` requires a non-empty stable `agentId`; a missing/blank value is the zero-write `AGENT_ID_REQUIRED` `400` error.
- CORS permits only the configured local Front origins.
- Any request carrying an `Origin` outside that allowlist is rejected before its body is read or a Command is executed. Requests without `Origin` remain available to local CLI/test clients.

## SSE contract

- `GET /api/projects/{projectId}/events/stream` is project-scoped.
- Event `id` is the durable Event sequence and `data` is the stored Event JSON.
- `Last-Event-ID` replays later available Events in order with no duplicates.
- An unavailable cursor emits an explicit `reset` event instructing the Front to refetch state; it never silently substitutes synthetic events.
- Disconnect/reconnect must not mutate backend state.

## Sites-compatible Front contract

The Front remains under `lab/**` but becomes a componentized Sites-compatible local application. It may add only the dependencies created/required by the pinned Sites scaffold and must preserve its own package manager and lockfile.

Required product surface:

- backend connection and simulated/local boundary status;
- one shared Project/Thread conversation showing business, risk, and advisory Agent messages;
- backend-driven action controls for the full submit → communicate → answer → new Snapshot → advisory → resolve → pass/veto loop;
- visible allowed/rejected Command result and stable backend error code;
- immutable S1/S2 comparison within the same ReviewRound;
- Event timeline driven by backend Event sequence/SSE;
- coordinate-free Graph rendered from `/graph`, with layout kept as Front state only;
- explicit empty/loading/error/reconnect states and no silent mock fallback;
- desktop-first 1920×1080 baseline plus readable narrow/mobile layout.

The Front may edit presentation, layout, filters, drafts, and synthetic input. It may not directly edit Membership, policy, Event history, Snapshot, Artifact, Decision, idempotency records, or backend versions.

## Gates

### G0 — Contract

This section is frozen before Back writes. Any change to storage model, command envelope, identity classes, authority, HTTP shape, or Sites/local boundary stops implementation for Control review.

### G1 — Back

Required evidence:

- existing P0-B1 tests still pass;
- focused persistence/API tests pass;
- restart preserves the complete accepted review loop and idempotent replay;
- event/hash verification and projection rebuild checksum pass;
- two Projects cannot read, stream, cite, or mutate each other's records;
- stale version, changed same-key request, stale run fence, invalid capability, and transaction failure are zero-write;
- concurrent same-version Commands produce exactly one accepted result;
- HTTP error bodies do not leak internals;
- exact commands: `npm.cmd test` and a local health/API smoke test.

### G2 — Front

Starts only after Control accepts G1 and publishes the exact running commands/read schemas. Required evidence:

- Sites-compatible build succeeds;
- no authoritative local mock state or silent fallback remains;
- full loop can be driven through the UI against the local backend;
- refresh/restart preserves state and SSE reconnect does not duplicate events;
- roles, same-round S1/S2, advisory-only Agent, risk-only Decision, Event timeline, and Graph are visibly correct;
- console error/warning count is zero and page-level horizontal overflow is zero at the accepted desktop baseline and a narrow viewport.

### G3 — Integration

Control independently reruns Back tests/build/smoke checks and Front build/browser acceptance, records actual pass/fail/unverified items, then updates governance documents. Local preview may remain open for user review; deployment requires separate authorization.

## Stop conditions

Stop and return to the user if implementation requires a new external backend dependency, a different database/hosting authority, real authentication/model/API keys, public/private deployment, changes to `pass`/`veto` authority, migration of source outside the saved TAG directory, destructive data handling, or any architecture/interface change not covered above.

## P0-2 scenario and degradation checkpoint

This subsection freezes the user's nontechnical-explainability and contingency requirements without expanding P0 into production operations.

### Required synthetic scenario pack

Backend tests and Front demonstrations must cover at least:

1. direct submission with limited Evidence and no automatic veto;
2. one communicate/answer/new-Snapshot cycle followed by `pass`;
3. multiple Challenge cycles followed by `veto`;
4. invalid Citation or cross-project reference rejected with zero writes;
5. stale version and duplicate/idempotency conflict;
6. advisory service unavailable while the human-only review remains usable;
7. SSE disconnect/reconnect without duplicate Events;
8. projection rebuild after a stale/missing projection;
9. database corruption/unavailability failing closed without invented state.

All scenario records are synthetic and clearly labeled. Scenario data supports demonstration and tests; it is not customer validation or statistical evidence.

### Frozen degradation policy

- Advisory degradation: when Agent/advisory work is unavailable, record/return `ADVISORY_UNAVAILABLE`; do not create an Artifact and do not block human Messages, Evidence, Challenges, or an authorized risk Decision. The Front shows “人工审查模式” and never fabricates Agent output.
- Streaming degradation: when SSE is unavailable, the Front may poll the accepted state/events reads with an explicit “实时连接已降级” indicator. Polling never changes authority or fabricates Events.
- Projection degradation: a missing/stale projection is rebuilt from canonical history and reports rebuild status/checksum. Projection state never replaces canonical records.
- Storage degradation: an unavailable or corrupt SQLite store fails closed for authoritative mutations. It may expose a redacted health/manual-handoff status, but it must not switch silently to browser memory, a new empty database, or synthetic success.
- Traditional/manual fallback means the same backend-governed human workflow without Agent assistance: human Message → Evidence → Challenge → human risk Decision. It does not mean bypassing the backend or editing Event history.

### Front information design acceptance

- The first viewport prioritizes: current phase, responsible participant, current blocker/Challenge, latest Snapshot, and next permitted human action.
- Business, System, Intelligence, and Risk use a stable color system; color is never the only status signal.
- Size and grouping communicate importance: current state and next action are primary; history, policy explanation, tests, and raw Events are progressively disclosed.
- Every major state explains in plain language: what happened, who participated, when intervention is required, and what happens next.
- Technical fields remain inspectable but are not all shown by default.
- The Front must demonstrate normal, degraded, rejected, empty, loading, reconnecting, and backend-unavailable states.

### Added Gates

- G1-A: durable command/API core passes before scenario/degradation work is accepted.
- G1-B: the synthetic scenario pack and all frozen degradation behaviors pass focused backend tests.
- G2-A: first meaningful Sites preview shows the product's state/role/next-action hierarchy using backend-compatible data shapes.
- G2-B: the complete local Front connects to accepted Back, exercises the scenario pack, and passes responsive/console/overflow checks.
- G3 remains the final independent Control integration and truth-report Gate.

## P0-2 G2-C Frozen Front Information Architecture Refactor

G2-C is a user-approved presentation refactor inside the existing P0 task chain. It does not create a new task, change backend authority, add a backend endpoint, or reopen the accepted state-machine contract. P0 Front remains the only writer under `lab/**`; Control owns this contract and final Gate acceptance. No dependency change, deployment, authentication, or real-model work is authorized.

### Primary human-readable surface

- The first viewport is a real four-lane workflow, not a passive role legend. Rows are `Business`, `System`, `Intelligence`, and `Risk`; workflow stages run horizontally from left to right.
- The horizontal stage axis must show at least: business submission, risk communication/review, business evidence response, system Snapshot creation, Intelligence advisory, and risk Decision. Repeated ReviewRounds or Challenge cycles must remain understandable without inventing a fixed success path.
- The current backend-derived stage is selected by default. A human may select another stage without mutating backend state.
- Selecting a stage shows exactly the human explanation needed for that moment: who acted, what they did, the input/context used, the effect on authoritative state, and what happens next. Missing data is labeled as unavailable; it is never fabricated.
- Stable role color, row label, shape, and text jointly identify responsibility; color alone is insufficient.

### Snapshot evolution

- ContextSnapshots are shown vertically, oldest to newest, within the selected/current ReviewRound.
- Each Snapshot displays its immutable id, evidence count, evidence-confidence value, Challenge state, and any bound advisory Artifact or Decision.
- The connector between adjacent Snapshots explains the real delta: evidence added/removed by id, confidence change, and Challenge-state change. A new Snapshot never appears as an overwrite of the previous one.
- Snapshot technical fields may be inspected, but ids and versions alone are not the primary explanation.

### Key moments and technical disclosure

- The default history is a compact, backend-derived list of key moments answering: who did what, what it changed, and which stage/record resulted.
- Related low-level Events may be grouped into one key moment, for example `RiskReviewSubmitted` plus `ContextSnapshotCreated`, or `RiskChallengeAnswered` plus its new `ContextSnapshotCreated`. Grouping is a presentation projection only and retains links to the exact source Event sequences.
- Raw Events, Graph edges, request fields, policy/test details, and other engineering diagnostics are hidden by default in progressively disclosed technical details. They must remain inspectable and must not be deleted from backend data.
- The default surface must not render the full raw Event list or full Graph edge list as the main content.

### G2-C acceptance

- `npm.cmd run build` succeeds without dependency changes.
- Against the accepted local backend, selecting every stage updates the five-part explanation and never sends a Command.
- The current stage, responsible role, next permitted action, Snapshot lineage, key moments, and final `pass`/`veto` are visibly consistent with `/state`, `/events`, and `/graph`.
- One same-round S1/S2 pair visibly explains real evidence, confidence, and Challenge deltas in the vertical direction.
- Key moments are materially fewer than raw Events and expose their source Event sequences; raw Events and Graph edges are collapsed by default.
- Existing real Command controls, reject/manual fallback, refresh persistence, SSE reconnect, and no-mock authority boundary continue to work.
- Browser warning/error count and page-level horizontal overflow are zero at 1920x1080 and 390x844. The narrow layout may use an internal horizontal scroller for the stage axis, but the page itself must not overflow.

## P0-2 G2-D 中文单屏流程矩阵

G2-D 是用户批准的前端中文化与单屏信息重构，继续使用现有 P0 控制／后端／前端任务，不创建替代任务。后端接口、身份类别、状态机、权限和持久化保持冻结；P0 Front 仍是 `lab/**` 唯一写入者。不得修改依赖、部署设置、`src/**` 或 `test/**`。

### 中文解释层

- 默认可见页面使用中文；除品牌名 `TAG` 外，不显示英文角色名、状态名、命令名、记录类型或字段名。
- 技术标识、后端枚举值和接口字段只能出现在默认折叠的“技术明细”内，并配有中文解释。
- 前端四个两字维度固定为：`输入`、`规则`、`模型`、`输出`。
- 映射仅用于展示：`输入` 对应业务人员及其材料，`规则` 对应确定性系统控制，`模型` 对应仅供参考的智能建议，`输出` 对应拥有最终决定权的风控人员。
- `输出` 不代表模型自动审批；页面必须明确说明最终通过或否决只由风控人员记录。
- 默认状态文案使用中文，例如“第 3 轮风险审查”“已完成决定”“待补证”“审查中”“通过”“否决”“重新审查”。

### 1920×1080 单屏结构

- 桌面基线为 1920×1080；默认折叠状态下，页面无横向或纵向页面级滚动，首屏完整解释当前问题。
- 核心是一个四行六列的流程矩阵。行是 `输入／规则／模型／输出`；列是 `发起／审查／补证／快照／建议／决定`。
- 每个矩阵位置用简短中文说明该维度在该阶段做什么；同时区分“已经发生”“当前阶段”“尚未发生／不参与”，不得把静态职责写成已发生事实。
- 选择任一阶段只改变前端解释视图，不发送 Command；选中阶段显示参与方、实际动作、使用材料、状态影响和下一步。
- 当前轮次、当前状态、当前责任方、最终决定权和下一项允许操作始终可见。
- 当前轮次的关键时刻与 Snapshot 变化使用紧凑摘要展示；详细协作记录、输入表单、原始 Event、Graph、接口字段和测试说明默认折叠，可在展开后使用内部滚动或页面滚动。
- 详细操作入口不得因压缩首屏而删除；真实 Command、拒绝提示、人工降级和刷新恢复行为保持可用。

### G2-D 验收

- `npm.cmd run build` 成功，`npm.cmd run lint` 为 0 error、0 warning；不新增或更新依赖。
- 实时页面默认可见文本的英文词检查只允许品牌 `TAG`；后端技术 ID 默认不可见。
- 1920×1080 默认折叠状态满足 `scrollWidth === clientWidth` 且 `scrollHeight <= clientHeight`，控制台 warning/error 为 0。
- 矩阵包含 4 个中文维度、6 个中文阶段和 24 个职责位置；所有阶段均可选择，选择前后后端版本与 Event 数量不变。
- 当前真实场景继续显示两份不可变判断快照、补证差异、5 个关键时刻和最终“通过”，但默认主界面不暴露英文技术词。
- 窄屏仍可读、可操作；窄屏允许纵向页面滚动和矩阵内部横向滚动。
- 后端 21 项测试继续通过，前端真实命令、人工降级、SSE／轮询恢复和无模拟成功边界不得回退。

## P0-2 G2-E 三阶段轨道审查台

G2-E 是用户批准的展示层重构，继续使用现有 P0 Control／Back／Front 任务，不创建新任务。P0 Front 仍是 `lab/**` 唯一写入者；后端 `src/**`、`test/**`、Command、Event、HTTP/SSE、SQLite、权限与 `pass`／`veto` 契约保持冻结。不得修改依赖、`.openai/hosting.json`、部署设置或生成新的权威业务状态。

### 三阶段与四泳道

- 默认核心画布固定为四条横向泳道，自上而下为 `输入／规则／模型／输出`；三个阶段自左向右为 `预审／正审／决定`，桌面视觉权重为 `60%／30%／10%`。
- 画布采用轨道节点与跨泳道连线，不退回 24 格职责表。蓝色表示材料／输入流转，紫色表示确定性规则约束，橙色表示仅供参考的模型分析，红色表示风控反馈与人类终决；颜色之外同时使用文字、形状和箭头方向。
- 预审容量最多三次，正审容量最多两轮，决定恰好一轮。阶段内实际出现一次时占满该阶段，出现两次时各占二分之一，预审出现三次时各占三分之一。
- 每次预审的接力关系为输入材料、模型识别／对照、规则检查、输出反馈；需要补充时用虚线反馈线返回下一次输入。正审每轮显示材料回应、模型倾向对照、规则／权限校验和风控复核；第一轮可结束，多一次复核时显示第二轮。决定阶段把最新 Snapshot、权限校验和模型建议汇聚到唯一的人类终决。
- 每个轮次内部必须采用交错节点，而不是四个泳道节点上下对齐成一根竖列：输入与模型位于轮次左侧，规则与输出位于轮次右侧，形成可见的 `输入↓模型↗规则↓输出` 折线路径。输出返回下一次输入的虚线必须逐轮绘制：预审第1次→第2次、预审第2次→第3次、正审第1轮→第2轮；不得用一条全局装饰线代替这些真实循环关系。
- 预审第3次到正审第1轮使用实线前进关系；正审第2轮到决定阶段使用汇聚关系。阶段背景、轮次边界和节点位置共同形成分区循环感，不能只依赖文字说明。
- 正审复杂结构必须明确包含 `第1轮／第2轮` 两个容量位置；决定只包含一个终决位置。未发生的位置不能被写成已经完成。

### 容量蓝图与真实状态

- 页面可用紧凑切换区分“当前案件”和“完整流程”。完整流程解释最大 `3＋2＋1` 结构，属于展示蓝图；当前案件只把后端真实记录标为已发生。
- 当前后端没有权威 `PrecheckAttempt` 或独立 `ReviewPass` 计数。前端不得从数组位置、模型信号或本地存储伪造预审次数；只能明确标注“流程能力，后端尚未记录该轮次”，或保持为未发生容量。
- 正审复核可从同一 ReviewRound 的 Challenge、Snapshot 与 Event 变化解释前后两次查看，但不得改写后端 `ReviewRound.number`，也不得把 `answerChallenge` 显示成新的 ReviewRound。
- Snapshot 只显示真实 `/state` 数据并保持不可修改谱系；同一次判断可复用最新 Snapshot。Decision 绑定最新 Snapshot，本次展示重构不得虚构“决定专属新 Snapshot”。
- 视觉切换、阶段聚焦和容量查看仅改变前端展示，不能发送 Command、改变 Thread／Project version 或增加 Event。

### 保留能力与验收

- 保留现有真实 Command 控件、共享 Thread、拒绝错误码、人工审查降级、SSE／轮询恢复、Snapshot 差异、关键时刻和折叠技术明细；不得以重构为由删除真实闭环。
- 默认可见文案保持中文，品牌 `TAG` 除外；技术字段继续默认折叠。
- 允许修改仅限 `lab/**`；不新增依赖，不提交、不推送、不部署。
- `npm.cmd run lint` 为 0 error、0 warning，`npm.cmd run build` 成功，根目录 `npm.cmd test` 继续 21／21。
- 1920×1080 默认视图无页面级横向或纵向滚动；390×844 无页面级横向溢出，轨道画布可使用内部横向滚动。
- 浏览器验收必须检查：完整流程存在预审三次、正审两轮、决定一轮；当前案件只标记真实记录；Snapshot 与实际状态一致；视图切换不改变后端版本或 Event 数；控制台 warning／error 为 0。

# P0-2F 冻结契约——高 ROI 判断接力闭环

## 检查点状态、目标与停止边界

P0-2F 是现有 P0 Control／Back／Front 任务链内的新检查点，不创建替代任务。它把 G2-E 仅用于说明的 `预审最多3次／正审最多2轮／决定1次` 变成后端可核验的本地合成流程，并交付六项能力：Snapshot 判断差异、正审判断包、送审就绪度与唯一下一动作、ROI 测量基础、下一最佳证据、模型—规则—人类分歧聚焦。

本检查点继续只服务一个 Project 和一个共享 Thread。理想路径是一次预审加一次正审；三次预审、两轮正审只是反复试探保护上限，不是每个案件必须走满的步骤。业务始终可以不经预审直接 `submitForRiskReview`。材料不足只能产生 `needs_input`、降低解释充分度或进入 `manual_review`，绝不能自动创建 `veto` 或阻止人工送审。

核心回归测试使用本地确定性、结构化、`advisoryOnly: true` 的合成 Artifact；同时允许通过独立后端适配器接入 GLM-5.3，比较多个提示／推理配置并完成初始效果测评。不得声称 OCR、风险预测或真实 ROI。评估只使用 30 个合成／脱敏案例。排除项继续包括：认证、真实客户数据、部署、依赖升级、A2A、MCP、RAG、SQLite 技术栈替换、通用多 Agent 平台和除 GLM-5.3 外的模型扩张。

出现下列任一情况立即停止并交由用户决定：需要改变风险人类唯一终决权；需要新增依赖或迁移到其他数据库；需要认证、外部业务数据或部署；需要把 Codex／Coding Plan 的内部凭据挪作产品密钥；30 例结果证明下一最佳证据无法由当前契约可靠表达；需要把单 Project／Thread 扩成机构级多租户产品。

## 文件所有权与串行 Gate

- P0 Control 独占 `P0-CONTRACT.md`、`STATUS.md`、`ROADMAP.md`、`HANDOFF.md`、`DECISIONS.md`，负责冻结契约与最终验收，不写产品运行时代码。
- P0 Back 独占 `src/**`、`test/**`、`scripts/**` 和根 `package.json`；不写 `lab/**` 或治理文档。
- P0 Front 独占 `lab/**`；只能在 G1 Back 接口稳定并经 Control 验收后开始，不得反向定义后端字段或伪造权威状态。
- 不安装依赖、不提交、不推送、不部署，不修改 `.openai/hosting.json`。

执行顺序固定为 G0 契约 → G1 Back → Control 独立验收 → G2 Front → G3 集成。G1 未通过时，P0 Front 保持待命。

## 权威记录与不可变性

### `ReviewProfile`

Project 持有一个版本化、只读的合成审查配置。P0-2F Demo 的 `profileVersion` 固定为 `p0-finance-v1`，包含四个必需材料维度：`identity`（主体身份）、`business_reality`（经营真实性）、`purpose`（资金用途）、`repayment`（还款来源）。这些维度只检查是否存在可定位 Evidence，不判断内容真假或是否应通过。

`Evidence` 新增可选 `criterionCode`。缺省为 `unclassified`；非法非空值返回 `EVIDENCE_CRITERION_INVALID`，零写入。旧命令保持兼容。Evidence 的 `pending／verified／unverifiable／conflicting` 状态与材料维度覆盖必须分开；“已覆盖”不等于“已核实”。

### `PrecheckAttempt`

`PrecheckAttempt` 是不可修改的预审尝试收据，字段至少为：`id`、`projectId`、`threadId`、`number`、`snapshotId`、`profileVersion`、`createdBy`、`creationEventSequence`。`number` 在同一 Thread 内从 1 递增，最大为 3。

业务人类使用 `createPrecheckAttempt` 和 `precheck` capability 冻结当前证据为新的 ContextSnapshot。第四次尝试返回 `PRECHECK_ATTEMPT_LIMIT_REACHED` 且零写入；这不会创建 Decision，也不会阻止 `submitForRiskReview`。新证据只能进入新 Snapshot，旧 Attempt／Snapshot／Artifact 不改写。

### `ReviewPass`

`ReviewPass` 是不可修改的正审查看机会收据，字段至少为：`id`、`projectId`、`threadId`、`reviewRoundId`、`number`、`snapshotId`、`trigger`、`creationEventSequence`。`trigger` 只能为 `initial_submission`、`challenge_answer` 或 `reconsideration`。

PrecheckAttempt、ReviewPass 和 ContextSnapshot 是权威审计收据，但不是权威判断结论。ReviewPass 表示风控人类需要介入的灰度 Gate；只有具备 `decide` capability 的风险人类创建的 Decision 才是通过／否决 Hard Gate。规则和模型不得升级为 Hard Gate，也不得把灰度提示转换成终态。

`submitForRiskReview` 或 `reconsiderRiskDecision` 创建 ReviewRound、正式审查 Snapshot 和第 1 个 ReviewPass；同一 ReviewRound 内第一次 `answerChallenge` 创建新 Snapshot 和第 2 个 ReviewPass。不得产生第 3 个 ReviewPass；在第 2 个 ReviewPass 上不得再发起会要求新 Snapshot 的 Challenge，返回 `FORMAL_REVIEW_PASS_LIMIT_REACHED` 且零写入。系统仍不得自动否决，风险人类可作出 Decision，或保持／进入人工处理状态。

P0-2F 在这一点上明确替代 P0-B1 的无上限重开行为：Challenge 仍可在第 1 个 ReviewPass 内 resolve／reopen；一旦第 2 个 ReviewPass 已创建，新的或重开的 Challenge 都被拒绝。原有“可重复重开”回归测试必须更新为“第 1 轮可重开、第 2 轮稳定拒绝且零写入”，不能保留相互冲突的旧断言。

### `ContextSnapshot`

ContextSnapshot 继续不可修改，并新增：

- `phase`: `precheck` 或 `formal_review`；
- `previousSnapshotId`: 同一 Thread 上前一份 Snapshot，没有则为 `null`；
- `precheckAttemptId` 或 `reviewPassId`，且只能有一个有效归属；正式 Snapshot 同时保留 `reviewRoundId`；
- `profileVersion`；
- `criterionCoverage[]`: `criterionCode`、中文标签、`required`、`status`（`covered／missing`）、精确 `evidenceIds`；
- `readinessReceipt`: `outcome`（`ready／needs_input／manual_review`）与稳定 `reasonCodes[]`。

`readinessReceipt` 只说明材料解释是否足以进入下一人工环节，不是审批概率、信用评分或通过建议。

### 结构化 `Artifact`

`invokeDeterministicAdvisory` 兼容正式审查 Snapshot，并扩展到预审 Snapshot。请求必须用 `snapshotId`，并按 Snapshot 阶段提供匹配的 `precheckAttemptId` 或 `reviewRoundId`；错配返回 `SNAPSHOT_PHASE_INVALID` 且零写入。

Artifact 继续不可修改且必须满足 `advisoryOnly: true`、Project scope、精确 Citation 和 Agent 身份约束，并新增：`phase`、`profileVersion`、`analysisVersion`、`judgmentClaims[]`、`evidenceGaps[]`、`nextBestEvidence`。每个肯定性或风险性 `judgmentClaim` 必须引用当前 Snapshot 内 Evidence；无证据时只能表达 `unknown`／材料缺口，不能生成事实性结论。`nextBestEvidence` 最多一个，必须来自当前 Snapshot 的首个必需缺口，并说明它只会改善解释覆盖，不保证通过。

## GLM-5.3 实验接入与测评预算

GLM-5.3 只作为可路由 Agent 提供方，不是控制服务、规则或人类主体。后端适配器使用 Z.AI General API 的 `/chat/completions`，模型 ID 为 `glm-5.3`；不得使用 Coding Plan 专用 endpoint。经用户授权，凭据按 `TAG_GLM_API_KEY` 优先、现有环境 `ZAI_API_KEY` 其次读取，不得返回前端、写入源码／数据库／Event／日志或错误。`TAG_GLM_BASE_URL` 可配置但默认固定为官方 General API；非 HTTPS 或非显式允许的主机必须拒绝。

确定性提供方与 GLM-5.3 必须输出同一 Artifact schema。GLM 请求使用 `response_format: { type: "json_object" }`、`thinking.type: enabled`，推理强度只允许 `low／high`；不在本业务场景使用 `max`。响应必须经过本地 schema、枚举、Citation、Project scope 和 Snapshot 绑定校验后才能写入 Artifact。超时、限流、无密钥、非 JSON、字段越界或 Citation 无效分别明确映射到 `ADVISORY_UNAVAILABLE`、`ADVISORY_RATE_LIMITED` 或 `ADVISORY_INVALID_OUTPUT`，零 Artifact、零 Decision，不允许静默切换成确定性“成功”。

真实调用采用两段式受控 Run：先持久化 `AdvisoryRunRequested` 和 owner／fencing，再在事务外调用模型，最后用当前 owner、fencing、原 `expectedVersion` 和验证后的输出提交 `AdvisoryArtifactCreated`。旧 owner、重复回调或版本已变化不得完成新 attempt。日志只保留 provider、model、promptVersion、requestId、token usage、耗时、结果码和脱敏 hash，不保留密钥、推理内容或完整业务材料。

两段式接口名称冻结如下：

- 公共 `requestModelAdvisory`：human／`invoke`，payload 为 `threadId`、`snapshotId`、匹配的 `precheckAttemptId` 或 `reviewRoundId`、`provider: "glm53"`、`promptVersion`、`reasoningEffort`、`citations`、`agentId`；成功创建不可修改 `AdvisoryRun`，公共响应只返回 `runId`、`attempt`、`fencingToken` 与可公开状态，Event 为 `AdvisoryRunRequested`。ownerToken 只生成并保存在后端私有运行记录中，HTTP 响应、Event、Graph 和日志均不得暴露。
- 内部 `completeModelAdvisory`：只能由持有当前 ownerToken／fencingToken 的后端 worker 调用，不暴露给 Front；成功时创建结构化 Artifact，Event 为 `AdvisoryArtifactCreated`、`AdvisoryRunSucceeded`。
- 内部 `failModelAdvisory`：同一 fencing 约束，记录稳定失败码，Event 为 `AdvisoryRunFailed`；不创建 Artifact。
- 现有 `invokeDeterministicAdvisory` 保留用于可重复基线，并输出同一 Artifact schema；它不伪装成 GLM-5.3。

`AdvisoryRun` 至少包含：`id`、`projectId`、`threadId`、`snapshotId`、阶段归属、`provider`、`model`、`promptVersion`、`reasoningEffort`、`status`（`reserved／running／succeeded／failed`）、`attempt`、`fencingToken`、`expectedCompletionVersion`、脱敏请求 hash、可选 token／耗时与稳定失败码。ownerToken 只能保存在后端私有运行记录，不能进入 `/state`、`/judgment`、Event、Graph 或日志。

初始测评分两段，总调用上限 54 次：

1. 候选筛选：6 个代表性合成案例 × 2 个提示版本（`evidence_first_v1`、`disagreement_first_v1`）× 2 个推理强度（`low`、`high`），最多 24 次。
2. 入围验证：选出的一个组合运行 30 个合成案例，最多 30 次。

排序指标依次为：schema 有效率、Citation 精确率、关键材料漏检率、错误就绪率、下一最佳证据命中率、重复输出稳定性、token／耗时。任何组合若产生无 Citation 的事实性 claim、自动 pass／veto 或跨 Project 引用，立即淘汰。若环境没有 `TAG_GLM_API_KEY` 或 `ZAI_API_KEY`，必须完成适配器与离线契约测试，但 G1M 标记“未进行真实模型验证”，不得假装已接通。

## 派生判断接口

新增只读接口：

```text
GET /api/projects/:projectId/judgment?threadId=:threadId
```

返回值必须由后端权威记录和 durable Event 派生，前端不得二次猜测：

```text
{
  projectId,
  threadId,
  phase,
  limits: {
    precheck: { used, max: 3, remaining },
    formalReview: { used, max: 2, remaining }
  },
  readiness,
  nextAction,
  snapshotDiffs,
  reviewPacket,
  disagreements,
  metrics,
  modelEvaluation,
  generatedThroughEventSequence
}
```

### Snapshot 判断差异

`snapshotDiffs[]` 逐份比较 `previousSnapshotId → snapshotId`，至少返回新增 Evidence、材料维度覆盖变化、Challenge 状态变化、解释充分度变化和绑定 Artifact／Decision 的变化。历史 Snapshot 不允许出现被删除或原地修改的 Evidence；发现引用断裂必须失败关闭，不能用空差异掩盖。

### 送审就绪度与唯一下一动作

`readiness` 使用 `ready／needs_input／manual_review`，包含稳定 `reasonCodes[]` 和逐维度覆盖，不返回通过概率。`nextAction` 必须始终为单个对象，字段至少为 `code`、中文 `label`、`ownerClass`、可选 `command`、`reasonCode`、`targetId`；不得返回多个“任选其一”。

优先级冻结为：等待补证回答 → 等待风控确认补证 → 等待当前 Snapshot 的模型建议 → 补充首个必需材料 → 创建下一次预审 → 业务送审／带缺口送人工审查 → 风控查看判断包并作出人类决定 → 已结束。达到 3 次预审或 2 轮正审只把下一步转为人工处理，不映射到 `veto`。

该优先级只在动作真实可执行时适用，不能返回一个必然失败的 Command。尚无 Snapshot 或当前 Snapshot 没有任何可引用 Evidence 时先返回 `ADD_EVIDENCE`，不能要求生成无 Citation 的建议；预审 Snapshot 有可引用材料但尚无绑定 Artifact 时返回 `REQUEST_ADVISORY`；Artifact 指出缺口时返回首个 `ADD_EVIDENCE`，新增材料尚未进入 Snapshot 时返回下一次 `CREATE_PRECHECK`，若已达 3 次则返回 `SUBMIT_RISK_REVIEW`；首轮预审已 `ready` 时直接返回 `SUBMIT_RISK_REVIEW`，不得为了用满额度要求第二次预审。正审阶段以 Challenge 回答／确认优先；当前 Snapshot 能调用建议时返回 `REQUEST_ADVISORY`，建议已存在或 advisory 明确不可用时返回 `RISK_DECISION`，其中文 label 必须提示先看判断包。正式审查中的缺口只能由风险人类选择 Challenge，不得由 `nextAction` 把 direct submit 自动退回业务。Decision 存在且没有更新的 ReviewRound 时才返回 `ENDED`。

### 正审判断包

`reviewPacket` 仅在存在 ReviewRound 时返回，至少包含：最新 ReviewPass 与 Snapshot、最近一次预审摘要、Snapshot 差异、材料维度覆盖、未解决 Challenge、最新结构化 Artifact、唯一下一动作、分歧焦点、全部精确 Citations、`generatedThroughEventSequence` 以及“仅风险人类可通过／否决”的中文权威声明。它是可重建投影，不是新的权威审批记录。

### 模型—规则—人类分歧

`disagreements[]` 按材料维度返回 `rulePosition`（`covered／missing`）、`modelPosition`（`support／uncertain／unknown`）、`humanPosition`（`challenge／pass／veto／not_recorded`）、`status`（`aligned／attention_required／unreviewed`）和 Citations。规则覆盖、模型倾向和人类决定必须分栏，禁止把其中任一方复制成另一方的结论。

## ROI 测量基础

Durable HTTP Event 必须暴露持久化 `occurredAt`；该时间来源于事务内已持久化的命令／outbox 时间，不参与旧 Event hash 重算，重启后保持稳定。内存 Event 的顺序仍由 `sequence` 决定。

`metrics` 至少派生：`precheckAttemptCount`、`formalReviewPassCount`、`challengeCount`、`supplementCount`、`straightThrough1Plus1`、`manualReviewRequired`、`falseReadyProxy`、`nextBestEvidenceFollowed`、`timeToSubmissionMs`、`formalReviewDurationMs`、`totalDecisionDurationMs`。没有足够时间点时返回 `null`，不得补造时长。

`falseReadyProxy` 只表示后端曾给出 `ready` 后仍出现 mandatory Challenge；它不是模型错误率或真实业务坏账指标。`nextBestEvidenceFollowed` 只在后续 Snapshot 覆盖了推荐维度时为 true。P0-2F 不得把 30 个合成案例的结果宣传为生产 ROI。

## Command、Event、错误码与图谱增量

新增 Command：

| Command | Actor/capability | 成功记录 | 成功 Event |
| --- | --- | --- | --- |
| `createPrecheckAttempt` | business human / `precheck` | PrecheckAttempt + precheck ContextSnapshot | `PrecheckAttemptCreated`、`ContextSnapshotCreated` |
| `requestModelAdvisory` | authorized human / `invoke` | AdvisoryRun reservation | `AdvisoryRunRequested` |

现有 Command 增量：`addEvidence`／`answerChallenge` 接受可选 `criterionCode`；`submitForRiskReview`、`answerChallenge`、`reconsiderRiskDecision` 创建 ReviewPass；`invokeDeterministicAdvisory` 返回结构化 Artifact。所有 mutation 继续要求 project scope、human actor/capability、idempotency key、canonical request hash 和 expectedVersion；旧 owner fencing、跨项目和零写入失败行为不得回退。

新增 Event：`PrecheckAttemptCreated`、`ReviewPassCreated`、`AdvisoryRunRequested`、`AdvisoryRunSucceeded`、`AdvisoryRunFailed`。`ContextSnapshotCreated` payload 新增 `phase`、归属 ID 和 `previousSnapshotId`；`AdvisoryArtifactCreated` payload 新增 `phase`、`analysisVersion` 与推荐材料维度。Graph 新增 `precheck_attempt`、`review_pass`、`advisory_run` 节点及其 Snapshot／Thread／ReviewRound 边，仍返回 `layout: null`，且不得包含 ownerToken。

新增稳定错误码：`PRECHECK_ATTEMPT_LIMIT_REACHED`、`FORMAL_REVIEW_PASS_LIMIT_REACHED`、`EVIDENCE_CRITERION_INVALID`、`SNAPSHOT_PHASE_INVALID`。HTTP 状态为 409、409、400、409。跨项目引用继续返回不泄漏外部对象信息的 not-found／invalid 错误。

模型增量错误码：`ADVISORY_RATE_LIMITED`、`ADVISORY_INVALID_OUTPUT`、`ADVISORY_RUN_FENCE_CONFLICT`，HTTP 状态分别为 503、422、409；现有 `ADVISORY_UNAVAILABLE` 保留。模型调用失败不得回退成前端本地成功。

## G1 Back 验收

P0 Back 必须提交代码、测试和可复现证据。Control 独立检查并运行：

```text
npm.cmd test
npm.cmd run eval:p0-2f
npm.cmd run eval:glm53
```

G1 必须证明：

1. 业务可零次预审直接送审，缺材料不会自动否决；理想 1＋1、最多 3＋2 均有测试。
2. 第 4 次预审和会产生第 3 个 ReviewPass 的操作稳定拒绝且零写入；风险 `decide` 权限与 pass／veto 唯一终决权不变。
3. Snapshot／Attempt／Pass／Artifact／Decision 历史不可修改；restart、replay、projection rebuild 后结果相同。
4. 判断差异、判断包、唯一下一动作、下一最佳证据和三方分歧都来自权威记录，引用严格 Project scoped。
5. 同 key 重试、变体冲突、过期版本、跨项目、错误 Citation、错误 Snapshot 阶段和 stale fencing 均有零写入证据。
6. Event `occurredAt` 重启稳定；指标缺失时返回 null，不伪造耗时。
7. 30 个合成案例覆盖：无材料、单缺口、多缺口、1＋1、3＋2、direct submit、mandatory Challenge、Artifact unavailable、pass、veto、reconsider、跨项目和重试。确定性期望要求：30／30 唯一下一动作正确；所有存在唯一缺口的案例下一最佳证据命中；`falseReadyProxy` 与 mandatory Challenge 一致；判断包不缺失当前 Snapshot／Citation／人类权威声明。输出只能称为合成基线。
8. 原 21 项后端回归意图保持覆盖且测试总数不得下降；其中“无限重开 Challenge”旧断言按本节明确替换为两轮上限测试。其余旧测试必须继续通过。不新增依赖，不修改 `lab/**` 或治理文档。
9. G1M 证明 GLM-5.3 请求、结构校验、两段式 Run、超时／限流／无密钥、版本竞争、fencing 和零写入失败边界；若真实密钥可用，按 24＋30 上限输出候选比较和入围结果。真实调用不可用时，G1A 可验收但 G1M 必须如实保持未验证，P0 Front 只能显示“模型未连接／人工审查”。

## G2 Front 验收

仅在 Control 接受 G1 后授权。P0 Front 只能使用 `/state`、`/judgment`、`/events`、`/graph` 和冻结 Commands，构建两个相连但角色聚焦的本地视图：

- 业务预审台：显示 1～3 次真实 Attempt、材料维度覆盖、Snapshot 差异、唯一下一动作和下一最佳证据；强调可随时送审。
- 风控快审台：显示 1～2 个真实 ReviewPass、正审判断包、模型／规则／人类分歧、精确材料定位和人工 pass／veto。

默认页面继续中文优先，技术 Event／Graph／字段折叠；不得在浏览器计算权威轮次、就绪度、推荐或指标，不得伪造真实模型。1920×1080 首屏应让非技术人员看懂“现在在哪、谁接棒、依据变化、唯一下一步”，无页面级横向或纵向滚动；390×844 无页面级横向溢出。必须验证空态、1＋1、3＋2、Challenge 补证、advisory unavailable、pass、veto、刷新、SSE 重连、控制台错误和视图切换零写入。

## G3 集成与完成定义

完成必须同时满足：G0 文档一致；G1 Back 全部自动化 Gate；G2 Front lint/build 与真实浏览器 Gate；Control 独立复跑根测试、30 例评估、后端启动／HTTP／SSE、前端 build 和端到端场景；`STATUS.md` 只记录已验证事实，失败项和未实现项明确保留。用户仍拥有最终产品验收权。
