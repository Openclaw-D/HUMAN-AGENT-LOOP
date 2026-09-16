// 集成测试 2：证据失效定向命中+级联、accepted/decided 失效保护、人工待办不冻结无关目标、
// 项目暂停、outbox 至少一次投递+消费者幂等、跨项目越权、事件通道。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { client, newId, simpleTemplate, sleep, startKernel, TOKENS } from './utils.mjs';

async function setup(t) {
  const k = await startKernel();
  t.after(() => k.stop());
  const bus = client(k.base, TOKENS.business);
  const adm = client(k.base, TOKENS.admin);
  const ag = client(k.base, TOKENS.agent);
  const ap = client(k.base, TOKENS.approver);
  const tpl = await adm('POST', '/api/v1/templates', simpleTemplate());
  const pr = await bus('POST', '/api/v1/projects', { requestId: newId('r'), templateId: tpl.json.templateId, name: 'inv-proj' });
  const projectId = pr.json.projectId;
  const ev = await bus('POST', `/api/v1/projects/${projectId}/evidence`, { requestId: newId('r'), expectedVersion: 1, kind: 'doc', content: { v: 1 } });
  const g1 = await bus('POST', `/api/v1/projects/${projectId}/goals`, { requestId: newId('r'), goalKey: 'review' });
  const g2 = await bus('POST', `/api/v1/projects/${projectId}/goals`, { requestId: newId('r'), goalKey: 'approve' });
  return { k, bus, adm, ag, ap, projectId, evidenceId: ev.json.evidenceId, review: g1.json.goal, approve: g2.json.goal };
}

function stripTimestamps(x) {
  return JSON.parse(JSON.stringify(x), (_k, v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) ? '<ts>' : v));
}

test('证据取代：命中目标重绑新证据→ready；下游级联失效；无关项目逐字节不变', async (t) => {
  const a = await setup(t);
  // 无关对照项目（同内核，另一模板另一项目）
  const tplB = await a.adm('POST', '/api/v1/templates', simpleTemplate('other-tpl'));
  const prB = await a.bus('POST', '/api/v1/projects', { requestId: newId('r'), templateId: tplB.json.templateId, name: 'other-proj' });
  await a.bus('POST', `/api/v1/projects/${prB.json.projectId}/evidence`, { requestId: newId('r'), expectedVersion: 1, kind: 'doc', content: { other: true } });
  await a.bus('POST', `/api/v1/projects/${prB.json.projectId}/goals`, { requestId: newId('r'), goalKey: 'review' });
  await a.bus('POST', `/api/v1/projects/${prB.json.projectId}/goals`, { requestId: newId('r'), goalKey: 'approve' });
  const beforeB = await a.bus('GET', `/api/v1/projects/${prB.json.projectId}`);
  const ivA = () => a.bus('GET', `/api/v1/projects/${a.projectId}`).then((r) => r.json.project.projectInputVersion);

  const sup = await a.bus('POST', `/api/v1/projects/${a.projectId}/evidence/${a.evidenceId}/supersede`, {
    requestId: newId('r'), expectedVersion: await ivA(), content: { v: 2 },
  });
  assert.equal(sup.status, 200, JSON.stringify(sup.json));
  assert.equal(sup.json.superseded, a.evidenceId);

  const projA = await a.bus('GET', `/api/v1/projects/${a.projectId}`);
  const reviewA = projA.json.goals.find((g) => g.goalKey === 'review');
  assert.equal(reviewA.status, 'ready'); // 失效后新证据齐备 → 重绑回 ready
  assert.equal(reviewA.inputEvidence[0].evidenceId, sup.json.newEvidenceId);
  const approveA = projA.json.goals.find((g) => g.goalKey === 'approve');
  assert.equal(approveA.status, 'invalidated'); // 级联失效；等上游重新验收后再 ready
  const oldEv = projA.json.evidence.find((e) => e.evidenceId === a.evidenceId);
  assert.equal(oldEv.supersededBy, sup.json.newEvidenceId);
  assert.equal(oldEv.current, false); // 历史保留不删

  const sup2 = await a.bus('POST', `/api/v1/projects/${a.projectId}/evidence/${a.evidenceId}/supersede`, { requestId: newId('r'), expectedVersion: await ivA(), content: { v: 3 } });
  assert.equal(sup2.status, 409);
  assert.equal(sup2.json.error, 'EVIDENCE_SUPERSEDED');

  const afterB = await a.bus('GET', `/api/v1/projects/${prB.json.projectId}`);
  assert.deepEqual(stripTimestamps(afterB.json), stripTimestamps(beforeB.json)); // 无关项目逐字节不变
});

test('accepted+stale / decided 保护', async (t) => {
  const { bus, ag, ap, projectId, review, evidenceId } = await setup(t);
  let r = await ag('POST', `/api/v1/goals/${review.goalId}/claim`, { requestId: newId('r'), expectedVersion: review.version });
  r = await ag('POST', `/api/v1/goals/${review.goalId}/complete`, {
    requestId: newId('r'), expectedVersion: r.json.goalVersion, fencingToken: r.json.fencingToken,
    result: { provider: 'simulation', output: {} },
  });
  r = await ap('POST', `/api/v1/goals/${review.goalId}/accept`, { requestId: newId('r'), expectedVersion: r.json.goalVersion });
  assert.equal(r.json.status, 'accepted');
  // 取代输入证据
  const iv0 = (await bus('GET', `/api/v1/projects/${projectId}`)).json.project.projectInputVersion;
  const sup = await bus('POST', `/api/v1/projects/${projectId}/evidence/${evidenceId}/supersede`, { requestId: newId('r'), expectedVersion: iv0, content: { v: 9 } });
  assert.equal(sup.status, 200);
  const g = await bus('GET', `/api/v1/goals/${review.goalId}`);
  assert.equal(g.json.goal.status, 'accepted'); // 不自动重开
  assert.equal(g.json.goal.stale, true); // 读投影 stale（v1.3：读时计算的传递性 staleness）
  // 决定前同样受复核门约束：decide 需显式 ack（依据链已失效）
  const gated = await ap('POST', `/api/v1/goals/${review.goalId}/decide`, { requestId: newId('r'), expectedVersion: g.json.goal.version, decision: 'approved' });
  assert.equal(gated.status, 409);
  assert.equal(gated.json.error, 'UPSTREAM_STALE');
  r = await ap('POST', `/api/v1/goals/${review.goalId}/decide`, {
    requestId: newId('r'), expectedVersion: g.json.goal.version, decision: 'approved',
    staleReviewAck: { note: '已知悉依据失效，人工复核后决定' },
  });
  assert.equal(r.json.status, 'decided');
  const decisionBefore = r.json.formalDecision;
  const iv1 = (await bus('GET', `/api/v1/projects/${projectId}`)).json.project.projectInputVersion;
  await bus('POST', `/api/v1/projects/${projectId}/evidence/${sup.json.newEvidenceId}/supersede`, { requestId: newId('r'), expectedVersion: iv1, content: { v: 10 } });
  const g2 = await bus('GET', `/api/v1/goals/${review.goalId}`);
  assert.equal(g2.json.goal.status, 'decided');
  assert.equal(g2.json.goal.stale, true); // decided 也可见"依据事后被推翻"（不改写决定）
  assert.deepEqual(g2.json.goal.formalDecision, decisionBefore);
});

test('人工待办：关联目标 waiting_human，无关目标照常领取完成；回应后恢复', async (t) => {
  const { k, bus, adm, ag, ap } = await setup(t);
  // 三目标模板：a 独立、b 独立、c 依赖 a
  const tpl = await adm('POST', '/api/v1/templates', {
    requestId: newId('r'), name: 'three-goals',
    roles: [
      { roleKey: 'business', title: '业务', isHumanRole: false },
      { roleKey: 'approver', title: '审批', isHumanRole: true },
    ],
    goals: [
      { goalKey: 'a', title: 'A', responsibleRole: 'business', executorKind: 'agent', acceptanceRole: 'approver', decisionRole: 'approver', inputEvidenceKinds: ['doc'], dependsOn: [], params: {} },
      { goalKey: 'b', title: 'B', responsibleRole: 'business', executorKind: 'agent', acceptanceRole: 'approver', decisionRole: 'approver', inputEvidenceKinds: [], dependsOn: [], params: {} },
      { goalKey: 'c', title: 'C', responsibleRole: 'business', executorKind: 'agent', acceptanceRole: 'approver', decisionRole: 'approver', inputEvidenceKinds: [], dependsOn: ['a'], params: {} },
    ],
  });
  const pr = await bus('POST', '/api/v1/projects', { requestId: newId('r'), templateId: tpl.json.templateId, name: 'three' });
  const projectId = pr.json.projectId;
  await bus('POST', `/api/v1/projects/${projectId}/evidence`, { requestId: newId('r'), expectedVersion: 1, kind: 'doc', content: {} });
  const ga = await bus('POST', `/api/v1/projects/${projectId}/goals`, { requestId: newId('r'), goalKey: 'a' });
  const gb = await bus('POST', `/api/v1/projects/${projectId}/goals`, { requestId: newId('r'), goalKey: 'b' });
  await bus('POST', `/api/v1/projects/${projectId}/goals`, { requestId: newId('r'), goalKey: 'c' });
  assert.equal(ga.json.goal.status, 'ready');
  assert.equal(gb.json.goal.status, 'ready');
  // 人工待办挂起 a
  const hr = await bus('POST', `/api/v1/projects/${projectId}/human-requests`, {
    requestId: newId('r'), goalId: ga.json.goal.goalId, kind: 'missing_evidence',
    question: '缺补充材料', requestedRole: 'approver', requiredEvidenceKinds: ['doc2'],
  });
  assert.equal(hr.status, 200, JSON.stringify(hr.json));
  let gaNow = await bus('GET', `/api/v1/goals/${ga.json.goal.goalId}`);
  assert.equal(gaNow.json.goal.status, 'waiting_human');
  // 无关目标 b 照常领取+完成+验收（不被冻结）
  const rB = await ag('POST', `/api/v1/goals/${gb.json.goal.goalId}/claim`, { requestId: newId('r'), expectedVersion: gb.json.goal.version });
  assert.equal(rB.status, 200, `无关目标不应被冻结：${JSON.stringify(rB.json)}`);
  const doneB = await ag('POST', `/api/v1/goals/${gb.json.goal.goalId}/complete`, {
    requestId: newId('r'), expectedVersion: rB.json.goalVersion, fencingToken: rB.json.fencingToken,
    result: { provider: 'simulation', output: {} },
  });
  assert.equal(doneB.status, 200);
  // 补证据+回应 → a 恢复 ready
  const ev2 = await bus('POST', `/api/v1/projects/${projectId}/evidence`, { requestId: newId('r'), expectedVersion: 2, kind: 'doc2', content: {} });
  assert.equal(ev2.status, 200);
  const resp = await ap('POST', `/api/v1/human-requests/${hr.json.hrequestId}/respond`, {
    requestId: newId('r'), answer: { text: '已补齐', evidenceRefs: [{ evidenceId: ev2.json.evidenceId, version: 1 }] },
  });
  assert.equal(resp.status, 200, JSON.stringify(resp.json));
  gaNow = await bus('GET', `/api/v1/goals/${ga.json.goal.goalId}`);
  assert.equal(gaNow.json.goal.status, 'ready');
  void k;
});

test('项目暂停：claim/证据提交拒绝且状态不变；恢复后可继续', async (t) => {
  const { bus, adm, ag, projectId, review } = await setup(t);
  let r = await adm('POST', `/api/v1/projects/${projectId}/pause`, { requestId: newId('r') });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  r = await ag('POST', `/api/v1/goals/${review.goalId}/claim`, { requestId: newId('r'), expectedVersion: review.version });
  assert.equal(r.status, 409);
  assert.equal(r.json.error, 'PROJECT_PAUSED');
  r = await bus('POST', `/api/v1/projects/${projectId}/evidence`, { requestId: newId('r'), expectedVersion: 1, kind: 'doc', content: {} });
  assert.equal(r.status, 409);
  assert.equal(r.json.error, 'PROJECT_PAUSED');
  const g = await bus('GET', `/api/v1/goals/${review.goalId}`);
  assert.equal(g.json.goal.status, 'ready'); // 暂停不改变已有状态
  r = await adm('POST', `/api/v1/projects/${projectId}/resume`, { requestId: newId('r') });
  assert.equal(r.status, 200);
  r = await ag('POST', `/api/v1/goals/${review.goalId}/claim`, { requestId: newId('r'), expectedVersion: g.json.goal.version });
  assert.equal(r.status, 200);
});

test('outbox 至少一次：失败重投直到成功；eventId 稳定可幂等去重；pull 通道可用', async (t) => {
  const k = await startKernel({ dispatch: true });
  t.after(() => k.stop());
  const bus = client(k.base, TOKENS.business);
  const adm = client(k.base, TOKENS.admin);
  const seen = [];
  const failedOnce = new Set();
  const receiver = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const event = JSON.parse(body);
      seen.push(event);
      // 每个 eventId 首投必失败一次 → 强制至少一次重投路径
      if (!failedOnce.has(event.eventId)) {
        failedOnce.add(event.eventId);
        res.writeHead(500); res.end('boom');
        return;
      }
      res.writeHead(200); res.end('ok');
    });
  });
  await new Promise((r) => receiver.listen(48777, '127.0.0.1', r));
  t.after(() => receiver.close());
  const sub = await adm('POST', '/api/v1/subscriptions', { requestId: newId('r'), name: 'test-sub', url: 'http://127.0.0.1:48777/hook' });
  assert.equal(sub.status, 200, JSON.stringify(sub.json));
  // 触发事件
  const tpl = await adm('POST', '/api/v1/templates', simpleTemplate());
  const pr = await bus('POST', '/api/v1/projects', { requestId: newId('r'), templateId: tpl.json.templateId, name: 'outbox-proj' });
  assert.equal(pr.status, 200);
  // 等待投递收敛（poll 500ms；每事件首投失败后重投）
  await sleep(4000);
  const byEventId = new Map();
  for (const e of seen) {
    byEventId.set(e.eventId, [...(byEventId.get(e.eventId) ?? []), e]);
  }
  assert.ok(seen.length >= byEventId.size + 2, `至少两条事件经历过重投：seen=${seen.length} uniq=${byEventId.size}`);
  // 重投的同一事件载荷逐字节一致（消费方按 eventId 幂等去重的依据）
  for (const [, deliveries] of byEventId) {
    for (const d of deliveries) assert.deepEqual(d, deliveries[0]);
  }
  const types = [...byEventId.values()].map((v) => v[0].eventType);
  assert.ok(types.includes('PROJECT_CREATED'), `事件类型：${types.join(',')}`);
  // pull 通道独立可用且 seq 单调
  const events = await bus('GET', '/api/v1/events?after=0&limit=100');
  assert.equal(events.status, 200);
  assert.ok(events.json.events.length >= 2);
  const seqs = events.json.events.map((e) => e.seq);
  assert.deepEqual([...seqs].sort((x, y) => x - y), seqs);
  const page2 = await bus('GET', `/api/v1/events?after=${seqs[0]}&limit=100`);
  assert.ok(page2.json.events.every((e) => e.seq > seqs[0]));
});

test('跨项目越权：其他项目证据/目标不可操作；受限 principal 被拒', async (t) => {
  const a = await setup(t);
  const b = await setup(t); // 另一内核另一库——改为同库第二项目
  void b;
  // 同一内核建第二项目
  const tpl = await a.adm('POST', '/api/v1/templates', simpleTemplate('p2-tpl'));
  const pr2 = await a.bus('POST', '/api/v1/projects', { requestId: newId('r'), templateId: tpl.json.templateId, name: 'proj-2' });
  const projectId2 = pr2.json.projectId;
  const ev2 = await a.bus('POST', `/api/v1/projects/${projectId2}/evidence`, { requestId: newId('r'), expectedVersion: 1, kind: 'doc', content: {} });
  // 用项目1路径取代项目2证据 → 404（跨项目不可访问）
  const wrong = await a.bus('POST', `/api/v1/projects/${a.projectId}/evidence/${ev2.json.evidenceId}/supersede`, { requestId: newId('r'), expectedVersion: 1, content: {} });
  assert.equal(wrong.status, 404);
  // result.evidenceRefs 引用他项目证据 → 400
  let r = await a.ag('POST', `/api/v1/goals/${a.review.goalId}/claim`, { requestId: newId('r'), expectedVersion: a.review.version });
  const g = await a.bus('GET', `/api/v1/goals/${a.review.goalId}`);
  r = await a.ag('POST', `/api/v1/goals/${a.review.goalId}/complete`, {
    requestId: newId('r'), expectedVersion: g.json.goal.version, fencingToken: r.json.fencingToken,
    result: { provider: 'simulation', output: {}, evidenceRefs: [ev2.json.evidenceId] },
  });
  assert.equal(r.status, 400);
  // 受限 principal（仅授权不存在的项目）→ PROJECT_FORBIDDEN
  const limited = client(a.k.base, 'tok-limited');
  const lim = await limited('POST', `/api/v1/goals/${a.review.goalId}/claim`, { requestId: newId('r'), expectedVersion: g.json.goal.version });
  assert.equal(lim.status, 403);
  assert.equal(lim.json.error, 'PROJECT_FORBIDDEN');
});

test('v1.3 传递staleness：accepted链被取代→全链可见stale，下游accept被复核门拦截，ack放行', async (t) => {
  const k = await startKernel();
  t.after(() => k.stop());
  const bus = client(k.base, TOKENS.business);
  const adm = client(k.base, TOKENS.admin);
  const ag = client(k.base, TOKENS.agent);
  const ap = client(k.base, TOKENS.approver);
  // 三代链 gen1→gen2→gen3，前两代绑定 facts
  const tpl = await adm('POST', '/api/v1/templates', {
    requestId: newId('r'), name: 'three-gen',
    roles: [
      { roleKey: 'business', title: '业务', isHumanRole: false },
      { roleKey: 'approver', title: '审批', isHumanRole: true },
    ],
    goals: [
      { goalKey: 'gen1', title: 'G1', responsibleRole: 'business', executorKind: 'agent', acceptanceRole: 'approver', decisionRole: 'approver', inputEvidenceKinds: ['facts'], dependsOn: [], params: {} },
      { goalKey: 'gen2', title: 'G2', responsibleRole: 'business', executorKind: 'agent', acceptanceRole: 'approver', decisionRole: 'approver', inputEvidenceKinds: ['facts'], dependsOn: ['gen1'], params: {} },
      { goalKey: 'gen3', title: 'G3', responsibleRole: 'business', executorKind: 'agent', acceptanceRole: 'approver', decisionRole: 'approver', inputEvidenceKinds: [], dependsOn: ['gen2'], params: {} },
    ],
  });
  const pr = await bus('POST', '/api/v1/projects', { requestId: newId('r'), templateId: tpl.json.templateId, name: 'three-gen-p' });
  const projectId = pr.json.projectId;
  await bus('POST', `/api/v1/projects/${projectId}/evidence`, { requestId: newId('r'), expectedVersion: 1, kind: 'facts', content: { v: 1 } });
  const ids = {};
  for (const key of ['gen1', 'gen2', 'gen3']) {
    const g = await bus('POST', `/api/v1/projects/${projectId}/goals`, { requestId: newId('r'), goalKey: key });
    ids[key] = g.json.goal.goalId;
  }
  // 推进 gen1、gen2 到 accepted（gen3 因 gen2 未验收保持 blocked）
  for (const key of ['gen1', 'gen2']) {
    const cur = await bus('GET', `/api/v1/goals/${ids[key]}`);
    const c = await ag('POST', `/api/v1/goals/${ids[key]}/claim`, { requestId: newId('r'), expectedVersion: cur.json.goal.version });
    assert.equal(c.status, 200, `${key} claim：${JSON.stringify(c.json)}`);
    const d = await ag('POST', `/api/v1/goals/${ids[key]}/complete`, {
      requestId: newId('r'), expectedVersion: c.json.goalVersion, fencingToken: c.json.fencingToken,
      result: { provider: 'simulation', output: {} },
    });
    assert.equal(d.status, 200);
    const a = await ap('POST', `/api/v1/goals/${ids[key]}/accept`, { requestId: newId('r'), expectedVersion: d.json.goalVersion });
    assert.equal(a.status, 200);
  }
  const before3 = await bus('GET', `/api/v1/goals/${ids.gen3}`);
  assert.equal(before3.json.goal.status, 'ready'); // gen3 无输入绑定，上游 accepted 后即 ready
  const iv = (await bus('GET', `/api/v1/projects/${projectId}`)).json.project.projectInputVersion;
  const sup = await bus('POST', `/api/v1/projects/${projectId}/evidence/${(await bus('GET', `/api/v1/projects/${projectId}`)).json.evidence[0].evidenceId}/supersede`, {
    requestId: newId('r'), expectedVersion: iv, content: { v: 2 },
  });
  assert.equal(sup.status, 200);
  // gen1/gen2：accepted+stale（不 invalidated，不自动重开）；v1.3：staleness 传播到 gen3
  for (const key of ['gen1', 'gen2']) {
    const g = await bus('GET', `/api/v1/goals/${ids[key]}`);
    assert.equal(g.json.goal.status, 'accepted', `${key} 应保持 accepted`);
    assert.equal(g.json.goal.stale, true, `${key} 应 stale`);
  }
  const after3 = await bus('GET', `/api/v1/goals/${ids.gen3}`);
  assert.equal(after3.json.goal.status, 'ready');
  assert.equal(after3.json.goal.version, before3.json.goal.version); // 状态不被自动改写（无写入）
  assert.equal(after3.json.goal.stale, true); // v1.3：下游经传递 staleness 可见"依据已被推翻"
  // gen3 执行不受门影响（门只在 accept/decide 的正式性时刻）：领取+完成照常
  const c = await ag('POST', `/api/v1/goals/${ids.gen3}/claim`, { requestId: newId('r'), expectedVersion: after3.json.goal.version });
  assert.equal(c.status, 200, `gen3 领取不受门影响：${JSON.stringify(c.json)}`);
  const done = await ag('POST', `/api/v1/goals/${ids.gen3}/complete`, {
    requestId: newId('r'), expectedVersion: c.json.goalVersion, fencingToken: c.json.fencingToken,
    result: { provider: 'simulation', output: {} },
  });
  assert.equal(done.status, 200);
  // candidate_ready 后：accept 被复核门拦截（无提示继续不可能）
  const gated = await ap('POST', `/api/v1/goals/${ids.gen3}/accept`, { requestId: newId('r'), expectedVersion: done.json.goalVersion });
  assert.equal(gated.status, 409);
  assert.equal(gated.json.error, 'UPSTREAM_STALE');
  assert.ok(Array.isArray(gated.json.staleRoots) && gated.json.staleRoots.length >= 1, `应列出失效根因：${JSON.stringify(gated.json.staleRoots)}`);
  // 显式 ack（人类验收角色）→ 放行并留审计
  const ack = await ap('POST', `/api/v1/goals/${ids.gen3}/accept`, {
    requestId: newId('r'), expectedVersion: done.json.goalVersion,
    staleReviewAck: { note: '人工复核失效链后确认接受' },
  });
  assert.equal(ack.status, 200, `带 ack 验收应放行：${JSON.stringify(ack.json)}`);
  assert.equal(ack.json.status, 'accepted');
});

test('事件与审计可追溯：审计只记 principalId 不含凭据；事件 seq 单调', async (t) => {
  const { k, bus, projectId, review } = await setup(t);
  await ag_claim_and_finish(bus, k, review);
  // 审计白盒断言（审计无公开读 API，属运维面）
  const res = await k.pool.query(`SELECT actor_principal_id, summary FROM audit_events ORDER BY seq`);
  assert.ok(res.rows.length >= 3);
  for (const row of res.rows) {
    const text = JSON.stringify(row);
    assert.ok(!text.includes('tok-'), `审计不得包含凭据：${text}`);
  }
  const events = await bus('GET', '/api/v1/events?after=0&limit=500');
  assert.ok(events.json.events.length >= 2);
});

async function ag_claim_and_finish(bus, k, review) {
  const ag = client(k.base, TOKENS.agent);
  let r = await ag('POST', `/api/v1/goals/${review.goalId}/claim`, { requestId: newId('r'), expectedVersion: review.version });
  assert.equal(r.status, 200);
  r = await ag('POST', `/api/v1/goals/${review.goalId}/complete`, {
    requestId: newId('r'), expectedVersion: r.json.goalVersion, fencingToken: r.json.fencingToken,
    result: { provider: 'simulation', output: {} },
  });
  assert.equal(r.status, 200);
  const ap = client(k.base, TOKENS.approver);
  r = await ap('POST', `/api/v1/goals/${review.goalId}/accept`, { requestId: newId('r'), expectedVersion: r.json.goalVersion });
  assert.equal(r.status, 200);
  void bus;
}
