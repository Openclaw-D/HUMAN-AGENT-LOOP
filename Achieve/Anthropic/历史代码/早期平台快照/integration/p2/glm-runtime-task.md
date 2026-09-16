# GLM-5.3 coding checkpoint: P2 runtime only

You are the coding worker for one frozen checkpoint. The Codex/GPT controller owns product decisions, frontend, browser checks, integration evidence, and final acceptance.

## Read first

Read these files completely before editing:

1. `C:\Users\22673\Desktop\Anthropic\P2_CONTRACT.md` — authoritative P2 contract.
2. `C:\Users\22673\Desktop\Anthropic\runtime\p1\README.md` — verified P1 boundary.
3. `C:\Users\22673\Desktop\Anthropic\runtime\p1\src\v2-event-store.mjs`
4. `C:\Users\22673\Desktop\Anthropic\runtime\p1\src\v2-commands.mjs`
5. `C:\Users\22673\Desktop\Anthropic\runtime\p1\src\v2-projection.mjs`
6. `C:\Users\22673\Desktop\Anthropic\runtime\p1\test\v2-event-store.test.mjs`

P1 is evidence and reusable mechanism, not the P2 product contract. Do not edit or import runtime behavior from P1 by path. P2 must be independently runnable.

## Ownership and write boundary

You own and may create/edit only:

- `C:\Users\22673\Desktop\Anthropic\runtime\p2\**`

You are not alone in the workspace. Do not revert or edit files outside that directory, including `P2_CONTRACT.md`, P1, frontend, integration task files, root docs, configuration, or user artifacts. Do not commit, install dependencies, start a persistent service, or access secrets.

## Required deliverable

Build a zero-external-dependency Node.js 22.5+ modular monolith using `node:http`, `node:sqlite`, native `fetch`, and standard-library modules only.

Suggested files may be adjusted if responsibilities remain clear:

- `src/errors.mjs`
- `src/canonical.mjs`
- `src/projection.mjs`
- `src/commands.mjs`
- `src/event-store.mjs`
- `src/scenarios.mjs`
- `src/model-adapters.mjs`
- `src/orchestrator.mjs`
- `src/server.mjs`
- `test/*.test.mjs`
- `scripts/verify.mjs`
- `README.md`

### Storage and replay

- SQLite tables scoped with a `p2_` prefix.
- `p2_events` is append-only and ordered per `workspaceId + caseId`.
- Each event is chained with SHA-256 over canonical JSON and the previous chain head; verify chain on every load.
- `p2_command_receipts` stores successful idempotent results and is append-only.
- SQLite triggers reject update/delete for both tables.
- Projection is never persisted and is rebuilt only from events.
- All writes that append multiple events plus a receipt are one transaction.
- Identity, expected version, idempotency conflict, authority, transition, validation, or integrity failure creates zero business events.

### Projection and state

Implement the P2 contract's `CollaborationCase` concepts with enough structured data for the frontend:

- `identity`, `schemaVersion`, `dataOrigin`, `version`, `eventCursor`, `chainHead`;
- `case` including goal, goalVersion, owner, phase, status, nextStep;
- `actors`, five `phases`, `contextPack`, `modelRuns`, `candidates`, `decisionDiff`, `handoffs`, `gate`, `agentContinuity`, `actionIntents`, `receipts`, `activities`, `metrics`;
- `views.relation`, `views.progress`, `views.responsibility`, all carrying the same projection identity/version/cursor/chainHead;
- `availableAction` with one primary operation, label, requiredActorId, command type, and impact; no client-side authority invention.

At minimum support immutable events for creation, context/evidence, message, model run lifecycle, candidates/diff, handoff propose/accept, gate decide, agent resume, action intent, and receipt. Model candidates remain proposals and never mutate authoritative goal/gate/receipt state.

### Commands

Support exactly the public commands frozen in `P2_CONTRACT.md`:

- `append_message`
- `accept_handoff`
- `decide_gate`
- `resume_agent`
- `create_action_intent`
- `record_receipt`

All public writes require a known `X-Actor-Id`; models cannot accept handoffs, decide gates, or create external action intents. Only the named handoff recipient can accept. Only a human with the required authority can decide the gate. `resume_agent` must preserve caseId, goalVersion, and context snapshot and set `restartCount=0`. ActionIntent is not success. Receipt `unknown` and `failed` must not complete a case.

### Model adapters

Implement an injectable adapter layer and orchestration for `POST /api/v1/cases/{caseId}/model-runs`.

- `P2_MODEL_MODE=demo|live`, default `demo`.
- Demo adapters return deterministic but meaningfully different GPT and GLM candidates, marked `synthetic:true`, with source references, assumptions, risks, missing evidence, and usage/latency metadata.
- OpenAI live adapter calls the Responses API using `OPENAI_API_KEY`, `OPENAI_MODEL`, optional `OPENAI_BASE_URL`.
- Z.AI live adapter calls `https://api.z.ai/api/paas/v4/chat/completions` using `ZAI_API_KEY`, `ZAI_MODEL` defaulting to `glm-5.3`, optional `ZAI_BASE_URL`.
- Missing live keys fail closed. Never silently fall back to demo. Never include secrets in events, logs, error details, responses, tests, or README examples.
- Serialize all Z.AI calls in-process through one mutex. OpenAI and a single Z.AI request may run concurrently.
- Do not expose provider reasoning content. Extract only final answer and structured candidate data. If a live answer is not valid structured JSON, preserve it as a proposal summary with explicit parsing gap, not as authoritative fact.
- The orchestrator records requested/running/completed|failed|unknown events, then a Decision Diff after two completed candidates. It may propose the next handoff but cannot accept it.

### Scenarios

Provide exactly two deterministic `dataOrigin:"sample"` case packs using the same kernel:

1. `ai-project-cocreation`: main scenario for a customer-manager visit assistant; starts ready for explicit GPT+GLM analysis.
2. `business-risk-review`: heterogeneous proof scenario; starts with an evidence gap and a named human gate path.

Use short Chinese product copy. No claimed customer facts or achieved ROI. Context metrics must be computed from fixture input, not hardcoded as business outcomes.

### HTTP and static service

Implement the exact read/write routes in `P2_CONTRACT.md`, same-origin JSON and static serving, default `127.0.0.1:4180`.

- `Content-Type: application/json; charset=utf-8` for JSON.
- JSON request body limit 1 MiB.
- No permissive CORS.
- Add reasonable local security headers and `Cache-Control: no-store`.
- Static root defaults to `prototype/p2-frontend` resolved from the Anthropic project root, but tests can inject a temporary root. Path traversal must fail.
- CLI supports `--port`, `--db`, optional `--frontend-root`, graceful SIGINT/SIGTERM, and closes SQLite.
- `/health` exposes no secrets and reports only storage/model-mode/provider-configured booleans.

### Error contract

Use stable JSON errors:

```json
{
  "error": {
    "code": "AUTHORITY_DENIED",
    "message": "...",
    "details": {}
  }
}
```

Use appropriate 400/401/403/404/409/413/415/422/500/503 statuses. Do not leak stack traces or provider bodies to clients.

## Required tests

Use `node:test`; no external test libraries. At least cover:

1. two sample cases replay and three-view identity consistency;
2. append-only triggers and hash-chain tamper detection;
3. command success, stable idempotent replay, same-key conflict, stale version zero writes;
4. unknown actor/model authority/named recipient/gate authority negative paths with zero writes;
5. normal message creates no model run;
6. demo GPT+GLM model orchestration produces two marked candidates, Decision Diff, and a proposed handoff;
7. missing live keys fail closed with no demo fallback and no secret-shaped leakage;
8. accept handoff → decide gate → resume agent continuity → action intent → unknown/failed receipt not complete → succeeded receipt completes;
9. restart replay equality;
10. HTTP content types, body limit, path traversal, route errors, static serving, security headers, and graceful close.

`scripts/verify.mjs` must create a temporary SQLite database, run the primary end-to-end demo with injected demo adapters, close/reopen, compare projections, verify the three views and output one concise JSON object with measured counts and booleans. Remove only its own temporary files after controlled close.

## Acceptance commands

From `C:\Users\22673\Desktop\Anthropic\runtime\p2`:

```powershell
node --test
node scripts\verify.mjs
node --check src\server.mjs
```

## Stop condition

Stop after the runtime, tests, verify script, and README meet this task pack and all acceptance commands pass. Report files changed, exact test results, limitations, and any contract ambiguity. Do not implement the frontend, browser checks, deployment, P3, authentication, or production claims.
