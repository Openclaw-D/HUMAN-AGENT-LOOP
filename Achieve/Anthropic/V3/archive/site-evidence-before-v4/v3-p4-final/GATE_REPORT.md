# V3 P4 Final Regression Gate Report

Date: 2026-08-30 (Asia/Shanghai)  
Workspace: `C:\Users\22673\Desktop\Anthropic\jianwei-v3\site`  
Outcome: **BLOCKED — do not mark the site accepted**

| Gate | Status | Evidence |
| --- | --- | --- |
| G0 Workspace/service provenance | PASS | Node `v22.23.1`, npm `10.9.8`; branch `main`, HEAD `8a9ca671afe54e93f7cefc9bd808344f4051dc60`, shared dirty worktree preserved; port 3000 PID `74432` belongs to this workspace (`next dev --hostname localhost --port 3000`); `/`, `/api/v3/demo/scenario`, and SQLite-backed `/api/v3/shared/context` returned 200. Production acceptance runtime used the built site on port 4311 and was stopped after testing. |
| G1 Static | PASS | `npm.cmd test`: 234/234 tests, 5 suites, 0 fail/skip; `npm.cmd run typecheck`: 0 errors; `npm.cmd run lint`: 0 errors/warnings; `npm.cmd run build`: all five vinext stages passed. |
| G2 HTTP/API | PASS on built vinext runtime | All 10 URLs returned 200. Eight concurrent same-key candidate requests produced one human message ID and one candidate ID. Lineage, cross-Case, external projection, reset authorization, restart persistence, and null-progress checks passed. |
| G3 Browser exact 1920x1080 | **BLOCKED** | Browser reported exact `1920x1080`, DPR 1.5. Root had one H1 and no page overflow, but console contained 9 repeated errors: `[vinext] RSC prefetch setup error: TypeError: te is not a function` from `/_next/static/chunks/link-DrsDsN7s.js`. Expected console errors/warnings: `[]`. Testing stopped at the root route. |
| G4 Supplemental 390x844 | NOT RUN | Strict serial stop after G3 BLOCKED; this viewport cannot replace G3. |
| G5 Docs/evidence reconciliation | BLOCKED | README/status were not updated to claim acceptance. Existing documentation remains to be reconciled after a repair and full rerun. |

## Runtime split that must be repaired

- Port 3000 `next dev` is project-owned and serves HTML/SQLite readiness, but cross-route sessions fail reproducibly: `POST /api/v3/demo/session` returns a session, then `GET /api/v3/asset/cases/FL-DEMO-001/workbench` returns `404 DEMO_SESSION_NOT_FOUND` (3/3 attempts).
- The built `vinext start` runtime on port 4311 passes the HTTP/API regression, but exact-viewport browser loading produces the repeated RSC prefetch console error above.
- Therefore no single tested runtime currently satisfies both the required Workbench API behavior and the zero-console browser Gate.

## Commands and exact results

```powershell
npm.cmd test
# tests 234; suites 5; pass 234; fail 0; skipped 0

npm.cmd run typecheck
# exit 0

npm.cmd run lint
# exit 0; no warnings/errors

npm.cmd run build
# vinext five stages passed

node .\scripts\v3-p4-http-regression.mjs --base-url http://localhost:4311 --phase pre-restart
# PASS; 10/10 routes; 8 concurrent -> 1 human message ID + 1 candidate ID

node .\scripts\v3-p4-http-regression.mjs --base-url http://localhost:4311 --phase post-restart
# PASS; runtime epoch preserved; messages 0; candidates 0

node --check .\scripts\v3-p4-http-regression.mjs
npm.cmd exec -- eslint .\scripts\v3-p4-http-regression.mjs
# both exit 0
```

## Evidence

- `browser-root-1920x1080.png`
- `g3-blocker.json`
- `g2-restart-state.json`
- `g2-post-restart.json`
- `g3-browser-fixture.json`

The synthetic demo runtime was reset to `DEMO-EPOCH-0010` after the blocked browser run. The temporary port 4311 production process was stopped; the pre-existing project-owned port 3000 process was left running and untouched.
