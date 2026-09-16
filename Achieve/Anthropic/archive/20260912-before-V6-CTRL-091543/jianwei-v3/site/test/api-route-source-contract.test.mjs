import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const routes = [
  'app/api/cases/[caseId]/messages/route.ts',
  'app/api/cases/[caseId]/evidence/route.ts',
  'app/api/cases/[caseId]/decisions/route.ts',
  'app/api/cases/[caseId]/facts/[factId]/confirm/route.ts',
];

test('case POST routes parse JSON with the bounded reader', () => {
  for (const route of routes) {
    const source = readFileSync(route, 'utf8');
    assert.match(source, /import \{ readBoundedJsonBody \} from '@\/lib\/bounded-json-body';/);
    assert.match(source, /await readBoundedJsonBody\(request\);/);
    assert.doesNotMatch(source, /await request\.json\(\)/);
  }
});

test('bounded reader failures map to stable HTTP statuses', () => {
  for (const route of routes) {
    const source = readFileSync(route, 'utf8');
    assert.match(source, /error\.code === 'REQUEST_BODY_TOO_LARGE'[\s\S]{0,200}'REQUEST_BODY_TOO_LARGE', '请求内容过大', 413/);
    assert.match(source, /error\.code === 'REQUEST_BODY_TIMEOUT'[\s\S]{0,200}'REQUEST_BODY_TIMEOUT', '请求内容读取超时', 408/);
    assert.match(source, /return errorResponse\('INVALID_JSON', '请求内容不是有效 JSON', 400\);/);
  }
});

test('decision flow lock maps to conflict without exposing internals', () => {
  const source = readFileSync(routes[2], 'utf8');
  const lockedResponse = "if (code === 'FLOW_LOCKED') return errorResponse(code, '当前流程已锁定', 409);";
  assert.ok(source.includes(lockedResponse));
  assert.ok(!lockedResponse.includes('error.message'));
  assert.ok(!lockedResponse.includes('String(error'));
});
