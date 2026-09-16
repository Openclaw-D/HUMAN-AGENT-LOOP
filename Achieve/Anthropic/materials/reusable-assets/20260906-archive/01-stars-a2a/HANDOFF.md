# STARS handoff

Status date: 2026-08-04

## Current truth

- The latest direction is a three-party human-agent financing governance product, not a five-Agent operations dashboard.
- The active codebase still implements the earlier prototype and is retained only as the latest runnable technical baseline.
- No model API is connected. Current agent behavior is deterministic local logic and browser `localStorage` persistence.

## Decision rights

- Leader: business direction, rationale, resources, and priorities.
- Leader agent: task decomposition and controlled distribution.
- Business unit: investigation, materials, proposal, and evidence.
- Risk unit: independent challenge and final risk ruling, including veto.

## Loops

- Missing evidence: risk → business supplement → risk review.
- Material business ambiguity: risk/business → leader clarification or direction adjustment → risk review.
- Every loop must preserve the question, evidence supplied, human intervention, and final reason.

## Recommended next checkpoint

Create one low-fidelity financing-case wireframe that demonstrates initiation, delegation, evidence submission, risk challenge, conditional approval/rejection, and reconsideration. Obtain approval before changing the existing React UI.

## Verified on the handoff copy

- Clean `npm ci` completed.
- `npm run lint` passed.
- `npm test` passed: 1 test file, 6 tests.
- `npm run build` passed.
- The checks validate the retained technical baseline, not alignment of the current UI with the newer three-party product direction.
