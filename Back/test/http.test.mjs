import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server.mjs';
import { DEFAULT_WEIGHTS, DEFAULT_LIMITS } from '../src/scenarios.mjs';

async function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'decision-http-'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>模拟协作决策</title><div id="root"></div>');
  const app = createApp({ dbPath: join(dir, 'state.sqlite'), frontDir: dir });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });
  const client = () => {
    let cookie = '';
    return async (path, body, headers = {}) => {
      const res = await fetch(base + path, { headers: { Origin: base, ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers }, ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }) });
      if (res.headers.get('set-cookie')) cookie = res.headers.get('set-cookie').split(';')[0];
      return { status: res.status, json: await res.json() };
    };
  };
  return { app, base, client };
}
test('independent human sessions share a case while only the facilitator can confirm', async t => {
  const { client } = await fixture(t), a = client(), b = client(), observer = client();
  assert.equal((await a('/api/cases')).status, 401);
  assert.equal((await a('/api/session', { role: 'facilitator', displayName: '参与者甲' })).status, 200);
  await b('/api/session', { role: 'contributor', displayName: '参与者乙' });
  await observer('/api/session', { role: 'observer', displayName: '观察者丙' });
  let state = (await b('/api/cases/shared-choice')).json.case;
  const discuss = { requestId: randomUUID(), expectedRevision: state.revision, message: '先考虑后续调整空间。' };
  assert.equal((await b('/api/cases/shared-choice/discuss', discuss)).status, 200);
  assert.equal((await b('/api/cases/shared-choice/discuss', discuss)).json.replayed, true);
  state = (await a('/api/cases/shared-choice')).json.case;
  assert.equal(state.discussion.length, 1); assert.equal(state.discussion[0].author, '参与者乙');
  const analyze = { requestId: randomUUID(), expectedRevision: state.revision, weights: DEFAULT_WEIGHTS, limits: DEFAULT_LIMITS };
  assert.equal((await observer('/api/cases/shared-choice/analyze', analyze)).status, 403);
  assert.equal((await b('/api/cases/shared-choice/analyze', analyze)).status, 200);
  state = (await a('/api/cases/shared-choice')).json.case;
  const decision = { requestId: randomUUID(), expectedRevision: state.revision, outcome: 'choose', candidateId: state.analysis.recommendedId, reason: '综合大家的意见作出模拟选择' };
  assert.equal((await b('/api/cases/shared-choice/decide', decision)).status, 403);
  assert.equal((await a('/api/cases/shared-choice/decide', decision)).status, 200);
  assert.equal((await b('/api/cases/shared-choice')).json.case.decisions.length, 1);
});
test('source checks, strict fields and stale writes fail without changing shared state', async t => {
  const { client, base } = await fixture(t), a = client();
  assert.equal((await a('/api/session', { role: 'facilitator' }, { Origin: 'http://unrelated.invalid' })).status, 403);
  assert.equal((await a('/api/session', { role: 'facilitator', actor: 'injected' })).status, 400);
  const login = await a('/api/session', { role: 'facilitator', displayName: '参与者甲' }); assert.equal(login.status, 200);
  const s = (await a('/api/cases/shared-choice')).json.case;
  const body = { requestId: randomUUID(), expectedRevision: s.revision, assistantId: 'planner', question: '请解释这几个方案。' };
  assert.equal((await a('/api/cases/shared-choice/ask', body)).status, 200);
  const stale = await a('/api/cases/shared-choice/discuss', { requestId: randomUUID(), expectedRevision: s.revision, message: '旧输入应被拒绝' });
  assert.equal(stale.status, 409); assert.equal(stale.json.error, 'REVISION_CONFLICT');
  assert.equal((await a('/api/cases/shared-choice')).json.case.discussion.length, 2);
  const large = await fetch(base + '/api/session', { method: 'POST', headers: { Origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ role:'facilitator', displayName:'x'.repeat(17000) }) });
  assert.equal(large.status, 413);
});
test('health and static readiness are real; missing assets and unknown APIs return errors', async t => {
  const { base, client } = await fixture(t);
  const health = await fetch(base + '/healthz').then(r => r.json());
  assert.equal(health.ok, true); assert.equal(health.assistantMode, 'simulated'); assert.equal(health.model, 'not_configured');
  const index = await fetch(base); assert.equal(index.status, 200); assert.match(await index.text(), /id="root"/);
  assert.equal((await fetch(base + '/assets/missing.js')).status, 404);
  const c = client(); await c('/api/session', { role:'observer' });
  assert.equal((await c('/api/undefined')).status, 404);
  assert.equal((await c('/api/cases/not-present')).status, 404);
});
