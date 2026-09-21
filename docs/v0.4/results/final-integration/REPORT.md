# V0.4 unified frontend integration — 2026-09-21

## Delivery
One RootApp renders the same frontend on every port; demoTest only isolates local progress. Preserve native role selection, material desk, decision canvas and timeline, driven by synthetic frontend events. No backend or paid model dependency for presentation. Good/medium/bad complete in 5/6/3 forward clicks; back is read-only. Chat and progress synchronize. Every completed stage displays three candidates (one black, two white), confidence bars and black selected connectors. Diamond has only return; Escape closes it.

1920×1080 is the design baseline, at 100% viewport fill without whole-page transform. Large four-page navigation and equal left/right advance buttons. Both panels align. Build files are included.

## Independent validation
- Backend selected regression: 148/148 pass, no skipped tests.
- Frontend broad run: 168/170 initially passed. Fixed stale material cards after failed refresh and replaced an obsolete single-node navigation assertion with the accepted unified-entry contract. Targeted related rerun: 19/19 pass.
- Latest every-stage tree presentation tests: 2/2 pass. Typecheck and production build pass.
- Browser at port 48214: direct role/project entry, first and second forward clicks, synchronized chat/progress and selected tree paths observed. Subsequent layout adjustments need user visual acceptance; automated behavior is not visual approval.
- No real model calls made for this review.

## ZCode soak review
Reports under docs/v0.4/soak/results were independently read. Selected regression verifies SQLite contention, evidence/SSE behavior and model operation fencing. Four-hour soak acceptance is NOT passed: system ~60min, API ~29min, model ~48min, data ~14.59min. Remaining reported issues: text PDF extraction fallback (D1) and an intermittently observed PostgreSQL fault worker exit (D2). External model behavior was stubbed. These backend limits do not gate the local synthetic presentation, and must not be presented as production acceptance.

## Scope
Includes accumulated V0.4 frontend/backend changes and ZCode test harnesses already in this checkout. No credentials, local databases, raw runtime state, unrelated presentation artifacts, deployment or merge.
