import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { resolve } from 'node:path';

import { createRelayHttpServer } from '../src/http/server.js';
import { createHarness, envelope } from './helpers.js';

async function listen(server) {
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server) {
  await new Promise((resolveClose) => server.close(resolveClose));
  server.advisoryRuntime?.close?.();
}

function createBody(id = 'case-ops-origin') {
  return envelope('workCase.create', {
    id, organizationId: 'org-demo', scenarioKey: 'supplyChain', title: 'P6 Origin boundary',
    ownerActorRef: { kind: 'human', id: 'human-owner' }, nextAction: 'verify boundary',
    trigger: {
      id: `${id}:trigger:1`, type: 'representativeTrigger', sourceRef: { systemId: 'core-system' },
      observedAt: '2026-08-26T00:00:00.000Z', dedupeKey: `supplyChain:${id}`,
      payloadRef: { systemId: 'core-system', recordType: 'trigger', recordId: id, observedVersion: '1' },
    },
    scenarioExtensions: {},
  }, 0);
}

function rawRequest(base, { path = '/api/work-cases', method = 'POST', headers = {}, body = '' } = {}) {
  const url = new URL(base);
  return new Promise((resolveRequest, reject) => {
    const request = httpRequest({ hostname: url.hostname, port: url.port, path, method, headers: { ...headers, 'content-length': Buffer.byteLength(body) } }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolveRequest({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    request.on('error', reject);
    request.end(body);
  });
}

test('foreign, malformed, path-bearing and Host-spoofed Origin are rejected before body with zero writes', async () => {
  const harness = createHarness();
  let bodyReads = 0;
  const server = createRelayHttpServer({ service: harness.service, onBodyRead: () => { bodyReads += 1; } });
  const base = await listen(server);
  const body = JSON.stringify(createBody());
  const cases = [
    { origin: 'http://evil.example:8080' },
    { origin: 'not-an-origin' },
    { origin: `${base}/unexpected/path` },
    { origin: 'http://evil.example:4444', host: 'evil.example:4444' },
    { origin: base.replace('http:', 'https:') },
    { origin: base.replace(/:\d+$/, ':65534') },
  ];
  try {
    for (const item of cases) {
      const result = await rawRequest(base, { headers: { 'content-type': 'application/json', origin: item.origin, ...(item.host ? { host: item.host } : {}) }, body });
      assert.equal(result.status, 403, JSON.stringify(item));
      assert.equal(JSON.parse(result.body).error.code, 'ORIGIN_DENIED');
    }
    assert.equal(bodyReads, 0);
    assert.deepEqual(harness.store.getStats(), { streams: 0, events: 0, projections: 0, commandReceipts: 0 });
  } finally {
    await close(server);
    harness.close();
  }
});

test('local socket origin and explicit exact allowlist are echoed without wildcard', async () => {
  const harness = createHarness();
  const server = createRelayHttpServer({ service: harness.service, allowedOrigins: ['https://pilot.example:8443'] });
  const base = await listen(server);
  try {
    const local = await fetch(`${base}/health/live`, { headers: { origin: base } });
    assert.equal(local.status, 200);
    assert.equal(local.headers.get('access-control-allow-origin'), base);
    const explicit = await fetch(`${base}/health/live`, { headers: { origin: 'https://pilot.example:8443' } });
    assert.equal(explicit.status, 200);
    assert.equal(explicit.headers.get('access-control-allow-origin'), 'https://pilot.example:8443');
    assert.notEqual(explicit.headers.get('access-control-allow-origin'), '*');
  } finally {
    await close(server);
    harness.close();
  }
});

test('body limit, unified envelope and raw static traversal remain fail closed', async () => {
  const harness = createHarness();
  const server = createRelayHttpServer({ service: harness.service, bodyLimit: 128, publicDirectory: resolve('public') });
  const base = await listen(server);
  try {
    const large = await rawRequest(base, { headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(createBody('x'.repeat(300))) });
    assert.equal(large.status, 413);
    assert.equal(JSON.parse(large.body).error.code, 'BODY_TOO_LARGE');
    const traversal = await rawRequest(base, { path: '/%2e%2e%2fpackage.json', method: 'GET' });
    assert.equal(traversal.status, 403);
    assert.equal(JSON.parse(traversal.body).error.code, 'STATIC_PATH_DENIED');
  } finally {
    await close(server);
    harness.close();
  }
});

test('invalid configured allowlist fails before listener creation', () => {
  const harness = createHarness();
  try {
    assert.throws(() => createRelayHttpServer({ service: harness.service, allowedOrigins: ['*'] }), (error) => error.code === 'CORS_CONFIGURATION_INVALID');
    assert.throws(() => createRelayHttpServer({ service: harness.service, allowedOrigins: ['http://localhost:4178/path'] }), (error) => error.code === 'CORS_CONFIGURATION_INVALID');
  } finally {
    harness.close();
  }
});
