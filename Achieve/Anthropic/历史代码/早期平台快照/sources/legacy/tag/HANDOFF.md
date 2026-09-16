# TAG backend handoff

## 1. Product objective

TAG preserves collaboration context across humans and agents. It is not another model interface and not a generic agent harness.

The active checkpoint is P0-2F. Its frozen contract is the `P0-2F 冻结契约——高 ROI 判断接力闭环` section of `P0-CONTRACT.md`. Corrected G1A and G1M-A are accepted: the backend now records precheck／review receipts, derives `/judgment`, and routes GLM-5.3 through the real General API behind durable fencing and the advisory-only schema. Control independently passed the current `87/87` suite. G1M-B remains open because the real 24-call candidate run on corpus hash `17bf6eded4dfc844820083f627096a30027ce9c1e2455f3e87cbf705a5680a96` produced 9 successes and 15 `ADVISORY_RATE_LIMITED` failures, so no prompt／effort combination entered the 30-case finalist stage. The existing P0 Front remains gated in the same task chain; no replacement task was created.

真实测评的可复核聚合结论：四个组合的 Citation precision、成功案例 NBE hit、false-ready 与 authority boundary 均保持合格，但 schema validity 只有 33.3%–50%，critical-material miss rate 为 79.17%；HTTP／Event／Graph case proof 为 24/24，SQLite 重启重放零新增且零二次模型调用。下一次真实运行必须由用户重新授权预算，并采用显式 pacing；否则 GLM-5.3 只能显示为“已接通但实验未入围”，不能成为默认建议提供方。

为下一次授权运行准备的新语料 hash 为 `d4c56a8bb594c99b76d01d5535ef591afe9ea8435012e2e67275ff820b740a07`，它把四维支持、冲突与来源不可核验写成明确、完全虚构的金融预审证据；CLI 默认 pacing 为 `5000ms`、零自动重试，并会清理自己创建的临时 SQLite。该版本只通过了离线 Gate，尚无真实模型质量数据，不能与旧 24 次结果混写。

For the active P0-B1 checkpoint, the frozen business/risk review behavior is in `P0-CONTRACT.md`. That contract overrides older broad P0 wording where they conflict. In particular, only an authorized risk human can create the final `pass` or `veto`; `communicate` creates a Challenge and evidence loop, not a decision.

P0-B1 remains the accepted deterministic in-memory baseline. Its original top-level `lab/app.js`, `lab/index.html`, and `lab/styles.css` are preserved as a backend-disconnected simulation; they are not the integrated Front.

P0-2 is frozen in `P0-CONTRACT.md`. Control's local G0-G3 Gates passed on 2026-08-25: backend tests were 21/21, the integrated Sites build passed, and real browser checks covered the normal loop, `pass`, `veto`, reconsideration, same-round Snapshot replacement rules, refresh, SSE reconnect, rejected advisory/manual fallback, desktop, and narrow layouts. Back owns the accepted persistence and local HTTP/SSE interface; Front remains under `lab/**` and is the sole Sites project owner. Final product acceptance remains with the user and no deployment is authorized.

The user-approved G2-C presentation refactor also passed Control's local checks. The primary Front view uses four backend-derived horizontal actor lanes (`Business`, `System`, `Intelligence`, `Risk`); selecting any of six stages changes only a five-part explanation and never sends a Command. Current-round immutable Snapshots are shown vertically with evidence, confidence, and Challenge deltas. The current 26 raw Events are summarized into 5 traceable key moments, while raw Event/Graph diagnostics remain collapsed. This is a Front projection only and does not define or mutate backend state.

The later G2-D presentation layer replaces those technical role labels on the default surface with the Chinese two-character dimensions `输入／规则／模型／输出`. It renders a 4×6 responsibility matrix across `发起／审查／补证／快照／建议／决定`, fits the default collapsed experience into 1920×1080 without page scrolling, and keeps operations and technical diagnostics expandable. This mapping is presentation only: `输出` still means an authorized risk human records the final result, never model automation. Control accepted the local build, zero-warning lint, six-stage zero-write selection, desktop/narrow browser checks, and unchanged backend tests.

The user-approved G2-E replaces the G2-D flat matrix as the default presentation. It keeps the four horizontal Chinese lanes but groups work into `预审／正审／决定` at `60／30／10`, with a visible maximum `3＋2＋1` structure. Every attempt/round is a staggered `输入↓模型↗规则↓输出` relay cluster; three distinct dashed returns show the bounded precheck and formal-review loops, and solid transitions converge on the authorized human decision. The separate current-case view must never infer authoritative precheck counts or fake Snapshots; it uses only backend records. Control accepted lint, build, 21/21 backend tests, desktop/narrow layout, zero browser errors, and zero-write view switching. G2-E changes presentation only and does not add a backend precheck/pass-budget state machine.

The accepted local runtime is `npm.cmd run bootstrap` followed by `npm.cmd start`; it defaults to `http://127.0.0.1:4174`, the synthetic Project is `demo-project`, and the database lives outside source under the user's local application data unless `TAG_DB_PATH` overrides it. A cross-port Front must be explicitly listed in `TAG_CORS_ORIGINS`; any other supplied `Origin` is rejected before mutation. The accepted reads, Command envelope, SSE behavior, and stable errors are defined in `P0-CONTRACT.md`.

The integrated editable Front is `lab/site/**`, fixed to local preview `http://127.0.0.1:5173` and connected to the backend at `http://127.0.0.1:4174`. It has no authoritative browser mock fallback and does not hold secrets. Preserve `lab/**` for the existing P0 Front writer. The preview is synthetic/local only; its current dependency audit reports 12 high and 1 low finding, so production deployment remains blocked pending an explicitly authorized dependency/security Gate.

The proving scenario is two humans working in one Project:

1. Human A adds evidence and asks the shared project agent to analyze it.
2. The agent reads only project-scoped context and returns an immutable advisory Artifact with Citations.
3. Human B sees the same Thread, replies or quotes the earlier work, adds evidence, and continues.
4. A deterministic policy evaluates readiness and open Challenges.
5. Only a human Membership with decision capability can create a Decision.
6. Every change emits a durable event used by audit, replay, and Graph projection.

## 2. Canonical backend model

### Authority-bearing records

- `Project`: collaboration and data-isolation boundary.
- `Principal`: authenticated or synthetic human identity.
- `Membership`: a Principal's project-scoped capabilities.
- `Goal`: immutable revisioned objective and success criteria.
- `Evidence`: immutable source record with hash and precise locator.
- `Fact`: a claim with evidence status and confidence, not a Decision.
- `Decision`: a consequential human action tied to exact versions and evidence.

### Advisory work records

- `AgentIdentity`: routable service identity and allowed scopes.
- `Thread` and `Message`: mutually visible project conversation with reply/quote links.
- `Task` and `Run`: requested work and one execution attempt.
- `ToolResult`: untrusted tool output, not automatically Evidence.
- `Challenge`: explicit missing, conflicting, or unverifiable information.
- `Artifact`: immutable agent deliverable with Citations.

### Control and derived records

- `PolicyService`: deterministic versioned transition and hard-gate evaluation.
- `Event`: append-only domain history with actor class and affected aggregate IDs.
- `IdempotencyRecord`: binds principal/project/action/key to a request hash and stored result.
- `OutboxRecord`: transactionally committed delivery work.
- `GraphProjection`: stable semantic nodes and edges rebuilt from Events.

## 3. State boundaries

Do not replace these with one generic status:

- protocol: queued/running/completed/failed/canceled;
- work: open/in_progress/needs_input/awaiting_human/closed;
- evidence: pending/verified/unverifiable/conflicting;
- fact: proposed/supported/challenged/superseded;
- confidence: deterministic evidence confidence and separate model confidence;
- decision: proceed/proceed_with_conditions/stop;
- hard gate: pass/block/manual_review.

Reconsideration creates a new Goal revision linked by `supersedesGoalId`. The old Goal, Artifacts, Facts, and Decision remain immutable.

## 4. Command path

Every mutation follows one controller-owned path:

```text
request
→ derive principal/project scope
→ validate command schema
→ resolve Membership or AgentIdentity
→ check idempotency key and request hash
→ check expected aggregate version
→ evaluate deterministic policy
→ append state + event + idempotency + outbox atomically
→ return stored result
→ update Chat and Graph projections
→ publish project-scoped SSE sequence
```

Adapters and runtimes never write the database directly.

## 5. Persistence target

P0 multi-human persistence should use one SQLite database with WAL. A command transaction writes:

- aggregate state/version;
- append-only Event;
- IdempotencyRecord;
- OutboxRecord;
- synchronous critical projections when required.

Startup verifies schema version, event sequence/hash continuity, and projection checkpoint. Corruption fails closed. Rebuild replays Events into empty projection tables without changing canonical records.

## 6. API direction

The future minimal surface is project-scoped:

- create/read shared Threads;
- append human Messages and Reply/Quote links;
- add immutable Evidence and Citations;
- invoke/cancel a project Agent Run;
- read Runs, Artifacts, Facts, and Challenges;
- create a human-only Decision;
- read Graph snapshots;
- subscribe to project SSE with `Last-Event-ID` replay and explicit reset.

All POST requests require an idempotency key. Versioned mutations require `expectedVersion`. Cross-project lookup returns no resource information.

## 7. P0/P1 truth boundary

P0 may use synthetic Principals and a deterministic runtime to prove mechanics. It cannot claim authenticated multi-human authority, tenant security, real model intelligence, production audit integrity, or organizational approval.

Before real people, real projects, external agents, or sensitive evidence are admitted, P1 requires authentication, server-derived Membership, object-level authorization, project-isolated SSE, attachment quarantine, secret redaction, revocation, and tamper-resistant audit controls.

P0-2F uses deterministic structured Artifacts for repeatable regression and permits GLM-5.3 only through a backend adapter with local validation and 30 synthetic／de-identified evaluation cases. Its `readiness`, `falseReadyProxy`, time fields and next-best-evidence follow-through are workflow measurements, not approval probability, validated production-model quality, operational savings or production ROI. Precheck／Review receipts are auditable process facts; only the authorized risk human's Decision is an authoritative outcome.

## 8. Explicitly excluded source material

- all source frontends, CSS, images, slides, CG, Unity, and static demos;
- Stars' fixed leader/business/risk ontology;
- Stars' JSON snapshot/JSONL persistence implementation;
- Lease's financing-specific scores, grades, rules, customer fixtures, and materials;
- Race's claimed target metrics as achieved outcomes;
- real customer data, uploaded files, tokens, credentials, and runtime databases.
