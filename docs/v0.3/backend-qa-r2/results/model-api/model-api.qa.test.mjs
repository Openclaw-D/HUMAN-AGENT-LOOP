// backend-qa-r2 · 02_MODEL_API 专项测试（本包独占，非产品代码）。
// 目标：通过真实 Edge HTTP + 可记录请求的本地模型HTTP替身，验证观察/候选API协议与调用控制。
// 运行（工作区根目录执行）：
//   node --test --test-reporter=tap docs/v0.3/backend-qa-r2/results/model-api/model-api.qa.test.mjs
// 全部服务仅监听 127.0.0.1，端口系统分配；不访问外网、不调用付费模型（transport.mode=mock）。
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { workspaceContext } from '../../../../../Back/Edge/src/assistant-receipts.mjs';
import {
  assemble, ledger, recordCase, flushLedger, waitFor,
  SECRET_API_KEY, SECRET_CREDENTIAL, SECRET_CREDENTIAL_B, MATERIAL_TEXT, materialHash,
} from './harness.mjs';

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const receiptsFile = (dir, requestId) =>
  path.join(dir, 'model-state', 'receipts', encodeURIComponent(requestId) + '.json');
const observeAt = (base, customerId, sid, body = {}) =>
  fetch(`${base}/api/jw/v2/actions/customers/${encodeURIComponent(customerId)}/assistant/observe`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-jw-session': sid },
    body: JSON.stringify({ assistant: 'credit', question: '请核对当前候选方案', ...body }),
  });

after(async () => {
  await flushLedger(path.join(path.dirname(fileURLToPath(import.meta.url)), 'qa-ledger.json'));
});

// ── 必测1：合法请求出站一次 ─────────────────────────────────────────────────────────
test('QA02-01 合法observe经真实Edge HTTP出站恰好一次', async (t) => {
  const f = await assemble(t, { tag: 't01-valid' });
  const sid = await f.login(SECRET_CREDENTIAL);
  const r = await f.observePost('qa-cust-1', sid).then(f.tracked);
  const body = r.json;
  assert.equal(r.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.authority, 'none');
  assert.equal(body.model.status, 'simulated');
  assert.equal(body.model.sent, true);
  assert.equal(body.model.replayed, false);
  assert.equal(body.model.current, true);
  assert.ok(body.observations.length >= 1);
  assert.equal(f.standinA.hits(), 1);
  assert.match(f.standinA.captured[0].path, /\/chat\/completions$/);
  assert.match(f.standinA.captured[0].parsedBody.messages[0].content, /\[服务端获准证据包\]/);
  recordCase({ case: 'QA02-01', item: '合法请求出站一次', httpStatus: 200, outbound: 1,
    requestIds: [body.model.requestId], current: body.model.current, verdict: 'pass' });
});

// ── 必测2：相同输入重放不再出站（同进程HTTP重放 + 同回执目录重启Edge持久重放） ──────
test('QA02-02 相同输入重放零出站（HTTP重放+Edge重启持久重放）', async (t) => {
  const f = await assemble(t, { tag: 't02-replay' });
  const sid = await f.login(SECRET_CREDENTIAL);
  const first = await f.observePost('qa-cust-1', sid).then(f.tracked);
  assert.equal(first.json.model.replayed, false);
  const second = await f.observePost('qa-cust-1', sid).then(f.tracked);
  assert.equal(second.status, 200);
  assert.equal(second.json.model.replayed, true);
  assert.equal(second.json.model.requestId, first.json.model.requestId);
  assert.deepEqual(second.json.observations, first.json.observations);
  assert.equal(f.standinA.hits(), 1);
  const reborn = await f.respawn(t); // 新Edge + 新模型实例，同一回执目录
  const third = await observeAt(reborn.base, 'qa-cust-1', sid).then((r) => r.json());
  assert.equal(third.model.replayed, true, '重启后必须持久重放');
  assert.equal(third.model.requestId, first.json.model.requestId);
  assert.equal(f.standinA.hits(), 1);
  recordCase({ case: 'QA02-02', item: '相同输入重放不再出站', httpStatus: 200, outbound: 1,
    requestIds: [first.json.model.requestId], current: first.json.model.current, verdict: 'pass' });
});

// ── 必测3：重复点击并发合并为一次出站（单用例） ─────────────────────────────────────
test('QA02-03 重复点击并发合并为单次出站', async (t) => {
  const f = await assemble(t, { tag: 't03-concurrent' });
  f.standinA.control.delayMs = 150;
  const sid = await f.login(SECRET_CREDENTIAL);
  const responses = await Promise.all(Array.from({ length: 8 }, () => f.observePost('qa-cust-1', sid).then(f.tracked)));
  for (const r of responses) {
    assert.equal(r.status, 200);
    assert.equal(r.json.model.status, 'simulated');
    assert.equal(r.json.model.replayed, false);
  }
  const ids = new Set(responses.map((r) => r.json.model.requestId));
  assert.equal(ids.size, 1);
  assert.equal(f.standinA.hits(), 1);
  recordCase({ case: 'QA02-03', item: '重复点击并发仅一次出站', httpStatus: 200, outbound: 1,
    requestIds: [...ids], current: responses[0].json.model.current, verdict: 'pass' });
});

// ── 必测4：需求/候选/上下文版本/模型配置变化生成独立身份；仅密钥轮换不换身份 ─────────
test('QA02-04 需求/候选/版本/模型配置各自独立身份；密钥轮换不重发', async (t) => {
  const f = await assemble(t, { tag: 't04-identity' });
  const sid = await f.login(SECRET_CREDENTIAL);
  const snap = f.snapshotOf('qa-cust-1', 'qa-tenant-A');
  const post = () => f.observePost('qa-cust-1', sid).then(f.tracked);
  const a = await post();
  assert.equal(a.json.model.replayed, false);

  snap.admission.request = { requestedAmount: 1230000, purpose: '设备扩产' };
  f.store.upsertCustomer('qa-cust-1', snap);
  const b = await post();
  assert.equal(b.json.model.replayed, false);
  assert.notEqual(b.json.model.requestId, a.json.model.requestId);

  snap.admission.candidate = { version: 2, suggestedAmount: 2000000, suggestedTermMonths: 24, tendency: 'cautious_do' };
  f.store.upsertCustomer('qa-cust-1', snap);
  const c = await post();
  assert.equal(c.json.model.replayed, false);
  assert.notEqual(c.json.model.requestId, b.json.model.requestId);

  snap.admission.inputVersion = 2;
  f.store.upsertCustomer('qa-cust-1', snap);
  const d = await post();
  assert.equal(d.json.model.replayed, false);
  assert.notEqual(d.json.model.requestId, c.json.model.requestId);
  assert.equal(f.standinA.hits(), 4);

  // 模型配置变化（模型名）→ configHash 独立 → 新出站；仅密钥轮换 → 身份不变 → 重放零出站。
  const question = '配置身份独立性';
  const modelObserve = (model) => {
    const raw = f.store.getWorkspace('qa-cust-1');
    const ctxSnapshot = raw?.snapshot ?? raw;
    const context = workspaceContext(ctxSnapshot, 'credit');
    return f.evidence({ snapshot: ctxSnapshot, tenantId: 'qa-tenant-A', customerId: 'qa-cust-1', revision: context.contextVersion })
      .then((pack) => { context.evidencePack = pack;
        return model.observe({ customerId: 'qa-cust-1', tenantId: 'qa-tenant-A', assistant: 'credit', question, context }); });
  };
  const e0 = await modelObserve(f.model);
  assert.equal(e0.replayed, false);
  assert.equal(f.standinA.hits(), 5);
  const hashBefore = e0.configHash;
  await f.writeConfig((cfg) => { cfg.transport.mock.model = 'qa-other-model'; });
  const { model: m2 } = await f.respawn(t);
  const e1 = await modelObserve(m2);
  assert.notEqual(e1.configHash, hashBefore);
  assert.equal(e1.replayed, false);
  assert.equal(f.standinA.hits(), 6);
  await f.writeConfig((cfg) => { cfg.transport.mock.apiKey = SECRET_API_KEY + '-rotated'; });
  const { model: m3 } = await f.respawn(t);
  const e2 = await modelObserve(m3);
  assert.equal(e2.configHash, e1.configHash, '仅密钥轮换不得改变配置身份');
  assert.equal(e2.replayed, true);
  assert.equal(f.standinA.hits(), 6, '密钥轮换重放零出站');
  recordCase({ case: 'QA02-04', item: '需求/候选/配置变化独立身份；密钥轮换零出站', httpStatus: 200,
    outbound: 6, requestIds: [a.json.model.requestId, b.json.model.requestId, c.json.model.requestId, d.json.model.requestId, e1.requestId],
    current: true, verdict: 'pass' });
});

// ── 必测5：客户/租户/身份隔离 ───────────────────────────────────────────────────────
test('QA02-05 客户与租户隔离：互不复用回执', async (t) => {
  const f = await assemble(t, { tag: 't05-isolation' });
  f.store.upsertCustomer('qa-cust-2', f.snapshotOf('qa-cust-2', 'qa-tenant-A'));
  const sidA = await f.login(SECRET_CREDENTIAL);
  const sidB = await f.login(SECRET_CREDENTIAL_B);
  const r1 = await f.observePost('qa-cust-1', sidA).then(f.tracked);
  const r2 = await f.observePost('qa-cust-2', sidA).then(f.tracked);
  assert.notEqual(r2.json.model.requestId, r1.json.model.requestId);
  assert.equal(f.standinA.hits(), 2);
  const r3 = await f.observePost('qa-cust-1', sidA).then(f.tracked);
  assert.equal(r3.json.model.replayed, true);
  assert.equal(f.standinA.hits(), 2);
  const r4 = await f.observePost('qa-cust-1', sidB).then(f.tracked); // 同客户不同租户会话
  assert.equal(r4.json.model.replayed, false, '租户B不得复用租户A回执');
  assert.notEqual(r4.json.model.requestId, r1.json.model.requestId);
  assert.notEqual(r4.json.model.contextHash, r1.json.model.contextHash);
  assert.equal(f.standinA.hits(), 3);
  recordCase({ case: 'QA02-05', item: '客户/租户隔离', httpStatus: 200, outbound: 3,
    requestIds: [r1.json.model.requestId, r2.json.model.requestId, r4.json.model.requestId],
    current: true, verdict: 'pass' });
});

// ── 必测6：响应期间上下文变化失效 ───────────────────────────────────────────────────
test('QA02-06 模型等待期间工作本变化：结果失效不披露；变更后新身份新出站', async (t) => {
  const f = await assemble(t, { tag: 't06-stale' });
  const sid = await f.login(SECRET_CREDENTIAL);
  const raw = f.store.getWorkspace('qa-cust-1');
  const snap = raw?.snapshot ?? raw;
  f.standinA.control.onHit = () => {
    snap.admission.scope.revision += 1;
    snap.admission.candidate.version += 1;
    f.store.upsertCustomer('qa-cust-1', snap);
  };
  const r = await f.observePost('qa-cust-1', sid).then(f.tracked);
  assert.equal(r.status, 200);
  assert.equal(r.json.model.current, false, '在途变化必须失效');
  assert.deepEqual(r.json.observations, [], '失效不得披露观察');
  assert.deepEqual(r.json.questions, []);
  assert.ok(r.json.model.usage);
  assert.equal(r.json.model.receiptVersion, 2);
  assert.equal(f.standinA.hits(), 1);
  f.standinA.control.onHit = null; // 停止注入变化，验证“变更后新身份新出站”
  // 上下文已变化：新身份、不假去重、重新出站并如实 current。
  const again = await f.observePost('qa-cust-1', sid).then(f.tracked);
  assert.equal(again.json.model.replayed, false);
  assert.notEqual(again.json.model.requestId, r.json.model.requestId);
  assert.equal(again.json.model.current, true);
  assert.ok(again.json.observations.length >= 1);
  assert.equal(f.standinA.hits(), 2);
  recordCase({ case: 'QA02-06', item: '响应期间上下文变化失效', httpStatus: 200, outbound: 2,
    requestIds: [r.json.model.requestId, again.json.model.requestId], current: [false, true], verdict: 'pass' });
});

// ── 必测7：超时→未知；重试零新增出站 ────────────────────────────────────────────────
test('QA02-07 超时产生unknown且重试零新增出站', async (t) => {
  const f = await assemble(t, { tag: 't07-timeout', timeoutMs: 400 });
  f.standinA.control.delayMs = 3000; // 远超客户端超时
  const sid = await f.login(SECRET_CREDENTIAL);
  const r = await f.observePost('qa-cust-1', sid).then(f.tracked);
  assert.equal(r.status, 200);
  assert.equal(r.json.model.status, 'unknown');
  assert.equal(r.json.model.sent, null);
  assert.equal(r.json.model.current, false);
  assert.equal(r.json.model.error.code, 'RESULT_UNKNOWN_TIMEOUT');
  assert.deepEqual(r.json.observations, []);
  assert.equal(f.standinA.hits(), 1);
  const retry = await f.observePost('qa-cust-1', sid).then(f.tracked);
  assert.equal(retry.json.model.status, 'unknown');
  assert.equal(retry.json.model.replayed, true);
  const reborn = await f.respawn(t);
  const retry2 = await observeAt(reborn.base, 'qa-cust-1', sid).then((x) => x.json());
  assert.equal(retry2.model.status, 'unknown');
  assert.equal(f.standinA.hits(), 1, '未知重试必须零新增出站');
  recordCase({ case: 'QA02-07', item: '超时未知不重发', httpStatus: 200, outbound: 1,
    requestIds: [r.json.model.requestId], current: false, verdict: 'pass' });
});

// ── 必测8：断流/响应体中断→未知；重试零新增出站 ────────────────────────────────────
test('QA02-08 断流与响应体中断产生unknown且不重发', async (t) => {
  const f = await assemble(t, { tag: 't08-drop' });
  const sid = await f.login(SECRET_CREDENTIAL);
  f.standinA.control.mode = 'drop';
  const r = await f.observePost('qa-cust-1', sid).then(f.tracked);
  assert.equal(r.json.model.status, 'unknown');
  assert.equal(r.json.model.error.code, 'RESULT_UNKNOWN_INTERRUPTED');
  assert.equal(f.standinA.hits(), 1);
  const retry = await f.observePost('qa-cust-1', sid).then(f.tracked);
  assert.equal(retry.json.model.status, 'unknown');
  assert.equal(retry.json.model.replayed, true);
  assert.equal(f.standinA.hits(), 1);

  f.standinA.control.mode = 'truncate';
  const r2 = await f.observePost('qa-cust-1', sid, { question: '响应体中断场景' }).then(f.tracked);
  assert.equal(r2.json.model.status, 'unknown');
  assert.equal(r2.json.model.error.code, 'RESULT_UNKNOWN_TRUNCATED');
  assert.equal(f.standinA.hits(), 2);
  const retry2 = await f.observePost('qa-cust-1', sid, { question: '响应体中断场景' }).then(f.tracked);
  assert.equal(retry2.json.model.replayed, true);
  assert.equal(f.standinA.hits(), 2, '未知重试必须零新增出站');
  recordCase({ case: 'QA02-08', item: '断流/中断未知不重发', httpStatus: 200, outbound: 2,
    requestIds: [r.json.model.requestId, r2.json.model.requestId], current: false, verdict: 'pass' });
});

// ── 必测9：格式错误响应fail-closed（确定已发送、不自动重发）＋ 5xx 语义 ─────────────
test('QA02-09 格式错误与5xx：failed如实记录且不自动重发', async (t) => {
  const f = await assemble(t, { tag: 't09-malformed' });
  const sid = await f.login(SECRET_CREDENTIAL);
  f.standinA.control.mode = 'malformed';
  const r = await f.observePost('qa-cust-1', sid).then(f.tracked);
  assert.equal(r.status, 200);
  assert.equal(r.json.model.status, 'failed');
  assert.equal(r.json.model.sent, true);
  assert.equal(r.json.model.error.code, 'RESPONSE_CORRUPTED');
  assert.deepEqual(r.json.observations, []);
  assert.equal(f.standinA.hits(), 1);
  const retry = await f.observePost('qa-cust-1', sid).then(f.tracked);
  assert.equal(retry.json.model.replayed, true);
  assert.equal(retry.json.model.status, 'failed');
  assert.equal(f.standinA.hits(), 1, '损坏产物重放不得重发');

  f.standinA.control.mode = 'status500';
  const r2 = await f.observePost('qa-cust-1', sid, { question: '五百分场景' }).then(f.tracked);
  assert.equal(r2.json.model.status, 'failed');
  assert.equal(r2.json.model.sent, true, '5xx属已处理家族sent=true');
  assert.equal(r2.json.model.error.code, 'upstream_boom', '5xx错误码透传响应体error字段');
  recordCase({ case: 'QA02-09', item: '格式错误/5xx fail-closed', httpStatus: 200, outbound: 2,
    requestIds: [r.json.model.requestId, r2.json.model.requestId], current: false, verdict: 'pass' });
});

// ── 必测10：损坏/旧回执fail closed（经重启的真实Edge HTTP，零新增出站） ─────────────
test('QA02-10 损坏/篡改/残留intent/legacy回执一律fail closed且零出站', async (t) => {
  const f = await assemble(t, { tag: 't10-tamper' });
  const sid = await f.login(SECRET_CREDENTIAL);
  const ok = await f.observePost('qa-cust-1', sid).then(f.tracked);
  const requestId = ok.json.model.requestId;
  assert.equal(ok.json.model.status, 'simulated');
  const terminalPath = receiptsFile(f.dir, requestId);
  const original = await fs.readFile(terminalPath, 'utf8');
  assert.equal(f.standinA.hits(), 1);

  const attempt = async () => {
    const reborn = await f.respawn(t); // 每种损坏都用全新Edge+模型实例读同一回执目录
    return observeAt(reborn.base, 'qa-cust-1', sid).then((r) => r.json());
  };
  const codes = {};
  // 产品回执读层语义：不可解析（'{broken'/'null'）在存储读层抛错 → RECEIPT_OR_TRANSPORT_UNCERTAIN；
  // 可解析但形状非法（outcome 状态/数组违约）→ RECEIPT_CORRUPT。两者都 unknown + fail closed + 零出站。
  for (const kind of ['corrupt', 'bad-shape', 'identity', 'null', 'intent-only']) {
    if (kind === 'corrupt') await fs.writeFile(terminalPath, '{broken');
    if (kind === 'bad-shape') {
      const rec = JSON.parse(original);
      rec.outcome = { status: 'weird', sentFlag: 'not-boolean', findings: 'not-array', questions: [], evidenceRefs: [] };
      await fs.writeFile(terminalPath, JSON.stringify(rec));
    }
    if (kind === 'identity') {
      const rec = JSON.parse(original);
      rec.identity.tenantId = 'qa-tenant-WRONG';
      await fs.writeFile(terminalPath, JSON.stringify(rec));
    }
    if (kind === 'null') await fs.writeFile(terminalPath, 'null');
    if (kind === 'intent-only') await fs.unlink(terminalPath); // 只留 :intent 残留
    const body = await attempt();
    assert.equal(body.model.status, 'unknown', kind + ' 必须unknown');
    assert.equal(body.model.current, false);
    assert.equal(f.standinA.hits(), 1, kind + ' 不得重发');
    codes[kind] = body.model.error.code;
    await fs.writeFile(terminalPath, original); // 复原，进入下一种
  }
  assert.equal(codes.corrupt, 'RECEIPT_OR_TRANSPORT_UNCERTAIN', '不可解析回执=存储读层不确定');
  assert.equal(codes['bad-shape'], 'RECEIPT_CORRUPT', '可解析但形状非法=回执损坏');
  assert.equal(codes.identity, 'RECEIPT_IDENTITY_MISMATCH');
  assert.equal(codes['intent-only'], 'RECOVERED_INTENT_WITHOUT_RECEIPT');

  // 旧格式（legacy id）intent 残留：阻断、零出站、文件保持历史原样。
  const legacyQuestion = 'legacy旧格式分支';
  const legacyId = `amq:qa-cust-1:${sha256(String('0')).slice(0, 8)}::obs:credit:${sha256('credit\n' + legacyQuestion).slice(0, 12)}::a1`;
  const legacyPath = receiptsFile(f.dir, legacyId);
  await fs.mkdir(path.dirname(legacyPath), { recursive: true });
  const legacyRaw = JSON.stringify({ phase: 'intent' });
  await fs.writeFile(legacyPath, legacyRaw);
  const lr = await f.observePost('qa-cust-1', sid, { question: legacyQuestion }).then(f.tracked);
  assert.equal(lr.json.model.status, 'unknown');
  assert.equal(lr.json.model.error.code, 'RECOVERED_INTENT_WITHOUT_RECEIPT');
  assert.equal(f.standinA.hits(), 1, 'legacy intent残留零出站');
  assert.equal(await fs.readFile(legacyPath, 'utf8'), legacyRaw, 'legacy回执保持历史原样');
  recordCase({ case: 'QA02-10', item: '损坏/旧回执fail closed', httpStatus: 200, outbound: 1,
    requestIds: [requestId], current: false, detail: codes, verdict: 'pass' });
});

// ── 必测11：profile切换在途绑定旧配置（仅隔离配置语义） ─────────────────────────────
test('QA02-11 在途请求绑定旧profile；切换后新出站走新配置；回放各自隔离', async (t) => {
  const f = await assemble(t, { tag: 't11-profiles', withProfiles: true });
  const admin = await f.login(SECRET_CREDENTIAL);
  const business = await f.login('qa-credential-nonadmin');

  const activate = (sid, body) =>
    fetch(f.base + '/api/jw/v2/admin/model-profile/activate', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-jw-session': sid },
      body: JSON.stringify(body),
    }).then(f.tracked);
  assert.equal((await activate(business, { id: 'p1', revision: 1 })).status, 403);
  assert.equal((await activate(admin, { id: 'p1', revision: 1, apiKey: 'never-accepted' })).status, 422);
  assert.equal(f.standinA.hits(), 0);

  let release;
  f.standinA.control.hold = new Promise((r) => { release = r; });
  const inflightPromise = f.observePost('qa-cust-1', admin).then(f.tracked);
  assert.ok(await waitFor(() => f.standinA.hits() === 1), '在途请求未抵达替身');
  const switched = await activate(admin, { id: 'p1', revision: 1 });
  assert.equal(switched.status, 200);
  release();
  const inflight = await inflightPromise;
  assert.equal(inflight.status, 200);
  assert.equal(inflight.json.model.profile.id, 'p0', '在途必须绑定旧profile');
  assert.equal(inflight.json.model.status, 'simulated');
  const oldConfigHash = inflight.json.model.configHash;

  const next = await f.observePost('qa-cust-1', admin).then(f.tracked);
  assert.equal(next.json.model.profile.id, 'p1');
  assert.equal(next.json.model.replayed, false);
  assert.equal(f.standinB.hits(), 1);
  assert.notEqual(next.json.model.configHash, oldConfigHash);

  const replayNew = await f.observePost('qa-cust-1', admin).then(f.tracked);
  assert.equal(replayNew.json.model.replayed, true);
  assert.equal(f.standinB.hits(), 1);

  await activate(admin, { id: 'p0', revision: 1 });
  const back = await f.observePost('qa-cust-1', admin).then(f.tracked);
  assert.equal(back.json.model.profile.id, 'p0');
  assert.equal(back.json.model.replayed, true, '切回p0应重放p0回执（配置身份隔离）');
  assert.equal(f.standinA.hits(), 1);

  const reborn = await f.respawn(t);
  assert.equal(reborn.model.status().profile.id, 'p0', '激活态跨重启持久');
  recordCase({ case: 'QA02-11', item: 'profile切换在途绑定旧配置', httpStatus: [403, 422, 200, 200, 200, 200],
    outbound: 2, requestIds: [inflight.json.model.requestId, next.json.model.requestId],
    current: true, verdict: 'pass' });
});

// ── 必测12（profile补充）：发送未知跨profile仍阻断 ─────────────────────────────────
test('QA02-12 发送状态未知时切换profile不解除防重发', async (t) => {
  const f = await assemble(t, { tag: 't12-profile-unknown', withProfiles: true });
  const admin = await f.login(SECRET_CREDENTIAL);
  f.standinA.control.mode = 'drop';
  const r = await f.observePost('qa-cust-1', admin).then((x) => x.json());
  assert.equal(r.model.status, 'unknown');
  const activate = (body) => fetch(f.base + '/api/jw/v2/admin/model-profile/activate', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-jw-session': admin },
    body: JSON.stringify(body) }).then((x) => x.json());
  assert.equal((await activate({ id: 'p1', revision: 1 })).active.id, 'p1');
  const blocked = await f.observePost('qa-cust-1', admin).then((x) => x.json());
  assert.equal(blocked.model.status, 'unknown');
  assert.equal(blocked.model.error.code, 'PROFILE_SEND_UNRESOLVED');
  assert.equal(f.standinB.hits(), 0);
  const reborn = await f.respawn(t);
  const still = await observeAt(reborn.base, 'qa-cust-1', admin).then((x) => x.json());
  assert.equal(still.model.error.code, 'PROFILE_SEND_UNRESOLVED');
  assert.equal(f.standinA.hits(), 1);
  assert.equal(f.standinB.hits(), 0);
  recordCase({ case: 'QA02-12', item: '未知跨profile阻断', httpStatus: 200, outbound: 1,
    requestIds: [r.model.requestId], current: false, verdict: 'pass' });
});

// ── 必测13：捕获请求正文确认获准证据与上下文限制 ───────────────────────────────────
test('QA02-13 请求正文含获准证据且不含注入事实/凭据；超限证据失败关闭', async (t) => {
  const f = await assemble(t, { tag: 't13-evidence', configMaxContextChars: 6000 });
  const sid = await f.login(SECRET_CREDENTIAL);
  const r = await f.observePost('qa-cust-1', sid, { facts: '恶意浏览器事实（浏览器注入）' }).then(f.tracked);
  assert.equal(r.status, 200);
  assert.equal(r.json.model.current, true);
  const captured = f.standinA.captured[0];
  const prompt = captured.parsedBody.messages[0].content;
  assert.match(prompt, /\[服务端获准证据包\]/);
  assert.ok(prompt.includes(MATERIAL_TEXT), '获准原文必须进包');
  assert.ok(!prompt.includes('恶意浏览器事实'), '浏览器注入事实不得进提示词');
  assert.ok(!prompt.includes(SECRET_API_KEY), '配置密钥不得进提示词');
  assert.ok(!prompt.includes(SECRET_CREDENTIAL), '会话凭据不得进提示词');
  assert.ok(prompt.length <= 6000, '提示词须受maxContextChars约束');
  assert.equal(captured.headers.authorization, undefined, 'mock出站不携带凭据头');
  // 伪造引用由服务端降级：仅保留有据观察，伪造观察转为待核验问题。
  assert.equal(r.json.observations.length, 1);
  assert.equal(r.json.observations[0].citationStatus, 'source_bound');
  assert.ok(r.json.questions.some((q) => String(q.text ?? q).includes('伪造引用')), '伪造引用应降级为待核验');
  assert.equal(r.json.model.citationChecks.filter((c) => !c.valid).length, 1);
  assert.equal(r.json.evidenceRefs[0].hash, materialHash());

  // 超限证据故障注入：模型侧失败关闭、零出站。
  const g = await assemble(t, { tag: 't13-oversize', oversizedEvidence: true });
  const gsid = await g.login(SECRET_CREDENTIAL);
  const gr = await g.observePost('qa-cust-1', gsid).then(f.tracked);
  assert.equal(gr.status, 200);
  assert.equal(gr.json.model.status, 'failed');
  assert.equal(gr.json.model.sent, false);
  assert.equal(gr.json.model.error.code, 'EVIDENCE_CONTEXT_LIMIT');
  assert.equal(g.standinA.hits(), 0, '超限证据必须零出站');
  recordCase({ case: 'QA02-13', item: '获准证据与上下文限制', httpStatus: 200, outbound: 1,
    requestIds: [r.json.model.requestId], current: true, note: '超限注入零出站', verdict: 'pass' });
});

// ── 必测14：凭据不出现在业务响应、日志、审计、回执与替身请求 ────────────────────────
test('QA02-14 凭据金丝雀不出现在响应/日志/审计/回执/替身请求', async (t) => {
  const f = await assemble(t, { tag: 't14-leak' });
  const sess = await fetch(f.base + '/api/jw/v2/session', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ credential: SECRET_CREDENTIAL }),
  }).then(f.tracked);
  assert.equal(sess.status, 200);
  const sid = sess.json.session.sessionId;
  await f.observePost('qa-cust-1', sid).then(f.tracked);
  await f.observePost('qa-cust-1', sid).then(f.tracked);
  await f.observePost('qa-cust-1', sid, { question: '第二个问题用于扩大采样' }).then(f.tracked);

  const scanTargets = [];
  for (const [name, text] of [
    ['edge-responses', JSON.stringify(f.responses)],
    ['edge-logs', f.logs.join('\n')],
    ['audit', JSON.stringify(f.audit.list({ limit: 500 }))],
  ]) scanTargets.push([name, text]);
  // 回执/决策/成本账本目录逐文件扫描（配置文件本身允许持有密钥，不在扫描范围）。
  for (const sub of ['model-state', 'decision-feedback']) {
    const root = path.join(f.dir, sub);
    let entries = [];
    try { entries = await fs.readdir(root, { recursive: true }); } catch { /* 不存在则跳过 */ }
    for (const rel of entries) {
      const full = path.join(root, rel);
      const stat = await fs.stat(full).catch(() => null);
      if (stat?.isFile()) scanTargets.push([`${sub}/${rel}`, await fs.readFile(full, 'utf8').catch(() => '')]);
    }
  }
  scanTargets.push(['cost-ledger', await fs.readFile(path.join(f.dir, 'cost-ledger.jsonl'), 'utf8').catch(() => '')]);
  for (const cap of f.standinA.captured) {
    scanTargets.push(['standin-headers', JSON.stringify(cap.headers)]);
    scanTargets.push(['standin-body', cap.rawBody]);
  }
  const leaks = [];
  for (const [name, text] of scanTargets) {
    for (const secret of [SECRET_API_KEY, SECRET_CREDENTIAL, SECRET_CREDENTIAL_B]) {
      if (text?.includes(secret)) leaks.push(`${name} contains ${secret}`);
    }
  }
  assert.deepEqual(leaks, []);
  // 会话换响应只含不透明会话，不回显凭据原文。
  assert.ok(!f.responses[0].text.includes(SECRET_CREDENTIAL));
  assert.ok(JSON.stringify(sess.json.session).includes('sessionId'));
  recordCase({ case: 'QA02-14', item: '凭据不出现在业务响应与日志', httpStatus: 200, outbound: 2,
    requestIds: [], current: true, scanned: scanTargets.length, verdict: 'pass' });
});

// ── 必测15：候选API（decisions）协议与调用控制采样 ─────────────────────────────────
test('QA02-15 候选API：排序/幂等重放/反馈/非法输入零出站/失效', async (t) => {
  const f = await assemble(t, { tag: 't15-decisions', contentType: 'decisions', decisionRepository: true });
  const sid = await f.login(SECRET_CREDENTIAL);
  const get = () => fetch(f.base + '/api/jw/v2/customers/qa-cust-1/assistant/decisions?assistant=credit',
    { headers: { 'x-jw-session': sid } }).then(f.tracked);
  const post = (body, suffix = '') => fetch(f.base + '/api/jw/v2/actions/customers/qa-cust-1/assistant/decisions' + suffix,
    { method: 'POST', headers: { 'content-type': 'application/json', 'x-jw-session': sid }, body: JSON.stringify(body) }).then(f.tracked);

  const empty = await get();
  assert.equal(empty.status, 200);
  assert.equal(empty.json.latest, null);
  const analyze = { assistant: 'credit', operationId: 'analyze_qa001', expectedRevision: 0, question: '下一步核对什么？' };
  const first = await post(analyze);
  assert.equal(first.status, 200);
  assert.equal(first.json.latest.current, true);
  assert.equal(first.json.latest.candidates[0].id, 'duplicate', '候选按支持把握降序');
  assert.equal(first.json.latest.taskKind, 'next_action');
  assert.ok(first.json.latest.model.requestId);
  assert.equal(f.standinA.hits(), 1);
  const replay = await post(analyze);
  assert.equal(replay.json.replayed, true);
  assert.equal(f.standinA.hits(), 1, '同operationId重放零出站');
  const fb = { ...analyze, operationId: 'feedback_qa01', expectedRevision: first.json.revision,
    decisionSetId: first.json.latest.id, action: 'select', candidateId: 'period', reason: '先核实期间' };
  const selected = await post(fb, '/feedback');
  assert.equal(selected.status, 200);
  assert.equal(selected.json.latest.feedback.candidateId, 'period');
  const badCand = await post({ ...fb, operationId: 'feedback_qa02', candidateId: 'invented' }, '/feedback');
  assert.equal(badCand.status, 400);
  const badKind = await post({ ...analyze, operationId: 'analyze_qa002', expectedRevision: selected.json.revision, taskKind: 'bogus' });
  assert.equal(badKind.status, 400);
  assert.equal(badKind.json.error, 'INVALID_TASK_KIND');
  assert.equal(f.standinA.hits(), 1, '非法输入零出站');
  const raw = f.store.getWorkspace('qa-cust-1');
  const snap = raw?.snapshot ?? raw;
  snap.admission.inputVersion += 1;
  f.store.upsertCustomer('qa-cust-1', snap);
  const stale = await get();
  assert.equal(stale.json.latest.current, false);
  assert.deepEqual(stale.json.latest.candidates, []);
  recordCase({ case: 'QA02-15', item: '候选API协议与调用控制', httpStatus: [200, 200, 200, 400, 400],
    outbound: 1, requestIds: [first.json.latest.model.requestId], current: [true, false], verdict: 'pass' });
});
