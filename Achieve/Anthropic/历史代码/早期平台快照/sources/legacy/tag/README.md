# TAG

TAG is a new backend-first project for project-scoped human-agent collaboration, inspired by the multiplayer working model described for Anthropic's Claude Tag. It is an independent local project, not Anthropic software and not a claim of implementation parity.

The first usable loop is deliberately small:

```text
shared project thread
→ human invokes a project agent
→ agent returns persistent, cited, advisory output
→ another human continues from the same context
→ an authorized human owns the final decision
→ backend events derive the graph view
```

## Current state

This folder contains the initial handoff documents and a dependency-free deterministic coordination core extracted and rewritten from the useful backend ideas in Stars and Lease/JW Compare. Race contributes product and validation principles only.

No frontend, real model provider, A2A server, MCP client, authentication system, SQLite database, or production authorization is implemented yet.

## Run the current verification

```powershell
cd C:\Users\22673\Desktop\TAG
npm.cmd test
```

## Current modules

- `src/coordination-core.mjs`: project/thread/message/run/decision commands.
- `src/event-log.mjs`: immutable hash-linked events and idempotency records.
- `src/run-registry.mjs`: durable-contract model for run reservation, lease, replay, and redacted status.
- `src/policy.mjs`: deterministic human/agent authority checks.
- `src/graph-projector.mjs`: layout-independent graph projection.
- `docs/SOURCE-EXTRACTION.md`: source-to-TAG extraction matrix.
- `docs/CLAUDE-TAG-REFERENCE.md`: verified public product reference and local scope boundary.

Read `HANDOFF.md`, `ROADMAP.md`, `STATUS.md`, and `DECISIONS.md` before implementation continues.
