import assert from 'node:assert/strict';
import test from 'node:test';

import * as caseRoute from '../app/api/v4/cases/[caseId]/route.ts';
import * as managementRoute from '../app/api/v4/management/projection/route.ts';
import {
  __testOnlyResetServerReadContext,
  __testOnlySetServerReadCorruption,
} from '../lib/v4/server-read-context.ts';

const CASE_ID = 'CASE-V4-SYNTH-001';
const SCOPE_ID = 'ORG-DIVISION-A';
const CASE_URL = `https://example.test/api/v4/cases/${CASE_ID}`;
const MANAGEMENT_URL = `https://example.test/api/v4/management/projection?scopeId=${SCOPE_ID}`;

function headersFor(sessionId) {
  const headers = new Headers();
  if (Array.isArray(sessionId)) {
    for (const value of sessionId) headers.append('x-v4-session-id', value);
  } else if (sessionId !== undefined && sessionId !== null) {
    headers.set('x-v4-session-id', sessionId);
  }
  return headers;
}

async function callCase({
  sessionId = 'SESSION-CASE-ALLOWED',
  caseId = CASE_ID,
  url = CASE_URL,
  request,
} = {}) {
  const resolvedRequest = request ?? new Request(url, { headers: headersFor(sessionId) });
  return caseRoute.GET(resolvedRequest, { params: Promise.resolve({ caseId }) });
}

async function callManagement({
  sessionId = 'SESSION-MANAGEMENT-ALLOWED',
  url = MANAGEMENT_URL,
  request,
} = {}) {
  const resolvedRequest = request ?? new Request(url, { headers: headersFor(sessionId) });
  return managementRoute.GET(resolvedRequest);
}

async function json(response) {
  return response.json();
}

async function assertError(responsePromise, status, code) {
  const response = await responsePromise;
  assert.equal(response.status, status);
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await json(response), { error: { code } });
}

test('both allowed GET routes return exact data envelopes with matching canonical identity', async () => {
  const caseResponse = await callCase();
  const managementResponse = await callManagement();
  assert.equal(caseResponse.status, 200);
  assert.equal(managementResponse.status, 200);
  for (const response of [caseResponse, managementResponse]) {
    assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }

  const workBody = await json(caseResponse);
  const managementBody = await json(managementResponse);
  assert.deepEqual(Object.keys(workBody), ['data']);
  assert.deepEqual(Object.keys(managementBody), ['data']);
  assert.deepEqual(
    [
      workBody.data.caseId,
      workBody.data.attemptId,
      workBody.data.contextVersion,
    ],
    [
      managementBody.data.cases[0].caseId,
      managementBody.data.cases[0].attemptId,
      managementBody.data.cases[0].contextVersion,
    ],
  );
  assert.equal(workBody.data.capabilityAdmission.authority, 'none');
  assert.deepEqual(
    workBody.data.capabilityAdmission,
    managementBody.data.capabilityAdmission,
  );
});

test('session header is required, singular and mapped to stable authentication or denial statuses', async () => {
  await assertError(callCase({ sessionId: null }), 400, 'INVALID_READ_INPUT');
  await assertError(callCase({ sessionId: '   ' }), 400, 'INVALID_READ_INPUT');
  await assertError(
    callCase({ sessionId: ['SESSION-CASE-ALLOWED', 'SESSION-ROLE-ONLY'] }),
    400,
    'INVALID_READ_INPUT',
  );
  await assertError(callCase({ sessionId: 'SESSION-UNKNOWN' }), 401, 'SESSION_NOT_FOUND');
  await assertError(callCase({ sessionId: '__proto__' }), 401, 'SESSION_NOT_FOUND');
  await assertError(callCase({ sessionId: 'SESSION-ROLE-ONLY' }), 403, 'READ_DENIED');
  await assertError(callCase({ sessionId: 'SESSION-EXPLICIT-DENY' }), 403, 'READ_DENIED');
  await assertError(callCase({ sessionId: 'SESSION-MANAGEMENT-ALLOWED' }), 403, 'READ_DENIED');
  await assertError(
    callManagement({ sessionId: 'SESSION-CASE-ALLOWED' }),
    403,
    'READ_DENIED',
  );
});

test('query extras and duplicate scopeId are rejected before service output', async () => {
  for (const key of ['actor', 'grant', 'policyVersion', 'governanceProjection', 'scopeId']) {
    await assertError(
      callCase({ url: `${CASE_URL}?${key}=forged` }),
      400,
      'INVALID_READ_INPUT',
    );
  }

  for (const key of ['actor', 'grant', 'policyVersion', 'governanceProjection']) {
    await assertError(
      callManagement({ url: `${MANAGEMENT_URL}&${key}=forged` }),
      400,
      'INVALID_READ_INPUT',
    );
  }
  await assertError(
    callManagement({ url: `${MANAGEMENT_URL}&scopeId=${SCOPE_ID}` }),
    400,
    'INVALID_READ_INPUT',
  );
  await assertError(
    callManagement({ url: 'https://example.test/api/v4/management/projection' }),
    400,
    'INVALID_READ_INPUT',
  );
  await assertError(
    callManagement({ url: 'https://example.test/api/v4/management/projection?scopeId=' }),
    400,
    'INVALID_READ_INPUT',
  );
});

test('encoded and trimmed identifiers are deterministic while unknown resources remain 404', async () => {
  const encodedCase = await callCase({
    sessionId: ' SESSION-CASE-ALLOWED ',
    caseId: `%20${CASE_ID}%20`,
  });
  assert.equal(encodedCase.status, 200);
  const trimmedScope = await callManagement({
    sessionId: ' SESSION-MANAGEMENT-ALLOWED ',
    url: `https://example.test/api/v4/management/projection?scopeId=%20${SCOPE_ID}%20`,
  });
  assert.equal(trimmedScope.status, 200);

  await assertError(callCase({ caseId: 'CASE-UNKNOWN' }), 404, 'CASE_NOT_FOUND');
  await assertError(
    callManagement({ url: 'https://example.test/api/v4/management/projection?scopeId=ORG-UNKNOWN' }),
    404,
    'SCOPE_NOT_FOUND',
  );
  await assertError(callCase({ caseId: '%E0%A4%A' }), 400, 'INVALID_READ_INPUT');
});

test('service and unexpected failures map to non-leaking 503 projection errors', async () => {
  try {
    __testOnlySetServerReadCorruption('invalid_governance');
    await assertError(callCase(), 503, 'PROJECTION_INVALID');
    await assertError(callManagement(), 503, 'PROJECTION_INVALID');
  } finally {
    __testOnlyResetServerReadContext();
  }

  const unexpected = {
    get url() {
      throw new Error('sensitive internal failure');
    },
    headers: headersFor('SESSION-CASE-ALLOWED'),
  };
  const response = await caseRoute.GET(unexpected, {
    params: Promise.resolve({ caseId: CASE_ID }),
  });
  assert.equal(response.status, 503);
  const body = await json(response);
  assert.deepEqual(body, { error: { code: 'PROJECTION_INVALID' } });
  assert.equal(JSON.stringify(body).includes('sensitive'), false);
});

test('repeated GET responses are deterministic defensive JSON with no body access or writes', async () => {
  const first = await json(await callCase());
  const second = await json(await callCase());
  assert.deepEqual(first, second);
  assert.notEqual(first, second);
  first.data.organizationPath.push('mutated-client-copy');
  first.data.capabilityAdmission.capabilityId = 'mutated-client-copy';
  assert.deepEqual(await json(await callCase()), second);

  let bodyReads = 0;
  const bodyGuard = {
    url: CASE_URL,
    headers: headersFor('SESSION-CASE-ALLOWED'),
    get body() {
      bodyReads += 1;
      return 'forged-body';
    },
  };
  const guardedResponse = await caseRoute.GET(bodyGuard, {
    params: Promise.resolve({ caseId: CASE_ID }),
  });
  assert.equal(guardedResponse.status, 200);
  assert.equal(bodyReads, 0);
});

test('route modules expose GET only among HTTP method exports', () => {
  const methods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
  assert.deepEqual(Object.keys(caseRoute).filter((key) => methods.has(key)), ['GET']);
  assert.deepEqual(Object.keys(managementRoute).filter((key) => methods.has(key)), ['GET']);
});
