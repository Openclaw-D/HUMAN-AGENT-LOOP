import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { render, screen, fireEvent, waitFor, cleanup } from './harness.mjs';
const React = (await import('react')).default;
const { DecisionFeedbackPanel } = await import('../../../site-mirror/app/takeoff/decision-feedback-panel.tsx');
const { createWbClient } = await import('../../../site-mirror/lib/workbench/wb-client.ts');

async function fixture(t) {
  const snapshot = { customer: { customerId: 'c' }, admission: { inputVersion: 1 } };
  const data = { ok: true, authority: 'none', customerId: 'c', assistant: 'credit', revision: 2, pending: null,
    latest: { id: 'set', question: '先核对什么？', valid: true, current: true, at: '2026-09-20T10:00:00Z', omitted: [], feedback: null, feedbackUsed: null,
      candidates: [
        { id: 'a', label: '先统一期间', impact: '核对起止日期', confidence: .8, confidenceKind: 'model_estimate_uncalibrated', evidenceRefIds: ['r'] },
        { id: 'b', label: '先核对重复交易', impact: '核对交易记录', confidence: .6, confidenceKind: 'model_estimate_uncalibrated', evidenceRefIds: ['r'] },
        { id: 'c', label: '请专业人员核对', impact: '保留原件', confidence: null, confidenceKind: 'model_estimate_uncalibrated', evidenceRefIds: ['r'] },
      ], evidenceRefs: [{ id: 'r', artifactId: 'original', hash: 'a'.repeat(64), parserVersion: 'v1', text: '合成材料', locator: { kind: 'extracted_text', start: 0, end: 4 } }],
      model: { status: 'simulated', contextVersion: '1', source: { model: 'test' } },
    } };
  const state = { saves: [], analyses: [], drop: false, malformed: false };
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const c of req) raw += c;
    const body = raw ? JSON.parse(raw) : null;
    const send = value => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(value)); };
    if (req.url.endsWith('/workspace')) return send({ ok: true, snapshot });
    if (req.method === 'POST' && req.url.endsWith('/feedback')) {
      state.saves.push(body); data.revision++;
      data.latest.feedback = body.action === 'undo' ? null : { action: body.action, candidateId: body.candidateId,
        label: body.action === 'none' ? '均不合适' : data.latest.candidates.find(c => c.id === body.candidateId).label,
        reason: body.reason, eventId: body.operationId, at: 'now' };
      if (state.drop) { req.socket.destroy(); return; }
    } else if (req.method === 'POST') state.analyses.push(body);
    if (state.malformed) return send({ ...data, customerId: 'someone-else' });
    send(data);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => { cleanup(); server.closeAllConnections(); return new Promise(r => server.close(r)); });
  const client = createWbClient({ baseUrl: `http://127.0.0.1:${server.address().port}` });
  client.inner.adoptSession({ sessionId: 'test-session', principalId: 'person', roles: ['credit'], expiresAt: Date.now() + 60000 });
  const wb = { client, customerId: 'c', session: client.session, snapshot };
  const component = () => React.createElement(DecisionFeedbackPanel, { wb, assistant: 'credit' });
  return { data, state, wb, snapshot, component };
}

test('StrictMode mount replay still finishes reading suggestions without starting an analysis',async t=>{
  const f=await fixture(t);
  render(React.createElement(React.StrictMode,null,f.component()));
  await screen.findByRole('button',{name:/先统一期间.*80%/});
  assert.equal(screen.getByRole('button',{name:'更新建议'}).disabled,false);
  assert.equal(f.state.analyses.length,0);
});

test('default recommendation causes no write; click persists, readback restores selection, undo is explicit', async t => {
  const f = await fixture(t); const view = render(f.component());
  const first = await screen.findByRole('button', { name: /先统一期间.*80%/ });
  assert.equal(first.getAttribute('aria-pressed'), 'true'); assert.equal(f.state.saves.length, 0);
  assert.ok(screen.getByText('置信度未提供')); assert.ok(screen.getByText(/尚未校准/));
  fireEvent.change(screen.getByLabelText('候选选择理由'), { target: { value: '先核对交易' } });
  fireEvent.click(screen.getByRole('button', { name: /先核对重复交易.*60%/ }));
  await screen.findByText('已从服务端读回反馈。');
  assert.equal(f.state.saves.length, 1); assert.equal(f.state.saves[0].candidateId, 'b');
  assert.equal(f.state.saves[0].reason, '先核对交易');
  view.unmount(); render(f.component());
  await screen.findByText('你的选择 · 已记录');
  assert.equal(screen.getByRole('button', { name: /先核对重复交易.*60%/ }).getAttribute('aria-pressed'), 'true');
  fireEvent.click(screen.getByRole('button', { name: '撤销我的选择' }));
  await waitFor(() => assert.ok(screen.queryByText('你的选择 · 已记录') === null));
  assert.equal(f.state.saves[1].action, 'undo'); assert.equal(f.state.analyses.length, 0);
});

test('lost feedback response locks writes until readback; no automatic retry or fake learning', async t => {
  const f = await fixture(t); f.state.drop = true; render(f.component());
  fireEvent.click(await screen.findByRole('button', { name: /先核对重复交易.*60%/ }));
  await screen.findByText(/本次结果尚未确认/);
  assert.ok(screen.getByRole('button', { name: /先统一期间.*80%/ }).disabled);
  assert.equal(f.state.saves.length, 1);
  fireEvent.click(screen.getByRole('button', { name: '刷新建议' }));
  await screen.findByText('你的选择 · 已记录'); assert.equal(f.state.saves.length, 1);
});

test('changed evidence hides old candidates; mismatched customer response is rejected', async t => {
  const f = await fixture(t); const view = render(f.component());
  await screen.findByRole('button', { name: /先统一期间.*80%/ });
  f.wb.snapshot = { ...f.snapshot, admission: { inputVersion: 2 } };
  view.rerender(f.component());
  assert.ok(screen.queryByRole('button', { name: /先统一期间.*80%/ }) === null);
  assert.ok(screen.getByText(/旧候选不可选择/)); assert.equal(f.state.saves.length, 0);
  view.unmount(); f.state.malformed = true; render(f.component());
  await screen.findByText(/返回内容未通过核对/); assert.ok(screen.queryByText('你的选择 · 已记录') === null);
});



test('opening customer waits for workspace before validating current suggestions', async t => {
  const f = await fixture(t); f.wb.snapshot = null;
  const view = render(f.component());
  assert.equal(screen.queryByRole('button', { name: /先统一期间.*80%/ }), null);
  f.wb.snapshot = f.snapshot; view.rerender(f.component());
  await screen.findByRole('button', { name: /先统一期间.*80%/ });
  assert.equal(screen.queryByText(/旧候选不可选择/), null);
  assert.equal(f.state.analyses.length, 0, '工作台就绪只读回已有结果，不触发付费调用');
});
