import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { startServer } from '../../Connectors/src/http/server.mjs';
import { ASYNC_PARSE_VERSION } from '../../C/src/parse/adapters-async.mjs';
import { createAssistantModel } from '../src/assistant-model.mjs';
import { createAssistantEvidenceProvider } from '../src/assistant-evidence-provider.mjs';
import { startEdgeServer } from '../src/server.mjs';
import { createFixtureStore } from '../src/store.mjs';
import { createSessionStore } from '../src/session.mjs';

test('real Edge → Connectors HTTP → LangGraph → model HTTP carries original, replay and stale evidence handled', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jw-evidence-http-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const original = Buffer.from('合成激光客户申请500万元；合同未付余额为应收。');
  const hash = createHash('sha256').update(original).digest('hex');
  let hits = 0, onSend = null, permitted = true, available = true, corrupt = false;
  const captured = [];
  const mock = http.createServer((req, res) => {
    let body = ''; req.on('data', d => body += d); req.on('end', async () => {
      hits++; captured.push(JSON.parse(body));
      const text = captured.at(-1).messages[0].content;
      const pack = JSON.parse(text.split('[服务端获准证据包] ')[1]);
      await onSend?.();
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ observations: [
        { text: '申请额500万元', evidenceRefIds: [pack.snippets[0].id] },
        { text: '虚构批准', evidenceRefIds: ['forged'] }], questions: [] }) } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }));
    });
  });
  await new Promise(r => mock.listen(0, '127.0.0.1', r));
  t.after(() => { mock.closeAllConnections(); return new Promise(r => mock.close(r)); });
  const connectors = await startServer({ store: { query: async (sql, params) => {
    assert.deepEqual(params.slice(0, 3), ['t', 'c', ['a']]);
    assert.match(sql, /l\.a_customer_id=\$2/);
    return { rows: available ? [{ evidence_id: 'e', a_ref: 'a', object_ref: 'original', sha256: hash,
      parser_version: ASYNC_PARSE_VERSION + '+semantic', result: { ok: true, text: original.toString(), declaredFacts: [] } }] : [] };
  } }, objectStore: { get: async () => corrupt ? Buffer.from('corrupt') : original } }, { port: 0, serviceToken: 'synthetic-token' });
  t.after(() => { connectors.server.closeAllConnections(); return connectors.close(); });
  const configPath = path.join(dir, 'config.json');
  await fs.writeFile(configPath, JSON.stringify({ transport: { mode: 'mock', mock: { baseUrl: `http://127.0.0.1:${mock.address().port}`, timeoutMs: 1000 } }, evidencePolicy: { allowedHashes: [hash] } }));
  const model = await createAssistantModel({ configPath, receiptsDir: dir, requireEvidence: true });
  const provider = createAssistantEvidenceProvider({ baseUrl: `http://127.0.0.1:${connectors.server.address().port}`, token: 'synthetic-token', policy: model.evidencePolicy });
  const store = createFixtureStore();
  const snapshot = { customer: { name: '合成激光客户' }, artifacts: [{ artifactId: 'a' }], artifactsReadable: true,
    admission: { inputVersion: 1, scope: { revision: 1, tenantId: 't' }, cells: [], blockers: [] } };
  store.upsertCustomer('c', snapshot);
  const edge = await startEdgeServer({ port: 0, seal: { buildId: 'evidence-test' }, probes: [], store,
    sessionStore: createSessionStore({}), verifyCredential: async () => ({ ok: true, principalId: 'synthetic', roles: ['admin'], tenantId: 't' }),
    auth: async ({ session }) => ({ ok: !!session && permitted }), assistantModel: model, assistantEvidence: provider });
  t.after(() => { edge.server.closeAllConnections(); return new Promise(r => edge.server.close(r)); });
  const base = `http://127.0.0.1:${edge.port}`;
  const login = await fetch(base + '/api/jw/v2/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credential: 'synthetic' }) });
  const sid = (await login.json()).session.sessionId;
  const ask = async (question = '核验合成申请') => {
    const r = await fetch(base + '/api/jw/v2/actions/customers/c/assistant/observe', { method: 'POST', headers: { 'content-type': 'application/json', 'x-jw-session': sid }, body: JSON.stringify({ assistant: 'credit', question, facts: ['恶意浏览器事实'] }) });
    return { status: r.status, body: await r.json() };
  };
  const first = await ask();
  assert.equal(first.status, 200); assert.equal(first.body.model.current, true);
  assert.equal(first.body.observations.length, 1); assert.equal(first.body.questions.length, 1);
  assert.equal(first.body.evidenceRefs[0].hash, hash); assert.equal(first.body.model.graphTrace.length, 6);
  assert.match(captured[0].messages[0].content, /合同未付余额为应收/);
  assert.ok(!captured[0].messages[0].content.includes('恶意浏览器事实'));
  assert.equal((await ask()).body.model.replayed, true); assert.equal(hits, 1);
  onSend = () => { snapshot.admission.scope.revision++; store.upsertCustomer('c', snapshot); };
  const stale = await ask('核验变化'); assert.equal(stale.body.model.current, false); assert.deepEqual(stale.body.observations, []);
  assert.equal(stale.body.model.usage.promptTokens ?? stale.body.model.usage.prompt_tokens, 10);
  onSend = null; available = false; assert.equal((await ask()).status, 422); assert.equal(hits, 2);
  available = true; corrupt = true; assert.equal((await ask()).status, 422); assert.equal(hits, 2);
  corrupt = false; onSend = () => { permitted = false; };
  assert.equal((await ask('撤权测试')).status, 403); assert.equal(hits, 3);
});
