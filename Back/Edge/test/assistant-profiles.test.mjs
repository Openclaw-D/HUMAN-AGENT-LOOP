import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAssistantProfiles } from '../src/assistant-profiles.mjs';
import { startEdgeServer } from '../src/server.mjs';
import { createFixtureStore } from '../src/store.mjs';
import { createSessionStore } from '../src/session.mjs';

async function setup(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jw-profiles-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const control = { hold: null, unknown: false, onHit: null }, hits = [0, 0];
  const profiles = [];
  for (let i = 0; i < 2; i++) {
    const server = http.createServer((req, res) => { req.resume(); req.on('end', async () => {
      hits[i]++; control.onHit?.(); await control.hold;
      if (control.unknown) { res.destroy(); return; }
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ observations: ['profile-' + i], questions: [] }) } }], usage: { prompt_tokens: 2, completion_tokens: 2 } }));
    }); });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    t.after(() => { server.closeAllConnections(); return new Promise(r => server.close(r)); });
    const configPath = path.join(dir, `config-${i}.json`);
    await fs.writeFile(configPath, JSON.stringify({ transport: { mode: 'mock', mock: { baseUrl: `http://127.0.0.1:${server.address().port}`, timeoutMs: 1000 } } }));
    profiles.push({ id: 'p' + i, revision: 1, configPath });
  }
  const registryPath = path.join(dir, 'registry.json');
  await fs.writeFile(registryPath, JSON.stringify({ profiles, active: { id: 'p0', revision: 1 } }));
  const options = { registryPath, stateDir: path.join(dir, 'state'), modelOptions: { receiptsDir: path.join(dir, 'receipts') } };
  return { manager: await createAssistantProfiles(options), restart: () => createAssistantProfiles(options), control, hits, dir,
    input: { tenantId: 't', customerId: 'c', assistant: 'credit', question: '合成问题', context: { contextVersion: 1 } } };
}

test('two real loopback services: switch, in-flight identity, replay, explicit rollback, restart', async t => {
  const f = await setup(t);
  let release, hit;
  f.control.hold = new Promise(r => release = r);
  const waiting = new Promise(r => hit = r); f.control.onHit = hit;
  const inflight = f.manager.observe(f.input); await waiting;
  const switched = await f.manager.activate({ id: 'p1', revision: 1 }, 'admin');
  assert.equal(switched.previous.id, 'p0');
  release(); const old = await inflight; f.control.hold = null;
  assert.equal(old.profile.id, 'p0');
  const next = await f.manager.observe(f.input);
  assert.equal(next.profile.id, 'p1'); assert.notEqual(old.configHash, next.configHash); assert.deepEqual(f.hits, [1, 1]);
  assert.equal((await f.manager.observe(f.input)).replayed, true);
  await f.manager.activate({ id: 'p0', revision: 1 }, 'admin');
  assert.equal((await f.manager.observe(f.input)).replayed, true);
  assert.equal((await f.restart()).status().profile.id, 'p0');
  await assert.rejects(f.manager.activate({ id: 'p1', revision: 99 }, 'admin'), /NOT_REGISTERED/);
  await assert.rejects(f.manager.activate({ id: 'p1', revision: 1, endpoint: 'https://forbidden' }, 'admin'), /NOT_REGISTERED/);
  assert.deepEqual(f.hits, [1, 1]);
});

test('unknown remains blocked across profile switch and process-level restart', async t => {
  const f = await setup(t); f.control.unknown = true;
  const unknown = await f.manager.observe(f.input); assert.equal(unknown.status, 'unknown');
  await f.manager.activate({ id: 'p1', revision: 1 }, 'admin'); f.control.unknown = false;
  assert.equal((await f.manager.observe(f.input)).error.code, 'PROFILE_SEND_UNRESOLVED');
  assert.equal((await (await f.restart()).observe(f.input)).status, 'unknown');
  assert.deepEqual(f.hits, [1, 0]);
});

test('activation HTTP rechecks administrator identity and rejects arbitrary config', async t => {
  const f = await setup(t); let admin = false;
  const edge = await startEdgeServer({ port: 0, seal: {}, probes: [], store: createFixtureStore(),
    sessionStore: createSessionStore({}), assistantModel: f.manager,
    verifyCredential: async () => ({ ok: true, principalId: 'u', roles: admin ? ['admin'] : ['business'] }), auth: async () => ({ ok: true }) });
  t.after(() => { edge.server.closeAllConnections(); return new Promise(r => edge.server.close(r)); });
  const base = `http://127.0.0.1:${edge.port}`;
  const login = await fetch(base + '/api/jw/v2/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credential: 'synthetic' }) });
  const sid = (await login.json()).session.sessionId;
  const activate = body => fetch(base + '/api/jw/v2/admin/model-profile/activate', { method: 'POST', headers: { 'content-type': 'application/json', 'x-jw-session': sid }, body: JSON.stringify(body) });
  assert.equal((await activate({ id: 'p1', revision: 1 })).status, 403);
  admin = true; assert.equal((await activate({ id: 'p1', revision: 1, apiKey: 'never-accepted' })).status, 422);
  assert.equal((await activate({ id: 'p1', revision: 1 })).status, 200);
  admin = false; assert.equal((await activate({ id: 'p0', revision: 1 })).status, 403);
  assert.equal(f.manager.status().profile.id, 'p1'); assert.deepEqual(f.hits, [0, 0]);
});
