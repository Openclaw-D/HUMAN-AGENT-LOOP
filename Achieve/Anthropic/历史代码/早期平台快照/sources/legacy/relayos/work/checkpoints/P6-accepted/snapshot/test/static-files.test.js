import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { resolve } from 'node:path';

import { createRelayHttpServer } from '../src/http/server.js';
import { createHarness, createWorkCase, envelope, seedGoalAndContext } from './helpers.js';

async function listen(server) {
  await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen); });
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server) { await new Promise((resolveClose) => server.close(resolveClose)); }

function rawGet(base, path, headers = {}) {
  const url = new URL(base);
  return new Promise((resolveRequest, reject) => {
    const request = httpRequest({ hostname: url.hostname, port: url.port, method: 'GET', path, headers }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolveRequest({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    request.on('error', reject);
    request.end();
  });
}

test('static server serves root/JS/CSS with exact content types and HEAD without body', async () => {
  const harness = createHarness();
  const server = createRelayHttpServer({ service: harness.service, publicDirectory: resolve('public') });
  const base = await listen(server);
  try {
    const root = await fetch(`${base}/`);
    assert.equal(root.status, 200);
    assert.match(root.headers.get('content-type'), /^text\/html/);
    assert.match(await root.text(), /连续性关系图/);
    const js = await fetch(`${base}/app.js`);
    assert.match(js.headers.get('content-type'), /^text\/javascript/);
    const css = await fetch(`${base}/styles.css`);
    assert.match(css.headers.get('content-type'), /^text\/css/);
    const head = await fetch(`${base}/styles.css`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal((await head.text()).length, 0);
    assert.ok(Number(head.headers.get('content-length')) > 0);
  } finally { await close(server); harness.close(); }
});

test('static traversal, malformed encoded path and 404 fail closed without exposing files', async () => {
  const harness = createHarness();
  const server = createRelayHttpServer({ service: harness.service, publicDirectory: resolve('public') });
  const base = await listen(server);
  try {
    const traversal = await rawGet(base, '/%2e%2e%2fpackage.json');
    assert.equal(traversal.status, 403);
    assert.equal(JSON.parse(traversal.body).error.code, 'STATIC_PATH_DENIED');
    const malformed = await rawGet(base, '/%E0%A4%A');
    assert.equal(malformed.status, 400);
    assert.equal(JSON.parse(malformed.body).error.code, 'STATIC_PATH_INVALID');
    const missing = await fetch(`${base}/missing-ui-file.js`);
    assert.equal(missing.status, 404);
    assert.match(missing.headers.get('content-type'), /^application\/json/);
    assert.equal((await missing.json()).error.code, 'ROUTE_NOT_FOUND');
  } finally { await close(server); harness.close(); }
});

test('Origin is checked before static/API handling and graph route is read-only projection + replay', async () => {
  const harness = createHarness();
  const id = 'static-graph-route';
  await createWorkCase(harness, { id });
  await seedGoalAndContext(harness, id);
  const server = createRelayHttpServer({ service: harness.service, publicDirectory: resolve('public') });
  const base = await listen(server);
  try {
    const denied = await fetch(`${base}/app.js`, { headers: { origin: 'http://foreign.example' } });
    assert.equal(denied.status, 403);
    assert.equal((await denied.json()).error.code, 'ORIGIN_DENIED');
    const before = harness.store.getStats();
    const graph = await (await fetch(`${base}/api/work-cases/${id}/graph`)).json();
    assert.equal(graph.source.projectionHash, graph.source.replayHash);
    assert.deepEqual(harness.store.getStats(), before);
  } finally { await close(server); harness.close(); }
});

test('real version conflict returns backend error and leaves graph owner unchanged', async () => {
  const harness = createHarness();
  const id = 'frontend-version-conflict';
  await createWorkCase(harness, { id });
  const server = createRelayHttpServer({ service: harness.service, publicDirectory: resolve('public') });
  const base = await listen(server);
  try {
    const stale = envelope('goal.propose', { id: 'stale-goal', statement: '不得写入', constraints: [], evidenceIds: [] }, 0);
    const response = await fetch(`${base}/api/work-cases/${id}/commands`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(stale) });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, 'VERSION_CONFLICT');
    const graph = await (await fetch(`${base}/api/work-cases/${id}/graph`)).json();
    assert.equal(graph.fiveQuestions.owner.actorRef.id, 'human-owner');
    assert.equal(graph.source.projectionVersion, 1);
  } finally { await close(server); harness.close(); }
});
