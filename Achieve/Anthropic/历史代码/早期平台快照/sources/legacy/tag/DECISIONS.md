# TAG decisions

## D-001 — New project, rewritten mechanisms

TAG is a new project. Stars, Lease/JW Compare, and Race remain read-only sources; TAG does not import their code at runtime.

## D-002 — Backend first

The initial product is the coordination backend. Frontend assets and implementations from all source projects are excluded.

## D-003 — Project-scoped AI

Agent runs belong to a Project and shared Thread. They do not belong to one human's private chat session.

## D-004 — Three identity classes

Human principals, routable agents, and deterministic policy/control services are separate. A single role field must not collapse them.

## D-005 — Advisory agents, human authority

Agents may create messages, runs, challenges, facts proposed for review, and artifacts. They cannot create a final Decision.

## D-006 — Evidence and state separation

Evidence, citations, fact confidence, model confidence, work state, protocol state, hard gates, and human decisions are independently represented.

## D-007 — Event-derived graph

Graph nodes and edges are derived from durable domain events. Coordinates, zoom, and layout are not backend state.

## D-008 — Optional transports

A2A and MCP will be adapters behind the coordination core. They are not required for P0 and do not define governance authority.

## D-009 — Persistence target

The accepted target for multi-human P0 is SQLite with WAL and atomic state/event/idempotency/outbox transactions. The current extracted core is dependency-free and in-memory so its contracts can be tested before storage is added.

## D-010 — P0-B1 risk decision authority and evidence loop

The active P0-B1 contract is frozen in `P0-CONTRACT.md`: business may submit at any time; material gaps lower confidence or create Challenges but never automatically veto. Risk communication opens a Challenge and requires a new immutable ContextSnapshot after evidence. Only a risk human with `decide` can create immutable `pass` or `veto`; agents and policy remain advisory/technical. This is a local deterministic contract, not production governance.

## D-011 — P0-B1 acceptance boundary

G0 through G3 were accepted locally on 2026-08-25 with the dependency-free Node test suite and a simulated, backend-disconnected Workflow Lab. This acceptance proves only deterministic in-memory mechanics and the reviewable Lab topology. It does not authorize or claim persistence, HTTP/SSE, authentication, real model/provider behavior, A2A/MCP, production security, or actual organizational decision authority.

## D-012 — Continue one P0 task chain through the durable local application

P0 checkpoints do not create new Control/Back/Front tasks. The existing three tasks remain stable roles across P0. P0-2 first adds a local authoritative SQLite/WAL and HTTP/SSE backend, then converts `lab/**` into a Sites-compatible local Front that consumes the accepted backend contract. The local saved directory remains source truth; Sites is the editable/preview surface. Deployment, real authentication, and real models remain separately gated.

## D-013 — Accept the P0-2 local durable backend boundary

P0-2 G1 accepts the local Node `node:sqlite` implementation as the checkpoint authority: SQLite/WAL persists the command journal, immutable Events, idempotent results, outbox rows, Messages, and projection checkpoints; HTTP/SSE is a local adapter over that authority. Writer-lock rehydration makes the stored version authoritative across local instances. Configured-origin rejection occurs before mutation, synthetic Agent identity remains advisory-only, and an authorized risk human remains the sole `pass`/`veto` authority. This acceptance is local and synthetic; it does not claim authentication, production authorization, real model availability, deployment, or production audit security.

## D-014 — Accept the P0-2 integrated local Front boundary

P0-2 G2/G3 accepts `lab/site/**` as the editable Sites-compatible local Front over the frozen backend interface. Backend reads, Commands, Graph, and SSE remain authoritative; Front layout, drafts, presentation, and manual-mode indication are non-authoritative client state. An unavailable advisory service creates no Artifact and the Front may expose the still-authorized human risk Decision path. This acceptance is limited to the synthetic local preview. The current Sites dependency audit has 12 high and 1 low finding, so no deployment or production-security claim is allowed until a separate user-approved dependency/security Gate passes.

## D-015 — Human-readable workflow and history projection

The accepted G2-C Front orientation is deliberately asymmetric: actor participation and workflow time are shown horizontally in four swimlanes, while immutable ContextSnapshot lineage is shown vertically from older to newer. Selecting a stage reveals only who acted, what happened, the input/context, the authoritative effect, and the next step; selection is non-authoritative Front state and sends no Command. The default history aggregates related backend Events into a small set of plain-language key moments that retain exact source Event sequences. Raw Events, Graph edges, and engineering diagnostics remain available but collapsed. This decision changes presentation only; backend Commands, states, authority, storage, and interfaces remain frozen.

## D-016 — Chinese single-screen responsibility matrix

The accepted G2-D default Front uses four Chinese display dimensions: `输入` for business people and material, `规则` for deterministic system control, `模型` for advisory-only intelligence, and `输出` for the authorized risk human. The six columns are `发起／审查／补证／快照／建议／决定`; all 24 responsibility positions explain what that dimension does without claiming inactive work occurred. At the 1920×1080 baseline, the current state, matrix, selected-stage explanation, next action, Snapshot change, and key moments fit without page scrolling; collaboration controls and technical data remain collapsed. These names do not rename backend actor classes or transfer final authority: only the risk human records pass/veto. Default visible technical English is excluded except the `TAG` brand.

## D-017 — Bounded relay-loop review track

The accepted G2-E Front replaces the flat G2-D matrix as the default presentation with three proportioned stages: `预审60%／正审30%／决定10%`. The complete structural view shows maximum capacity rather than claiming every case used it: three precheck attempts, two formal-review rounds, and one human decision. Each attempt/round is a staggered four-lane relay following `输入↓模型↗规则↓输出`; per-round dashed returns show the bounded feedback cycles, while solid transitions advance between stages. A separate current-case view displays only backend-derived occurrences and immutable ContextSnapshots. This is a presentation contract, not an implemented backend attempt budget: the existing backend still does not authoritatively record precheck attempts or enforce a `3＋2` anti-probing limit.

## D-018 — Localize the high-ROI judgment relay before expanding the platform

P0 continues in the existing Control／Back／Front task chain. TAG will not build a generic RelayOS, multi-agent institution, organization-wide handoff fabric, generic model platform or production security layer in this checkpoint. P0-2F localizes the useful mechanism to one financial review handoff: business, deterministic services and one bounded GLM-5.3 advisory experiment resolve most gaps during precheck, then risk receives one reconstructable judgment packet for a fast human review.

The first six capabilities are Snapshot judgment diff, formal-review judgment packet, Submission Readiness plus one next action, ROI measurement foundation, Next Best Evidence, and model-rule-human disagreement focus. PrecheckAttempt and ReviewPass become backend authority only for counting and immutable context receipts; they never transfer `pass`／`veto` authority from the risk human.

## D-019 — P0-2F defaults and evidence boundary

P0-2F uses a maximum 3 precheck attempts and 2 formal-review passes, while preserving direct submission and the ideal 1＋1 path. Deterministic structured advisory Artifacts remain the repeatable baseline; GLM-5.3 is authorized as a backend-only experimental provider behind the same schema. Candidate selection uses at most 24 calls and the selected combination uses at most 30 additional synthetic calls. Exact real-world improvement targets are not frozen until real authorized usage data exists, and synthetic results must not be presented as production ROI.

## D-020 — Risk human remains the only Hard Gate

PrecheckAttempt, ReviewPass, ContextSnapshot, model claims, rule coverage and readiness are immutable or derived audit information, not approval authority. ReviewPass represents a risk-human gray Gate where evidence and disagreement are inspected. Only a risk human with `decide` may create the `pass`／`veto` Decision Hard Gate. Model failure, low confidence, missing material, attempt exhaustion or rule disagreement may route to human review but can never manufacture a terminal outcome.

## D-021 — Accept P0-2F G1A only after semantic evidence

P0-2F G1A accepts the corrected deterministic backend boundary: one executable next action, immutable precheck／review receipts, Snapshot lineage and differences, formal-review packet, criterion-scoped disagreement, NBE follow-through and workflow metrics are derived from durable Project records. Acceptance required 25／25 tests, 30 genuinely different synthetic paths and independent restart／HTTP／metric probes; the earlier green but single-path evaluator was explicitly rejected. This decision does not accept GLM-5.3 application integration, model quality, Front adaptation, production ROI or deployment.

## D-022 — Accept GLM application wiring, reject candidate quality selection

P0-2F G1M-A accepts the GLM-5.3 application boundary only: official General API routing, local schema and Citation validation, durable two-stage AdvisoryRun, lease／fencing, HTTP／SSE／Graph／`/judgment` binding, public redaction, failure zero-write behavior and idempotent restart replay. Control's current local regression passed `87/87`; this is enough to say “接口已接通”，not enough to say “模型质量已验收”。

The first real candidate evaluation consumed the frozen 24-call candidate budget and stopped correctly: 9 succeeded, 15 returned `ADVISORY_RATE_LIMITED`, no combination met the candidate threshold, and the 30-call finalist stage did not start. No default GLM prompt／effort configuration is selected. Front adaptation remains gated unless the user either authorizes a new paced evaluation budget or explicitly accepts a visible “实验未入围／转人工” degradation state. The rate-limited run is not production ROI evidence and must not be silently retried, reclassified as success, or hidden.

The stopped result remains permanently bound to corpus hash `17bf6eded4dfc844820083f627096a30027ce9c1e2455f3e87cbf705a5680a96`. A later offline-only corpus revision with explicit fictional financial facts, hash `d4c56a8bb594c99b76d01d5535ef591afe9ea8435012e2e67275ff820b740a07`, plus default `5000ms` pacing and safe temporary-database cleanup does not supersede that evidence and has no real quality claim until separately authorized calls occur.
