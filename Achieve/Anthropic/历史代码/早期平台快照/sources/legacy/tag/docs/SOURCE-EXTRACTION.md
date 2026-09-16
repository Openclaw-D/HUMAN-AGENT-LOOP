# Source extraction matrix

## Stars

Keep and rewrite:

- shared goal and revision;
- explicit Task/Message/Artifact distinctions;
- challenge → supplement → review loop;
- cancellation and idempotency concepts;
- human Gate and immutable reconsideration;
- A2A as optional transport, not governance.

Reject:

- fixed leader/business/risk core ontology;
- route-selected or hard-coded human actors;
- agent-facing final decision action;
- global SSE;
- mutable Artifact references;
- snapshot plus JSONL half-transactions;
- silent recovery to an empty snapshot;
- guessed affected context after RPC.

## Lease / JW Compare

Keep and generalize:

- one mutually visible auditable review Thread;
- human messages do not invoke an agent implicitly;
- explicit Reply and Citation relationships;
- stable evidence locator beyond a filename;
- `expectedVersion` and project-scoped idempotency;
- durable Run status, lease, retry, and replay;
- simulated, provider-generated-unverified, unavailable, and verified truth labels;
- advisory output separated from facts, scores, hard gates, and Decisions;
- missing evidence leads to lower confidence, Challenge, or manual review rather than automatic rejection;
- server-side provenance added after validating model-authored content.

Reject:

- financing-specific roles, dimensions, scoring, grades, policy rules, fixtures, and customer/material data;
- any client-provided role as authorization;
- any model output that writes authoritative facts or decisions directly.

## Race

Keep as product/validation principles:

- the primary problem is context lost during handoffs, not lack of models or tools;
- shared context, dynamic routing, state control, and traceability form the small coordination core;
- do not replace existing systems or seize human approval authority;
- validate narrowly with baseline, replay, side-by-side operation, and bounded pilot;
- target metrics remain targets until measured.

Reject:

- all slides, images, visual direction, frontend composition, competition copy, and claimed presentation outcomes;
- any target percentage presented as an achieved result.

## JW workspace

Keep and consolidate:

- backend session plus project Membership as the authority source;
- object-level project isolation and project-hiding lookup behavior;
- evidence references with precise page/cell/region locators;
- source material → advisory extraction → human correction/confirmation → human risk determination;
- score, grade, confidence, evidence, hard gate, policy result, and human approval as distinct records;
- deterministic, versioned policy outside chat roles;
- provider routing behind stable ports;
- input assembly, output validation, redacted Run recording, retry lease, idempotency replay, and provider failure taxonomy;
- simulated, provider-generated-unverified, verified, unavailable, and manual-review truth states;
- project-scoped shared review chains with explicit messages, replies, citations, focus events, and immutable audit records.

Reject:

- every frontend, 3D asset, showcase, competition artifact, and UI-specific projection;
- financing-specific domain scoring, repayment, customer, industry, and equipment fixtures;
- runtime databases, uploaded materials, browser/session records, credentials, IP addresses, and user-agent data;
- client-provided role headers as authorization;
- direct provider output writes to authoritative facts, hard gates, or Decisions.

## Resulting TAG kernel

TAG combines only the backend invariants:

```text
shared context
+ explicit evidence/citations
+ deterministic state/policy
+ project-scoped human and agent identities
+ persistent advisory runs
+ human decision gate
+ immutable event history
+ rebuildable graph projection
```
