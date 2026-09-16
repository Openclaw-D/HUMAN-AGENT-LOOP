# TAG status

## Current checkpoint

P0-B1 and P0-2 G0-G3 remain accepted local baselines. P0-2F is the active checkpoint: G0、corrected G1A 与 G1M-A 应用接线已经通过 Control 验收；G1M-B 的真实候选测评因供应商限流与质量线未通过而停止，未选择默认 GLM-5.3 配置。G2 Front 与 G3 继续保持 Gate，等待用户决定是否授权新的节流测评预算或接受“模型实验未入围”的降级展示。P0-2F 继续保留 risk-human-only `pass`／`veto`，最终产品验收仍属于用户。

## Implemented now

- Backend-only project instructions and handoff.
- Dependency-free coordination core.
- Human/agent authority separation.
- Hash-linked in-memory event log.
- Project/action/request-bound idempotency.
- Optimistic Thread version checks.
- Run reservation, lease takeover, terminal replay, and redacted metadata contract.
- Deterministic agent output with Citations.
- Human-only Decision policy.
- Reconsideration as an immutable new Goal revision.
- Layout-independent Graph projection.
- Focused Node tests.
- GLM-5.3 General API adapter、持久化 AdvisoryRun、两段式完成／失败、lease takeover 与 fencing。
- `requestModelAdvisory` 的 HTTP／SSE／Graph／`/judgment` 公开链路，以及原始 requestId、ownerToken、Evidence 正文和推理内容的公开面脱敏。
- 6×2×2 候选与 30 案入围评测器；离线 54 路编排、聚合评分、重启重放和调用预算 Gate 已自动化。
- P0-B1 ReviewRound, immutable ContextSnapshot, Challenge lifecycle, cited advisory Artifact, and risk-only immutable `pass`/`veto` Decision records.
- Deep-canonical request hashing, scoped idempotency, capability and expected-version checks with zero-side-effect failure behavior, and fenced run takeover completion.
- Original zero-dependency `lab/` Workflow Lab, preserved as an explicitly simulated/local and backend-disconnected artifact.
- P0-2 SQLite/WAL command journal with atomic Events, idempotency results, outbox rows, restart recovery, event-chain verification, and projection checksum rebuild.
- Project-scoped local HTTP reads/Commands and SSE replay/reset with configured-origin CORS rejection before mutation.
- Durable shared Thread Messages, review records, ContextSnapshots, Challenges, advisory Artifacts, risk Decisions, and coordinate-free semantic Graph projection.
- Cross-instance optimistic concurrency, immutable Decision response consistency, advisory-unavailable human fallback, and corruption fail-closed behavior.
- Sites-compatible `lab/site/**` Front connected to `/state`, `/graph`, `/events`, Commands, and SSE, with backend-driven actions, shared-role records, immutable Snapshot comparison, Event timeline, Graph, explicit Command results, polling/reconnect state, and backend-unavailable state.
- P0-2F G1A durable PrecheckAttempt／ReviewPass records, phase-linked ContextSnapshots, Snapshot diffs, readiness, one executable next action, formal-review packet, criterion-scoped disagreements, Next Best Evidence follow-through and workflow metrics.
- A deterministic 30-case evaluator with real paths for no evidence, single／multiple gaps, ideal 1＋1, bounded 3＋2, direct submission, mandatory Challenge, advisory unavailable, pass, veto, reconsideration, cross-project rejection and retry conflicts.

## Acceptance evidence

- P0-2F GLM connectivity preflight: Control sent one synthetic, no-business-data request to the official Z.AI General API using `glm-5.3`, JSON mode, enabled thinking and `reasoning_effort=low`. It returned HTTP 200 in about 1.93 seconds with valid structured output and 138 total tokens. This proves only provider reachability; G1M application integration, fencing, validation and 54-call evaluation remain unimplemented and unaccepted.
- P0-2F G1A first-submission evidence: Control independently ran `npm.cmd test` with 23 passed and 0 failed, syntax checks with 0 failures, and `npm.cmd run eval:p0-2f`, which reported 30/30. G1A was nevertheless rejected because direct semantic probes proved that unknown Threads returned a normal projection, an empty case chose the wrong next action, precheck could be created after formal review began, answered Challenge skipped risk confirmation, a Decision could bind a stale Snapshot, reconsideration remained hidden behind the old ended Decision, duration metrics stayed null, and the 30-case evaluator repeated one scenario instead of the frozen matrix. These are failure evidence, not accepted capability.
- P0-2F G1A final acceptance: after corrections, Control independently ran `npm.cmd test` with 25 passed and 0 failed, `npm.cmd run eval:p0-2f` with 30／30 named multi-path scenarios, and all changed backend/test/evaluator syntax checks with 0 failures. Separate probes verified the ideal 1＋1 metrics, NBE follow-through, ready-then-Challenge proxy, stale-Snapshot rejection, reconsideration scoping, direct submit, 3＋2 limits, unknown Thread 404, new HTTP errors at 409／400／409／409, restart-stable `/judgment` and `occurredAt`, and stable projection rebuild checksum. This accepts G1A only; it does not accept GLM-5.3 application integration or the Front.
- P0-2F G1M-A acceptance: Control independently verified the official General API connectivity preflight, durable request／complete／fail lifecycle, cross-instance lease takeover and stale fencing, HTTP error mapping, real SSE success／failure ordering, Graph and `/judgment` binding, restart replay and public-data redaction. The current complete regression is `87/87`; no Agent or model path created a Decision.
- P0-2F G1M-B real candidate result: `npm.cmd run eval:glm53 -- --execute` made exactly 24 synthetic calls against corpus hash `17bf6eded4dfc844820083f627096a30027ce9c1e2455f3e87cbf705a5680a96` and stopped before the 30-case finalist stage. Nine calls succeeded and 15 returned `ADVISORY_RATE_LIMITED`; all four prompt／effort combinations therefore failed schema availability and no configuration was eligible. After correcting the reporting denominator without new model calls, the successful outputs kept Citation precision at 100%, NBE hit rate at 100% for eligible successful cases, false-ready at 0 and authority violations at 0, but aggregate schema validity was only 33.3%–50% and aggregate critical-material miss rate was 79.17%. All 24 cases passed the HTTP／Event／Graph binding Gate, and restart replay added zero Event、Artifact、Decision or model call. This proves application connectivity, not accepted model quality or production readiness.
- P0-2F G1M-B offline preparation after the stopped run: the synthetic corpus now uses explicit fictional identity、经营、用途、还款、冲突与不可核验 facts, producing new corpus hash `d4c56a8bb594c99b76d01d5535ef591afe9ea8435012e2e67275ff820b740a07`; CLI real execution defaults to `5000ms` pacing with zero automatic retry; owned evaluation SQLite directories are safely removed after success、failure、replay or mid-matrix error while caller-owned paths are preserved. These changes passed `39/39` focused evaluator tests and `87/87` total tests, but the new corpus has not received any real model call and has no quality result.

- G0: `P0-CONTRACT.md` freezes commands, states, policy outputs, event names, schemas, errors, ownership, and test criteria.
- G1: independent `npm.cmd test`: 7 passed, 0 failed.
- G2: independent Lab exercise completed 10 simulated events; S1/S2 remained separately visible; selected nodes exposed Command/State/Policy/Event/Test; an agent final-decision attempt was rejected without an event; no console warnings/errors or page-level horizontal overflow were found.
- G3: the Lab uses accepted vocabulary but remains a non-authoritative local simulation, not a live backend integration.
- P0-2 G0: `P0-CONTRACT.md` freezes persistence, HTTP/SSE, Front integration, scenario/degradation, ownership, and stop conditions.
- P0-2 G1: Control independently ran `npm.cmd test` with 21 passed and 0 failed; all backend/test/script syntax checks passed. Separate smoke checks verified SQLite restart, two-instance same-version fencing by `VERSION_CONFLICT`, configured-origin CORS including zero-write rejection, Decision byte consistency, advisory identity/authority, `/health`, `/state`, `/graph`, and `/events`.
- P0-2 G2: Control independently ran `npm.cmd run build` successfully and drove the real UI through Message, Evidence, submit, communicate, answer plus new Snapshot, resolve, advisory, `pass`, `veto`, and reconsideration. Refresh preserved 26 unique Events with no duplicates. At 1920x1080 and 390x844, page-level horizontal overflow was 0 and browser warning/error logs were empty.
- P0-2 degradation evidence: stopping the backend produced an explicit unavailable/reconnecting state without local success. After recovery, SSE reconnected. With advisory disabled, `invokeDeterministicAdvisory` visibly returned `ADVISORY_UNAVAILABLE`, wrote no Event or Artifact, switched the Front to manual review, and an authorized risk human recorded a real backend Decision.
- P0-2 G3: Control reran 21/21 backend tests, 13 backend/test/script syntax checks, health/read checks, the Sites build, refresh/reconnect checks, and desktop/narrow browser acceptance before updating governance documents.
- P0-2 G2-C: Control independently rebuilt the Front and selected all six workflow stages. Each selection showed the backend-derived five-part explanation (`who`, action, input/context, authority effect, next step) while backend `projectVersion=22`, Thread version `22`, Event count `26`, and last sequence `26` remained unchanged.
- P0-2 G2-C presentation: the active ReviewRound showed four real lanes, two same-round Snapshots (`snapshot-5` → `snapshot-6`) with `evidence-4`, confidence `0.75` → `1`, and Challenge-state deltas, plus 5 key-moment groups backed by source sequences from 26 raw Events. Raw Event and Graph diagnostics remained collapsed by default.
- P0-2 G2-C browser evidence: at 1920x1080 and 390x844, page-level horizontal overflow was 0, the narrow stage axis used only an internal scroller, technical details were closed by default, and browser warning/error logs were empty.
- P0-2 G2-D quality evidence: `npm.cmd run lint` completed with 0 errors and 0 warnings, `npm.cmd run build` passed, and the unchanged backend passed 21/21 tests. Front package, lockfile, and Sites hosting configuration hashes remained unchanged.
- P0-2 G2-D presentation evidence: the default surface contains 4 Chinese dimensions, 6 Chinese stages, and 24 responsibility cells. Default visible English is limited to the `TAG` brand and its mark; backend enum values and technical IDs remain inside the collapsed technical detail.
- P0-2 G2-D browser evidence: at 1920x1080, page `scrollWidth/clientWidth` was `1920/1920` and `scrollHeight/clientHeight` was `1080/1080`; both detail sections were closed by default and opened successfully. All six stage selections changed the five-part explanation while backend project/Thread version stayed `22` and Event count/last sequence stayed `26`. At 390x844, page-level horizontal overflow was 0 and the matrix alone used an internal horizontal scroller. Browser warning/error logs were empty.
- P0-2 G2-E quality evidence: Control independently ran `npm.cmd run lint` with no errors or warnings, `npm.cmd run build` successfully, and the unchanged backend passed 21/21 tests.
- P0-2 G2-E presentation evidence: the default complete-flow view contains six staggered relay clusters across four horizontal lanes: three precheck attempts, two formal-review rounds, and one human decision. Every cluster visibly follows `输入↓模型↗规则↓输出`; three separate dashed loops represent precheck 1→2, precheck 2→3, and review 1→2, with solid precheck→review and review→decision transitions. The phase widths measured `904/452/151`, preserving the intended `60/30/10` emphasis.
- P0-2 G2-E browser evidence: at 1920x1080, page width and height measured `1920/1920` and `1080/1080`, six clusters and three feedback loops were visible by default, and details remained closed. At 390x844, page width was `390/390` while the `1180`-pixel track used its own `369`-pixel scroller. Browser warning/error logs were empty. Switching presentation modes did not mutate authority: Thread version remained `23`, Event count and last sequence remained `27`, with four ReviewRounds, seven Snapshots, and three Decisions.

## Current stopping point

- P0-2F G0、G1A 与 G1M-A 已接受；G1M-B 的 24 次真实候选已完成但未入围，30 次 finalist 未启动。
- The existing P0 Front remains waiting. No replacement task is created. 下一步需要用户在“授权新的节流测评预算”与“保留 GLM 实验未入围并允许 Front 做明确降级展示”之间作出决定。
- P0-3 remains unauthorized. Dependency upgrades, deployment, authentication, real models, A2A, MCP, RAG and real customer data remain outside this checkpoint.

## Known local-only risks

- Node reports `node:sqlite` as experimental in the current runtime.
- Z.AI General API 在连续 24 次候选调用中返回 15 次 `ADVISORY_RATE_LIMITED`；当前评测器默认使用显式 `5000ms` pacing，但不会自动重试或突破冻结预算。该节流配置尚未获得新的真实调用验证。
- `npm.cmd audit --json` in `lab/site` reports 13 dependency findings: 12 high and 1 low. No dependency update or force fix was authorized; deployment remains blocked until a separately scoped dependency/security Gate resolves them.

## Not implemented

- Authentication or production authorization.
- Production model authority, A2A, MCP, or external tools. GLM-5.3 已验证能够通过 TAG 的真实 HTTP／DurableApp 链路调用，但没有通过候选质量 Gate，也不是默认或生产提供方。
- Production/deployed frontend. `lab/site/**` is an integrated local synthetic Front, not a deployed or production-authorized surface.
- G1M-B 的入围配置与 30 案 finalist 质量验收、以及两个角色聚焦的 P0-2F Front 视图尚未完成或接受。

## Source handling

Stars, Lease/JW Compare, and Race were read only. No source code, customer data, runtime database, upload, visual asset, or frontend implementation was copied into TAG.

The original project contents are preserved in `C:\Users\22673\Desktop\Archive\TAG-sources-20260821`. See `ARCHIVE-MANIFEST.md` for the exact file/task archive state.
