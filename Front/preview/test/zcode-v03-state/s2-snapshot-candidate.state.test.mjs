// V0.3-Z4 场景2 独立回归（ZCODE 并行QA·只读产品源码）：
// 1) 首次snapshot异步到达：快照为空时不得发起候选读取；快照到达（anchor变化）后自动读取，
//    合法的当前（current=true）候选最终能读回并可点选；
// 2) 过期候选不因重新渲染变有效：anchor变化后旧候选立即不可选（重读在途窗口），
//    纯重渲染不能复活旧候选、不重发请求；新anchor的合法集合恢复后才重新可选；
// 3) 服务端已过期（latest.current=false）的集合不渲染为可选；
// 4) 迟到响应被核对拒绝：anchor在途变化后返回的旧集合不得覆盖展示，点选反馈零发出。
import test from 'node:test';
import assert from 'node:assert/strict';
import { render, screen, waitFor, cleanup } from '../behavior/harness.mjs';

const React = (await import('react')).default;
const { DecisionFeedbackPanel } = await import('../../../site-mirror/app/takeoff/decision-feedback-panel.tsx');

const CID = 'cus_a';
const HASH = 'ab'.repeat(32);

function snapshotWith({ candidateVersion = 2 } = {}) {
  return {
    customer: { customerId: CID, displayName: '测试客户', status: 'active' },
    assessments: [{ assessmentId: 'asm_1', status: 'candidate_ready', version: 5 }],
    admission: {
      scope: { assessmentId: 'asm_1', revision: 5 },
      inputVersion: 3,
      candidate: { version: candidateVersion, suggestedAmount: 50_000_000, tendency: 'do', isCurrent: true },
    },
    decisionStatus: { basis: { packageId: 'pkg_1', revision: 3, status: 'frozen' } },
  };
}

function decisionResponse({ customerId = CID, current = true, labelA = '补齐设备权属登记' } = {}) {
  return {
    ok: true, authority: 'none', customerId, assistant: 'credit', revision: 3,
    pending: null,
    latest: {
      id: 'ds_1', question: '基于当前材料，下一步优先核对什么？', current, valid: true, at: '2026-09-21T01:00:00.000Z',
      candidates: current ? [
        { id: 'c1', label: labelA, confidence: 0.72, impact: '触发条件：权属材料到件', evidenceRefIds: ['e1'], confidenceKind: 'model_estimate_uncalibrated' },
        { id: 'c2', label: '先回答补证问题', confidence: 0.41, impact: '触发条件：收到开放问题', evidenceRefIds: ['e1'], confidenceKind: 'model_estimate_uncalibrated' },
      ] : [],
      evidenceRefs: [{
        id: 'e1', artifactId: 'art_1', hash: HASH, parserVersion: 'pdf-v1',
        text: 'D01 设备权属登记证明 主体：测试客户',
        locator: { kind: 'page_text', page: 2, start: 0, end: 'D01 设备权属登记证明 主体：测试客户'.length },
      }],
      omitted: [],
      feedback: null, feedbackUsed: null,
      model: { status: 'succeeded', contextVersion: '3', requestId: 'req_1', source: { model: 'glm-5.2', mode: 'live' }, error: null },
    },
  };
}

/** wb 替身：DecisionFeedbackPanel 只消费 client/customerId/snapshot。current.snapshot 代表服务端侧最新工作台（workspace 读回）。 */
function makeWb(initialSnapshot) {
  const current = { snapshot: initialSnapshot };
  const calls = { readDecisions: [], analyzeDecisions: [], saveDecisionFeedback: [], workspace: [] };
  const client = {
    session: { sessionId: 'sess-1', principalId: 'credit-1', roles: ['credit'], expiresAt: Date.now() + 3_600_000 },
    async readDecisions(customerId, assistant) { calls.readDecisions.push({ customerId, assistant }); return decisionResponse({ customerId }); },
    async analyzeDecisions(customerId, body) { calls.analyzeDecisions.push(body); return decisionResponse({ customerId }); },
    async saveDecisionFeedback(customerId, body) { calls.saveDecisionFeedback.push(body); return { ok: true }; },
    async workspace(customerId) { calls.workspace.push(customerId); return { snapshot: current.snapshot, snapshotVersion: 1, projection: { notes: [] } }; },
  };
  const base = {
    client, phase: 'live', customerId: CID, snapshotVersion: 1, notes: [], error: null, lastEvent: null,
    identities: null, buildId: 'test',
    setError: () => {}, refresh: async () => {},
  };
  const wbFor = (snapshot) => ({ ...base, snapshot });
  return { wbFor, calls, setServerSnapshot: (s) => { current.snapshot = s; } };
}

const candidateGroup = () => screen.queryByRole('group', { name: '选择候选建议' });
const groupCards = () => Array.from(candidateGroup().querySelectorAll('button.tk-decision-card'));

test('首次snapshot异步到达：空快照不发起候选读取；快照到达后合法当前候选最终读回', async (t) => {
  t.after(cleanup);
  const { wbFor, calls, setServerSnapshot } = makeWb(null);
  const view = render(React.createElement(DecisionFeedbackPanel, { wb: wbFor(null), assistant: 'credit' }));
  assert.match(screen.getByRole('status').textContent, /正在读取候选与反馈/);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(calls.readDecisions.length, 0, '无快照不得发起候选读取');
  assert.equal(candidateGroup(), null, '无快照不得渲染候选');

  // 首次快照异步到达（anchor 从空变为有值）→ 面板自动读取并展示；服务端 workspace 同步到该快照
  const snapA = snapshotWith({ candidateVersion: 2 });
  view.rerender(React.createElement(DecisionFeedbackPanel, { wb: wbFor(snapA), assistant: 'credit' }));
  setServerSnapshot(snapA);
  await waitFor(() => assert.ok(candidateGroup(), '快照到达后候选最终读回'));
  assert.equal(calls.readDecisions.length, 1);
  assert.deepEqual(calls.readDecisions[0], { customerId: CID, assistant: 'credit' });
  const cards = groupCards();
  assert.equal(cards.length, 2);
  assert.equal(cards[0].getAttribute('aria-pressed'), 'true', '默认首选=第一候选');
  assert.match(cards[0].textContent, /建议首选/);
  for (const c of cards) assert.equal(c.disabled, false, '当前合法候选可点选');
  assert.match(cards[0].textContent, /72%/, '置信度按未校准估计展示');
  assert.ok(screen.getByText(/置信度为模型估计，尚未校准/), '未校准置信度说明可见');
});

test('过期候选不因重新渲染变有效：anchor变化后旧候选立即不可选，重渲染不复活、不重发请求', async (t) => {
  t.after(cleanup);
  const snapA = snapshotWith({ candidateVersion: 2 });
  const snapB = snapshotWith({ candidateVersion: 3 });
  const { wbFor, calls, setServerSnapshot } = makeWb(snapA);
  const view = render(React.createElement(DecisionFeedbackPanel, { wb: wbFor(snapA), assistant: 'credit' }));
  await waitFor(() => assert.ok(candidateGroup()));
  assert.match(groupCards()[0].textContent, /补齐设备权属登记/, 'A版候选在展示');
  assert.equal(calls.readDecisions.length, 1);

  // 重读改为可控慢速：anchor变化触发的重读（包装后第一次调用）在途期间，旧候选必须先变成不可选
  let resolveSlow;
  let gate = 0;
  const clientSlow = wbFor(snapB).client; // 与 base 共享同一 client 对象
  const origRead = clientSlow.readDecisions;
  clientSlow.readDecisions = async (customerId, assistant) => {
    gate += 1;
    if (gate === 1) return new Promise((resolve) => { resolveSlow = resolve; });
    return origRead(customerId, assistant);
  };
  // anchor变化：同一组件实例重渲染（无人工刷新点击）
  view.rerender(React.createElement(DecisionFeedbackPanel, { wb: wbFor(snapB), assistant: 'credit' }));
  await waitFor(() => assert.match(screen.getByRole('status').textContent, /旧候选不可选择/));
  assert.equal(candidateGroup(), null, '重读在途期间过期候选不渲染为可选');
  assert.equal(calls.saveDecisionFeedback.length, 0, '过期窗口内不产生反馈写请求');
  assert.equal(calls.analyzeDecisions.length, 0);

  // 服务端按新anchor给出新集合（workspace 同步到新快照）→ 新候选恢复可选，旧候选不回来
  setServerSnapshot(snapB);
  resolveSlow(decisionResponse({ labelA: 'B版新建议' }));
  await waitFor(() => assert.ok(candidateGroup(), '新anchor的合法候选恢复读回'));
  assert.match(groupCards()[0].textContent, /B版新建议/);
  assert.equal(screen.queryByText(/补齐设备权属登记/), null, '旧候选标签不随新集合回归');

  // 纯重渲染（同一anchor）反复发生：不重发读取，展示保持新集合
  const readsAfterRecovery = calls.readDecisions.length;
  view.rerender(React.createElement(DecisionFeedbackPanel, { wb: wbFor(snapB), assistant: 'credit' }));
  view.rerender(React.createElement(DecisionFeedbackPanel, { wb: wbFor(snapB), assistant: 'credit' }));
  assert.equal(calls.readDecisions.length, readsAfterRecovery, '纯重渲染不重发读取');
  assert.match(groupCards()[0].textContent, /B版新建议/);
  assert.equal(calls.saveDecisionFeedback.length, 0);
  assert.equal(calls.analyzeDecisions.length, 0, '过期状态从未触发新的模型分析');
});

test('服务端已过期的候选集合（latest.current=false）不渲染为可选', async (t) => {
  t.after(cleanup);
  const { wbFor, calls } = makeWb(snapshotWith({ candidateVersion: 2 }));
  const base = wbFor(snapshotWith({ candidateVersion: 2 }));
  base.client.readDecisions = async () => decisionResponse({ current: false });
  render(React.createElement(DecisionFeedbackPanel, { wb: base, assistant: 'credit' }));
  await waitFor(() => assert.match(screen.getByRole('status').textContent, /旧候选不可选择/));
  assert.equal(candidateGroup(), null, '服务端过期集合无候选卡片');
  assert.equal(calls.saveDecisionFeedback.length, 0);
});

test('迟到响应被核对拒绝：anchor在途变化后返回的旧集合不得覆盖展示，也不得选中', async (t) => {
  t.after(cleanup);
  const snapA = snapshotWith({ candidateVersion: 2 });
  const snapB = snapshotWith({ candidateVersion: 3 });
  const { wbFor, calls, setServerSnapshot } = makeWb(snapA);
  const base = wbFor(snapA);
  let resolveFirst;
  const firstPromise = new Promise((r) => { resolveFirst = r; });
  let gate = 0;
  base.client.readDecisions = async () => {
    gate += 1;
    return gate === 1 ? firstPromise : decisionResponse({ labelA: 'B版当前建议' });
  };
  const view = render(React.createElement(DecisionFeedbackPanel, { wb: base, assistant: 'credit' }));
  await waitFor(() => assert.equal(gate, 1, '第一次读取已发出'));

  // 读取在途时快照推进（anchor变化）→ effect 重读（第二次）；workspace 同步到新快照
  view.rerender(React.createElement(DecisionFeedbackPanel, { wb: wbFor(snapB), assistant: 'credit' }));
  setServerSnapshot(snapB);
  await waitFor(() => assert.ok(candidateGroup(), '第二次读取（当前anchor）展示B版候选'));
  assert.match(groupCards()[0].textContent, /B版当前建议/);

  // 迟到的A版集合此刻才返回：不得覆盖B版展示
  resolveFirst(decisionResponse({ labelA: 'A版过期建议' }));
  await new Promise((r) => setTimeout(r, 30));
  assert.match(groupCards()[0].textContent, /B版当前建议/, '迟到旧集合不覆盖当前展示');
  assert.equal(screen.queryByText(/A版过期建议/), null);
  assert.equal(calls.saveDecisionFeedback.length, 0);
});
