# TAG project instructions

## Scope

- TAG is a new backend-first project. Stars, Lease/JW Compare, and Race are read-only sources.
- Do not import from source projects at runtime. Reused mechanisms must be rewritten and tested inside TAG.
- Frontend work is out of scope until explicitly authorized. The future product surface is Chat plus a backend-derived Graph.

## Product truth

- AI belongs to a project context, not to one user's private session.
- Humans, routable agents, and deterministic policy/control services are separate identity classes.
- Agent and model output is advisory. Only an authorized human principal can create a consequential Decision.
- Keep protocol state, work state, evidence state, fact confidence, model confidence, hard gates, and human decision state separate.
- Missing or unverifiable evidence lowers confidence or creates a Challenge/manual-review state; it does not automatically mean rejection.
- Every material claim must use a stable Citation to a precise Evidence locator.
- A2A is an optional agent transport and MCP is optional tool/context access. Neither is governance authority.

## Engineering boundaries

- Build the smallest deterministic backend loop before real model, A2A, MCP, authentication, or frontend integration.
- All mutations require project scope, idempotency, and optimistic version checks.
- Preserve immutable history. Reconsideration creates a new revision and never rewrites a prior Decision.
- Graph data is a derived semantic projection. Layout coordinates are client state and never backend authority.
- Do not claim production security, canonical A2A conformance, statistical validation, or real organizational authority from a local synthetic P0.

## Validation

- Use `npm test` for the dependency-free core.
- Run `git diff --check` when TAG becomes a Git repository.
- Record implemented truth in `STATUS.md`; planned capability belongs in `ROADMAP.md` or `HANDOFF.md`.
