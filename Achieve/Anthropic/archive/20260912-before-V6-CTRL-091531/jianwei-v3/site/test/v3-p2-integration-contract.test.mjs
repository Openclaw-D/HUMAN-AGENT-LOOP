import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function source(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('nine formal entries consume the one generic SharedSurfaceShell contract', () => {
  const shell = source('../app/v3-surfaces/shared/surface-shell.tsx');
  assert.match(shell, /entryId: V3SurfaceEntryId/);
  assert.match(shell, /family: V3SurfaceFamily/);
  assert.doesNotMatch(shell, /LegacySharedSurfaceShellProps|@deprecated|normalizeShellProps/);

  const leadership = source('../app/v3-surfaces/leadership/leadership-surface.tsx');
  const opportunity = source('../app/v3-surfaces/opportunity/opportunity-page-adapter.tsx');
  const insight = source('../app/v3-surfaces/insight/insight-runtime.tsx');
  const workbench = source('../app/v3-surfaces/workbench/case-workbench.tsx');
  for (const family of [leadership, opportunity, insight, workbench]) assert.match(family, /SharedSurfaceShell/);
  assert.match(insight, /<SharedChatPanel/);
  assert.match(workbench, /<SharedChatPanel/);
  assert.doesNotMatch(insight, /InsightShellAdapter|v3-collaboration-client/);

  // V4 owns the root management surface. Keep the archived V3 integration
  // contract scoped to its preserved route instead of coupling it to `/`.
  assert.match(source('../app/insight/page.tsx'), /InsightRuntime/);
});

test('Opportunity, Insight and Workbench share canonical SQLite messages, candidates and receipts', () => {
  const sharedChat = source('../app/v3-surfaces/shared/shared-chat.tsx');
  assert.match(sharedChat, /\/api\/v3\/shared\/messages/);
  assert.match(sharedChat, /\/api\/v3\/shared\/messages\/retry/);
  assert.match(sharedChat, /same request id|requestId/);

  const insightRoute = source('../app/api/v3/insight/route.ts');
  assert.match(insightRoute, /getV3SharedRuntime/);
  assert.doesNotMatch(insightRoute, /v3-demo-backend|readSharedInsightRuntimeInput/);

  const adapter = source('../lib/v3-surfaces/workbench/adapter.ts');
  assert.match(adapter, /canonical-shared-sqlite/);
  assert.match(adapter, /recordHumanGate/);
  assert.doesNotMatch(adapter, /pending_shared|v3-demo-backend|V3_SCENARIO_CASES/);

  const sqlite = source('../lib/v3-runtime/sqlite-store.ts');
  assert.match(sqlite, /'human_gate'/);
  assert.match(sqlite, /confirmed_human/);
  assert.match(sqlite, /IDEMPOTENCY_CONFLICT/);
});
