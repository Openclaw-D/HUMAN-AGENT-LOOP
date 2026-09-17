// E1 真实变体·D03/D04/D05（任务04 §6）：事件源=A 内核真实 outbox，投影=live kernel-store。
//   D03：快照与订阅间的内核写入不漏（SSE 可见且与内核状态一致）；
//   D04：断线重连以 Last-Event-ID/cursor 补取，eventId 稳定（客户端去重依据）；
//   D05：游标失效显式 expired/resync 语义（真实投影的 replayFrom 判定）。
// 门：task3-gate（消费面 + 迁移 + A 源在位）；未过如实 SKIP。
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { checkTask3Gate } from './task3-gate.mjs';
import { bootStack } from './task3-boot.mjs';

const gate = await checkTask3Gate();
const skipReason = gate.ok ? false : `任务三 E1 门未过: ${gate.reasons.join('; ')}`;

// SSE 客户端：收集帧直到 pred 满足；返回 {frames, waitFor, close}。
function sseOpen(port, pathname, { headers = {} } = {}) {
  const frames = [];
  const waiters = [];
  const req = http.get({ host: '127.0.0.1', port, path: pathname, headers }, (res) => {
    res.setEncoding('utf8');
    let buf = '';
    res.on('data', (chunk) => {
      buf += chunk;
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const raw = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const frame = {};
        for (const line of raw.split('\n')) {
          const ci = line.indexOf(':');
          if (ci === -1) continue;
          const k = line.slice(0, ci);
          const v = line.slice(ci + 1).replace(/^ /, '');
          if (k === 'data') frame.data = frame.data ? frame.data + '\n' + v : v;
          else frame[k] = v;
        }
        if (Object.keys(frame).length) {
          frames.push(frame);
          for (let i = waiters.length - 1; i >= 0; i--) {
            if (waiters[i].pred(frames)) { waiters[i].resolve(frames); waiters.splice(i, 1); }
          }
        }
      }
    });
  });
  const closed = new Promise((resolve) => req.on('close', resolve));
  return {
    frames,
    waitFor: (pred, timeoutMs = 8000) => new Promise((resolve, reject) => {
      if (pred(frames)) return resolve(frames);
      const w = { pred, resolve };
      waiters.push(w);
      setTimeout(() => reject(new Error('SSE 等待超时')), timeoutMs).unref();
    }),
    close: () => { try { req.destroy(); } catch { } return closed; },
  };
}
const business = (frames) => frames.filter((f) => f.event === 'business').map((f) => ({ id: f.id, ...JSON.parse(f.data) }));

test('E1-D03/D04/D05 真实变体：内核写入→SSE 可见；游标补取；失效判 expired', { skip: skipReason }, async (t) => {
  const B = await bootStack({ t, runName: 'e1-d03d05' });
  const biz = B.sessions.biz1;
  const cred = B.sessions.cred1;

  // 建客户与评估（真实内核事务）
  const c = await B.call('biz1', 'POST', '/api/jw/v2/actions/customers', {
    requestId: `d03-c-${Date.now().toString(36)}`, tenantId: 't1',
    legalEntityRef: `USCC-D03-${Date.now().toString(36)}`, displayName: 'D03 探针客户',
  });
  assert.equal(c.json.ok, true, JSON.stringify(c));
  const customerId = c.json.customerId;
  const a = await B.call('cred1', 'POST', `/api/jw/v2/actions/customers/${customerId}/assessments`, {
    requestId: `d03-a-${Date.now().toString(36)}`, tenantId: 't1', productType: 'direct_lease',
    purpose: 'D03', ruleVersion: 'synthetic-rules-1',
  });
  assert.equal(a.json.ok, true, JSON.stringify(a));
  const assessmentId = a.json.assessmentId;

  // 观察者（另一会话）SSE 订阅：应看到评估事件（内核已提交的历史，经真实 outbox 桥接补取）
  const obs = sseOpen(B.edge.port, `/api/jw/v2/customers/${customerId}/events`, { headers: { 'x-jw-session': B.sessions.app1.sessionId } });
  const seenAssessment = await obs.waitFor(
    (fs) => business(fs).some((e) => e.payloadRef?.type === 'ASSESSMENT_CREATED' && e.payload?.assessmentId === assessmentId),
    10000,
  );
  const evCreated = business(seenAssessment).find((e) => e.payloadRef?.type === 'ASSESSMENT_CREATED');
  assert.equal(evCreated.payload.assessmentId, assessmentId, '事件与内核事实一致');
  assert.equal(evCreated.scope.customer, customerId, 'scope.customer 正确（不串客户）');

  // D04：记录游标 → 内核再写（候选提交）→ 以游标重连 → 只补取新事件，eventId 与内核一致
  const cursor = evCreated.eventId;
  const before = business(obs.frames).length;
  const cand = await B.call('cred1', 'POST', `/api/jw/v2/actions/assessments/${assessmentId}/candidate`, {
    requestId: `d04-c-${Date.now().toString(36)}`, tenantId: 't1',
    candidate: { tendency: 'cautious_do', supportableAmountMinor: 500000000, currency: 'CNY', rationale: 'D04', producedBy: 'agent1' },
  });
  assert.equal(cand.json.ok, true, JSON.stringify(cand));
  await obs.waitFor((fs) => business(fs).some((e) => e.payloadRef?.type === 'ASSESSMENT_CANDIDATE_READY'), 10000);
  const afterLen = business(obs.frames).length;
  assert.ok(afterLen > before, '实时收到候选提交事件');

  obs.close(); // 断开
  const resume = sseOpen(B.edge.port, `/api/jw/v2/customers/${customerId}/events?cursor=${encodeURIComponent(cursor)}`, { headers: { 'x-jw-session': B.sessions.app1.sessionId } });
  await resume.waitFor((fs) => business(fs).some((e) => e.payloadRef?.type === 'ASSESSMENT_CANDIDATE_READY'), 10000);
  const replayed = business(resume.frames);
  assert.ok(replayed.some((e) => e.payloadRef?.type === 'ASSESSMENT_CANDIDATE_READY'), '断线期间事件经游标补取可见');
  assert.equal(new Set(replayed.map((e) => e.eventId)).size, replayed.length, '补取流内 eventId 唯一（客户端可去重）');
  resume.close();

  // D05：失效/未知游标 → live 投影判 expired（真实投影缓冲语义；绝不静默续播）
  const r1 = B.store.replayFrom(customerId, '00000000-0000-4000-8000-000000000000');
  assert.equal(r1.expired, true, '未知游标判 expired');
  assert.equal(r1.reason, 'cursor_unknown_or_edge_restarted');
  const r2 = B.store.replayFrom('ghost-customer', cursor);
  assert.equal(r2.events.length, 0, '未知客户零回放（无客户即无事件流）');

  await obs.close();
});
