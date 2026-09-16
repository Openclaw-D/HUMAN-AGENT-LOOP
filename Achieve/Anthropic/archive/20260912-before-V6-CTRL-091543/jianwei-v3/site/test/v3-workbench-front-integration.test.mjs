import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  WORKBENCH_API_ROUTES,
  readWorkbench,
  submitWorkbenchAction,
} from '../app/v3-surfaces/workbench/workbench-client.ts';

test('all five frontend perspectives map to canonical Workbench read and command routes', () => {
  assert.deepEqual(WORKBENCH_API_ROUTES, {
    business: { read: '/api/v3/business/cases/FL-DEMO-001/workbench', action: '/api/v3/business/cases/FL-DEMO-001/actions' },
    policy: { read: '/api/v3/policy/cases/FL-DEMO-001/workbench', action: '/api/v3/policy/cases/FL-DEMO-001/actions' },
    credit: { read: '/api/v3/credit/cases/FL-DEMO-001/workbench', action: '/api/v3/credit/cases/FL-DEMO-001/actions' },
    commercial: { read: '/api/v3/commercial/cases/FL-DEMO-001/workbench', action: '/api/v3/commercial/cases/FL-DEMO-001/actions' },
    asset: { read: '/api/v3/asset/cases/FL-DEMO-001/workbench', action: '/api/v3/asset/cases/FL-DEMO-001/actions' },
  });
});

test('read consumes canonical DTO with the selected server session', async () => {
  const calls = [];
  const dto = { schemaVersion: 'v3-case-workbench-1', caseId: 'FL-DEMO-001', defaultPerspective: 'credit' };
  const result = await readWorkbench('credit', 'SESSION-CREDIT', undefined, async (path, init) => {
    calls.push({ path: String(path), init });
    return new Response(JSON.stringify(dto), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  assert.deepEqual(result, dto);
  assert.equal(calls[0].path, WORKBENCH_API_ROUTES.credit.read);
  assert.equal(new Headers(calls[0].init.headers).get('x-jw-demo-session'), 'SESSION-CREDIT');
  assert.equal(calls[0].init.cache, 'no-store');
});

test('authority action posts command DTO and preserves server result', async () => {
  let captured;
  const serverResult = {
    requestId: 'REQ-1', caseId: 'FL-DEMO-001', contextVersion: 'CTX-3', perspective: 'business',
    actionType: 'remind', status: 'routed', result: '业务协调动作已路由', authority: 'none',
    authoritativeStateChanged: false, eventId: 'EVENT-1', receiptId: null,
    route: { threadId: 'FL-DEMO-001-INTERNAL', targetPrincipalId: 'risk-credit' }, retry: { retryable: false },
  };
  const body = {
    requestId: 'REQ-1', expectedContextVersion: 'CTX-3', actionType: 'remind',
    targetPrincipalId: 'risk-credit', message: '请复核 Evidence',
  };
  const result = await submitWorkbenchAction('business', 'SESSION-BUSINESS', body, async (path, init) => {
    captured = { path: String(path), init };
    return new Response(JSON.stringify(serverResult), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  assert.equal(captured.path, WORKBENCH_API_ROUTES.business.action);
  assert.equal(captured.init.method, 'POST');
  assert.equal(new Headers(captured.init.headers).get('x-jw-demo-session'), 'SESSION-BUSINESS');
  assert.deepEqual(JSON.parse(captured.init.body), body);
  assert.equal(result.authority, 'none');
  assert.equal(result.authoritativeStateChanged, false);
});

test('page uses visible pending/error/success states and server-projected external chat', () => {
  const source = readFileSync(new URL('../app/v3-surfaces/workbench/case-workbench.tsx', import.meta.url), 'utf8');
  assert.match(source, /submitWorkbenchAction/);
  assert.match(source, /disabled=\{!draft\.trim\(\) \|\| Boolean\(busy\)/);
  assert.match(source, /role=\{notice\.tone === 'error' \? 'alert' : 'status'\}/);
  assert.match(source, /SharedChatPanel/);
  assert.match(source, /invitation-scoped projection/);
  assert.match(source, /if \(external\) return null/);
  assert.doesNotMatch(source, /\/api\/v3\/collaboration\/projection/);
  assert.doesNotMatch(source, /messages:\s*\[/);
});

test('/business H1 remains business identity in every mode', () => {
  const source = readFileSync(new URL('../app/v3-surfaces/workbench/case-workbench.tsx', import.meta.url), 'utf8');
  assert.match(source, /<h1 data-testid="workbench-heading">\{route\.heading\}<\/h1>/);
  assert.match(source, /initialRoute === 'business' && mode !== 'relationship'/);
  assert.match(source, /<BusinessDetailView model=\{model\} mode=\{mode\}/);
  assert.doesNotMatch(source, /mode === 'relationship' \? '同一 Case/);
});
