# TAG roadmap

## P0-1B — Deterministic business/risk review loop

Objective: prove that business can submit directly to a shared risk review, risk can request additional evidence without deciding, and an authorized risk human alone can record `pass` or `veto`.

Included: one Project/Thread, ReviewRound, immutable ContextSnapshot, Challenge lifecycle, cited advisory Artifact, risk-only Decision, deep-canonical idempotency, optimistic versioning, fenced runs, and deterministic in-memory events.

Excluded: frontend, SQLite, real model, A2A, MCP, external tools, login, network evidence, and production authority.

Gate:

- two different humans continue one Thread;
- business can submit without material being treated as an automatic veto;
- communicate creates a Challenge and a new evidence answer creates a new Snapshot;
- agent output has exact valid Citations and cannot create a Decision;
- only risk with `decide` can create `pass` or `veto`;
- duplicate deep-equivalent mutation replays one result, while changed same-key requests fail;
- stale version, scope, capability, citation, and stale-run-fence failures create no event;
- reconsideration creates a linked review/Decision revision without rewriting history;
- `npm.cmd test` passes.

Result: accepted locally on 2026-08-25. The P0-B1 backend is deterministic and in-memory; the companion Workflow Lab is a simulated acceptance aid, not a product frontend or backend adapter.

## P0-2 — Durable events and projections

Objective: replace in-memory state with SQLite WAL and add recoverable Chat/Graph projections.

Included: schema migrations, atomic command transactions, event log, idempotency table, outbox, projection checkpoints, Graph projector, project-scoped SSE replay/reset, restart and corruption tests.

Gate: restart preserves history; projection rebuild checksum is stable; two projects do not leak events; corruption fails closed; concurrent commands produce one accepted version.

Result: Control's local G0-G3 Gates passed on 2026-08-25 within the existing P0 task chain. The backend passed 21/21 tests plus restart, concurrency, CORS, authority, Graph, HTTP/SSE, rebuild, degradation, and fail-closed checks. The Sites-compatible Front completed the real Command loop, immutable Snapshot comparison, explicit reject/manual fallback, SSE reconnect, refresh persistence, and responsive browser checks. G2-C established horizontal workflow and vertical Snapshot lineage. G2-D established the Chinese `输入／规则／模型／输出` display language and one-screen hierarchy. G2-E then replaced the flat matrix with a default `预审60%／正审30%／决定10%` track: six staggered relay clusters show the complete `3＋2＋1` capacity, three per-round feedback loops show the bounded cycles, and a separate current-case view continues to show only backend-derived occurrences and real Snapshots. Front lint/build and the unchanged 21/21 backend suite passed; desktop and narrow browser checks found no page-level horizontal overflow or console errors. This is a local synthetic application, not a deployment or production-security claim; final product acceptance remains with the user. No replacement task was created.

## P0-2F — 高 ROI 判断接力闭环

Status: G0、corrected G1A 与 G1M-A integration 已由 Control 接受。G1M-B 的 24 次真实候选完成但无组合入围；30 次 finalist 未启动。G2 与 G3 继续 gated，等待用户决定新的节流调用预算或明确的模型降级展示边界。

Objective: 在不引入真实模型、认证或部署的前提下，把当前展示性的 `预审最多3次／正审最多2轮／决定1次` 变成后端可核验的判断接力，并向业务和风控提供同一权威状态的角色化视图。

Included: PrecheckAttempt、ReviewPass、扩展 ContextSnapshot、Snapshot 判断差异、送审就绪度、唯一下一动作、结构化 advisory Artifact、下一最佳证据、三方分歧、正审判断包、持久化事件时间、ROI 代理指标、GLM-5.3 后端适配器及 30 个合成案例评估。

Excluded: OCR、真实客户数据、认证、部署、A2A、MCP、RAG、新依赖、通用多 Agent 平台、其他模型扩张和生产 ROI 声明。

Gate: 现有 P0 Back 已通过确定性、持久化、HTTP／SSE／Graph、fencing、隐私与离线 54 路评测编排，Control 当前独立回归为 `87/87`。旧语料 hash 上的真实候选 24 次中 9 成功、15 次 `ADVISORY_RATE_LIMITED`，未选择入围配置；新明确语料 hash、`5000ms` pacing 与安全临时库清理仅完成离线验证。在用户决定调用预算或降级边界前，不授权现有 P0 Front 把 GLM-5.3 展示成默认有效模型。完整冻结项见 `P0-CONTRACT.md`。

## P0-3 — Runtime and transport adapters

Status: candidate only; not authorized. P0-2F 只授权一个有调用预算的 GLM-5.3 实验适配器，不等于启动完整 P0-3。

Objective: connect general real runtimes behind frozen contracts, then optionally expose local A2A/MCP adapters.

Included: generalized provider routing, broader runtime controls, optional A2A-compatible subset, optional MCP tool adapter.

Excluded: generic harness, agent-created authority, official conformance claims, and unrestricted tools.

Gate: provider failure is durable and retry-safe; model output remains advisory; A2A/MCP paths cannot bypass CommandService or write Decision; documentation distinguishes real, simulated, and unverified data.
