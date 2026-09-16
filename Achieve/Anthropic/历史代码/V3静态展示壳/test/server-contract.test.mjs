import assert from 'node:assert/strict';
import test from 'node:test';

const { createAppServer } = await import('../server.mjs');

async function withServer(run) {
  const server = createAppServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try { await run(`http://127.0.0.1:${port}`); }
  finally { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

test('projection and chat routes serve the frozen synthetic case', () => withServer(async (base) => {
  const projectionResponse = await fetch(`${base}/api/cases/FL-DEMO-001/projection`);
  assert.equal(projectionResponse.status, 200);
  const projection = await projectionResponse.json();
  assert.equal(projection.caseId, 'FL-DEMO-001');
  assert.equal(projection.stages.length, 4);

  const response = await fetch(`${base}/api/cases/FL-DEMO-001/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: '请返回候选说明' }) });
  assert.equal(response.status, 200);
  const value = await response.json();
  assert.equal(value.caseId, 'FL-DEMO-001');
  assert.equal(value.status, 'candidate');
  assert.match(value.messageId, /^msg-.+/);
  assert.ok(value.answer);
  assert.deepEqual(value.evidenceRefs, ['EV-SYN-001']);
}));

test('HTTP adapter fails closed for unknown case, invalid input, and method', () => withServer(async (base) => {
  const unknown = await fetch(`${base}/api/cases/UNKNOWN/projection`);
  assert.equal(unknown.status, 404);
  assert.equal((await unknown.json()).error.code, 'CASE_NOT_FOUND');

  const empty = await fetch(`${base}/api/cases/FL-DEMO-001/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: ' ' }) });
  assert.equal(empty.status, 400);
  assert.equal((await empty.json()).error.code, 'EMPTY_MESSAGE');

  const invalid = await fetch(`${base}/api/cases/FL-DEMO-001/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error.code, 'INVALID_JSON');

  const method = await fetch(`${base}/api/cases/FL-DEMO-001/messages`, { method: 'DELETE' });
  assert.equal(method.status, 405);
  assert.equal((await method.json()).error.code, 'METHOD_NOT_ALLOWED');
}));
