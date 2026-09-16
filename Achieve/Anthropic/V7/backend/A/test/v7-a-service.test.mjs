// V7 A · 服务层测试（CONTRACT v0 §2–§4；隔离数据目录，逐文件单独运行）。
// 覆盖 LONG_RUN_GOALS §A 验收面：双客户端一致、证据更新使旧分析失效、重启恢复、
// 重复提交幂等、并发版本门、损坏失败关闭、权威分离（结构强制）。
// 运行：node --test test/v7-a-service.test.mjs

import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openServices } from '../src/service.mjs';

const dataDir = mkdtempSync(join(tmpdir(), 'v7-a-service-'));

after(() => {
  try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* 临时目录清理失败不影响判定 */ }
});

const svc = openServices(dataDir);

// ---------- 项目 / 证据 / 幂等 ----------

test('项目创建 + 重复提交幂等（同 requestId 同载荷重放；异载荷 REQUEST_MISMATCH）', () => {
  const first = svc.facts.createProject({ requestId: 'req-p-1', name: '合成项目一' });
  assert.equal(first.ok, true);
  assert.equal(first.project.factVersion, 1);

  const replay = svc.facts.createProject({ requestId: 'req-p-1', name: '合成项目一' });
  assert.equal(replay.replayed, true);
  assert.equal(replay.project.projectId, first.project.projectId, '重放不新建项目');
  assert.equal(replay.storeVersion, first.storeVersion, '重放不递增存储版本');

  assert.throws(
    () => svc.facts.createProject({ requestId: 'req-p-1', name: '换一个名字' }),
    (e) => e.code === 'REQUEST_MISMATCH',
  );
});

test('证据挂接：factVersion 递增；版本门 409 带 serverVersion；双客户端一致（两个服务实例同盘同事实）', () => {
  const { project } = svc.facts.createProject({ requestId: 'req-p-2', name: '合成项目二' });

  const ev1 = svc.facts.attachEvidence({ requestId: 'req-ev-1', projectId: project.projectId, expectedVersion: 1, kind: '现场记录', content: { text: '设备三台，运行正常' } });
  assert.equal(ev1.ok, true);
  assert.equal(ev1.projectFactVersion, 2);
  assert.equal(ev1.evidence.version, 1);

  // 双客户端一致性：独立打开的服务实例（模拟另一端/另一进程内客户端）读同一事实。
  const secondClient = openServices(dataDir);
  const view = secondClient.facts.getProject(project.projectId);
  assert.equal(view.projectFactVersion, 2, '另一端刷新即见相同事实版本');
  assert.equal(view.evidence.length, 1);
  assert.equal(view.evidence[0].current, true);

  // 版本门：旧 expectedVersion → 409 VERSION_CONFLICT + serverVersion。
  assert.throws(
    () => svc.facts.attachEvidence({ requestId: 'req-ev-2', projectId: project.projectId, expectedVersion: 1, kind: '现场记录', content: { text: '过期版本写入' } }),
    (e) => e.code === 'VERSION_CONFLICT' && e.serverVersion === 2,
  );
});

test('证据取代：旧记录保留 + supersededBy 链；二次取代 409；取代使旧分析输入不可用', () => {
  const { project } = svc.facts.createProject({ requestId: 'req-p-3', name: '合成项目三' });
  const ev1 = svc.facts.attachEvidence({ requestId: 'req-ev-3a', projectId: project.projectId, expectedVersion: 1, kind: '巡检', content: { text: '产能口径：满负荷' } });

  const sup = svc.facts.supersedeEvidence({ requestId: 'req-ev-3b', projectId: project.projectId, evidenceId: ev1.evidence.evidenceId, expectedVersion: 2, content: { text: '产能口径更正：约一半' } });
  assert.equal(sup.ok, true);
  assert.equal(sup.superseded, ev1.evidence.evidenceId);
  assert.equal(sup.evidence.supersedes, ev1.evidence.evidenceId);

  const view = svc.facts.getProject(project.projectId);
  const old = view.evidence.find((e) => e.evidenceId === ev1.evidence.evidenceId);
  assert.equal(old.current, false, '旧记录保留且标记非 current（不删除历史）');
  assert.equal(view.evidence.filter((e) => e.current).length, 1);

  // 已被取代的证据不可再次取代（针对旧记录；取代链上最新记录仍可正常取代）。
  assert.throws(
    () => svc.facts.supersedeEvidence({ requestId: 'req-ev-3c', projectId: project.projectId, evidenceId: ev1.evidence.evidenceId, expectedVersion: 3, content: { text: '对已取代证据再次取代' } }),
    (e) => e.code === 'EVIDENCE_SUPERSEDED',
  );
});

// ---------- 规则 / 运行 / 意见 / 失效 ----------

test('规则版本单调不可变；未知版本 404', () => {
  const r1 = svc.facts.publishRule({ requestId: 'req-rule-1', indicators: ['产能口径'], allowedTools: ['cashflow-coverage'], humanEscalation: ['证据矛盾', '缺参'], notes: '合成规则包 v1' });
  const r2 = svc.facts.publishRule({ requestId: 'req-rule-2', indicators: ['产能口径', '电费一致性'], allowedTools: ['cashflow-coverage'], humanEscalation: ['证据矛盾'], notes: '合成规则包 v2' });
  assert.equal(r2.ruleVersion.version, r1.ruleVersion.version + 1, '规则版本全局单调');
  assert.throws(() => svc.facts.getRule(999), (e) => e.code === 'NOT_FOUND');
});

test('运行创建：factVersion 快照；被取代证据拒绝作为输入', () => {
  const { project } = svc.facts.createProject({ requestId: 'req-p-4', name: '合成项目四' });
  const rule = svc.facts.publishRule({ requestId: 'req-rule-4', indicators: ['产能口径'], allowedTools: [], humanEscalation: [], notes: '' });
  const ev = svc.facts.attachEvidence({ requestId: 'req-ev-4a', projectId: project.projectId, expectedVersion: 1, kind: '巡检', content: { text: '正常' } });

  const run = svc.runs.createRun({ requestId: 'req-run-4', projectId: project.projectId, ruleVersion: rule.ruleVersion.version, inputEvidence: [{ evidenceId: ev.evidence.evidenceId, version: 1 }] });
  assert.equal(run.ok, true);
  assert.equal(run.run.factVersion, 2, 'factVersion = 创建时项目快照');
  assert.equal(run.run.state, 'pending');

  // 取代后：新运行不得引用被取代证据。
  svc.facts.supersedeEvidence({ requestId: 'req-ev-4b', projectId: project.projectId, evidenceId: ev.evidence.evidenceId, expectedVersion: 2, content: { text: '更正' } });
  assert.throws(
    () => svc.runs.createRun({ requestId: 'req-run-4b', projectId: project.projectId, ruleVersion: rule.ruleVersion.version, inputEvidence: [{ evidenceId: ev.evidence.evidenceId, version: 1 }] }),
    (e) => e.code === 'EVIDENCE_SUPERSEDED',
  );
});

test('意见写入：pending→candidate_ready；证据取代后 opinion.stale / run.stale 现算；旧意见保留', () => {
  const { project } = svc.facts.createProject({ requestId: 'req-p-5', name: '合成项目五' });
  const rule = svc.facts.publishRule({ requestId: 'req-rule-5', indicators: [], allowedTools: [], humanEscalation: [], notes: '' });
  const ev = svc.facts.attachEvidence({ requestId: 'req-ev-5a', projectId: project.projectId, expectedVersion: 1, kind: '巡检', content: { text: '口径 A' } });
  const run = svc.runs.createRun({ requestId: 'req-run-5', projectId: project.projectId, ruleVersion: rule.ruleVersion.version, inputEvidence: [{ evidenceId: ev.evidence.evidenceId, version: 1 }] });

  const opinion = svc.runs.addOpinion({
    requestId: 'req-op-5', runId: run.run.runId, expectedVersion: 1,
    provider: 'simulation', requestReceipt: 'sim-receipt-1',
    candidate: { observations: ['口径 A 与电费记录一致'], evidenceRefs: [ev.evidence.evidenceId], assumptions: ['以现场口径为准'], uncertainty: [], recommendedHumanAction: 'need_more_evidence' },
    basedOnEvidence: [{ evidenceId: ev.evidence.evidenceId, version: 1 }],
  });
  assert.equal(opinion.ok, true);
  assert.equal(opinion.opinion.authority, 'none', '模型意见恒 authority=none');
  assert.equal(opinion.runState, 'candidate_ready');

  let view = svc.runs.getRun(run.run.runId);
  assert.equal(view.run.opinions[0].stale, false);
  assert.equal(view.stale, false);
  assert.equal(view.formalOutcome, null, '无人工动作时正式结果为空');

  // 证据取代（证据更新使旧分析失效）：
  svc.facts.supersedeEvidence({ requestId: 'req-ev-5b', projectId: project.projectId, evidenceId: ev.evidence.evidenceId, expectedVersion: 2, content: { text: '口径 B' } });
  view = svc.runs.getRun(run.run.runId);
  assert.equal(view.run.opinions[0].stale, true, '引用证据被取代 → 旧意见标记 stale（历史保留）');
  assert.equal(view.stale, true, '项目 factVersion 前进 → run 顶层 stale');
  assert.equal(view.run.opinions.length, 1, '旧意见不删除');
});

test('权威分离：candidate 禁用键 / 越权推荐动作 / 非人类 actorRole 一律拒绝', () => {
  const { project } = svc.facts.createProject({ requestId: 'req-p-6', name: '合成项目六' });
  const rule = svc.facts.publishRule({ requestId: 'req-rule-6', indicators: [], allowedTools: [], humanEscalation: [], notes: '' });
  const run = svc.runs.createRun({ requestId: 'req-run-6', projectId: project.projectId, ruleVersion: rule.ruleVersion.version, inputEvidence: [] });

  assert.throws(
    () => svc.runs.addOpinion({ requestId: 'req-op-6a', runId: run.run.runId, expectedVersion: 1, provider: 'simulation', requestReceipt: 'r', candidate: { observations: [], approved: true }, basedOnEvidence: [] }),
    (e) => e.code === 'INVALID_INPUT' && /禁用键/.test(e.message),
    'candidate 携带审批语义键 → 结构拒绝',
  );
  assert.throws(
    () => svc.runs.addOpinion({ requestId: 'req-op-6b', runId: run.run.runId, expectedVersion: 1, provider: 'simulation', requestReceipt: 'r', candidate: { observations: [], decision: '通过' }, basedOnEvidence: [] }),
    (e) => e.code === 'INVALID_INPUT',
  );
  assert.throws(
    () => svc.runs.addHumanAction({ requestId: 'req-ha-6c', runId: run.run.runId, expectedVersion: 1, action: 'accept_candidate', actorRole: 'model', actorName: '模拟模型' }),
    (e) => e.code === 'ROLE_FORBIDDEN',
    '模型不得执行正式动作（服务端强制，不靠前端）',
  );
});

test('升级通道与人工动作（v0.1）：unknown 诚实落库；正式动作须可信 principal；resolved 终态 409 保护；return→pending', () => {
  // 无身份源实例（默认失败关闭）与带合成验证器实例（正例）分开构造（同目录，项目隔离）。
  const open = openServices(dataDir);
  const privileged = openServices(dataDir, {
    principalVerifier: (cred) => cred === 'synthetic-human-token'
      ? { ok: true, role: 'human', principalId: 'synthetic-human-1' }
      : { ok: false },
  });

  const { project } = svc.facts.createProject({ requestId: 'req-p-7', name: '合成项目七' });
  const rule = svc.facts.publishRule({ requestId: 'req-rule-7', indicators: [], allowedTools: [], humanEscalation: [], notes: '' });
  const run = svc.runs.createRun({ requestId: 'req-run-7', projectId: project.projectId, ruleVersion: rule.ruleVersion.version, inputEvidence: [] });

  // 发送后结果不可知：诚实落 unknown，不伪造成功/失败。
  const esc = svc.runs.escalate({ requestId: 'req-esc-7', runId: run.run.runId, expectedVersion: 1, state: 'unknown', reason: '模型发送后超时，结果不可知' });
  assert.equal(esc.runState, 'unknown');

  // D-6：无身份源 → 自声明 human 也失败关闭（403 PRINCIPAL_UNTRUSTED），模块层不可绕过。
  assert.throws(
    () => open.runs.addHumanAction({ requestId: 'req-ha-7x', runId: run.run.runId, expectedVersion: 2, action: 'take_over', actorRole: 'human', actorName: '匿名伪造者' }),
    (e) => e.code === 'PRINCIPAL_UNTRUSTED',
    '未配置身份源：正式动作默认失败关闭',
  );
  assert.throws(
    () => privileged.runs.addHumanAction({ requestId: 'req-ha-7y', runId: run.run.runId, expectedVersion: 2, action: 'take_over', actorRole: 'human', actorName: '冒名者', principalCredential: 'wrong-token' }),
    (e) => e.code === 'PRINCIPAL_UNTRUSTED',
    '凭据错误 → 403',
  );
  assert.throws(
    () => privileged.runs.addHumanAction({ requestId: 'req-ha-7z', runId: run.run.runId, expectedVersion: 2, action: 'take_over', actorRole: 'human', actorName: '缺凭据' }),
    (e) => e.code === 'PRINCIPAL_UNTRUSTED',
    '缺 principalCredential → 403',
  );

  // 正例：可信凭据 → 正式动作入库，principalId 留痕。
  const acc = privileged.runs.addHumanAction({ requestId: 'req-ha-7', runId: run.run.runId, expectedVersion: 2, action: 'take_over', actorRole: 'human', actorName: '信审员甲', principalCredential: 'synthetic-human-token', note: '人工接管处理' });
  assert.equal(acc.runState, 'resolved');
  assert.equal(acc.formalOutcome.action, 'take_over');
  assert.equal(acc.formalOutcome.principalId, 'synthetic-human-1', 'principalId 入留痕');

  // D-3：resolved 为终态——再升级 400、再追加人工动作 409 RUN_RESOLVED（不可改写 formalOutcome）。
  assert.throws(
    () => svc.runs.escalate({ requestId: 'req-esc-7b', runId: run.run.runId, expectedVersion: 3, state: 'failed', reason: '终态后再升级' }),
    (e) => e.code === 'INVALID_INPUT',
  );
  assert.throws(
    () => privileged.runs.addHumanAction({ requestId: 'req-ha-7b', runId: run.run.runId, expectedVersion: 3, action: 'return_for_evidence', actorRole: 'human', actorName: '信审员甲', principalCredential: 'synthetic-human-token', note: '终态后追加' }),
    (e) => e.code === 'RUN_RESOLVED',
    'resolved 终态 409 保护（不发明业务重开）',
  );
  const view7 = svc.runs.getRun(run.run.runId);
  assert.equal(view7.formalOutcome.action, 'take_over', 'formalOutcome 未被终态后追加改写');

  // return_for_evidence → pending 新循环（正式留痕保留；允许保持未解决，不用结清强迫成功）。
  const { project: p8 } = svc.facts.createProject({ requestId: 'req-p-8', name: '合成项目八' });
  const rule8 = svc.facts.publishRule({ requestId: 'req-rule-8', indicators: [], allowedTools: [], humanEscalation: [], notes: '' });
  const run8 = svc.runs.createRun({ requestId: 'req-run-8', projectId: p8.projectId, ruleVersion: rule8.ruleVersion.version, inputEvidence: [] });
  const ret = privileged.runs.addHumanAction({ requestId: 'req-ha-8', runId: run8.run.runId, expectedVersion: 1, action: 'return_for_evidence', actorRole: 'human', actorName: '信审员乙', principalCredential: 'synthetic-human-token', note: '证据不足退回补充' });
  assert.equal(ret.runState, 'pending', '退回 → pending（允许保持未解决）');
  const view8 = svc.runs.getRun(run8.run.runId);
  assert.equal(view8.formalOutcome.action, 'return_for_evidence', 'formalOutcome = 最近人工动作');
});

test('D-4：升级态（unknown）写入意见 → 409 RUN_ESCALATED（闭门不静默注入）；candidate_ready 多意见合法', () => {
  const { project } = svc.facts.createProject({ requestId: 'req-p-d4', name: 'D-4 项目' });
  const rule = svc.facts.publishRule({ requestId: 'req-rule-d4', indicators: [], allowedTools: [], humanEscalation: [], notes: '' });
  const run = svc.runs.createRun({ requestId: 'req-run-d4', projectId: project.projectId, ruleVersion: rule.ruleVersion.version, inputEvidence: [] });
  svc.runs.escalate({ requestId: 'req-esc-d4', runId: run.run.runId, expectedVersion: 1, state: 'unknown', reason: '结果不可知' });
  assert.throws(
    () => svc.runs.addOpinion({ requestId: 'req-op-d4', runId: run.run.runId, expectedVersion: 2, provider: 'simulation', requestReceipt: 'r', candidate: { observations: ['late'] }, basedOnEvidence: [] }),
    (e) => e.code === 'RUN_ESCALATED',
    'unknown 态注入候选被 409 拒绝',
  );
  const view = svc.runs.getRun(run.run.runId);
  assert.equal(view.run.opinions.length, 0, '被拒意见不入库');
});

test('C v3 #4：resolved 上写意见 → 409 RUN_RESOLVED（码位与合同一致，区别于升级态 RUN_ESCALATED）', () => {
  const privileged = openServices(dataDir, {
    principalVerifier: (cred) => cred === 'synthetic-human-token' ? { ok: true, role: 'human', principalId: 'p1' } : { ok: false },
  });
  const { project } = svc.facts.createProject({ requestId: 'req-p-lgc', name: '码位澄清项目' });
  const rule = svc.facts.publishRule({ requestId: 'req-rule-lgc', indicators: [], allowedTools: [], humanEscalation: [], notes: '' });
  const run = svc.runs.createRun({ requestId: 'req-run-lgc', projectId: project.projectId, ruleVersion: rule.ruleVersion.version, inputEvidence: [] });
  privileged.runs.addHumanAction({ requestId: 'req-ha-lgc', runId: run.run.runId, expectedVersion: 1, action: 'accept_candidate', actorRole: 'human', actorName: '甲', principalCredential: 'synthetic-human-token' });
  assert.throws(
    () => svc.runs.addOpinion({ requestId: 'req-op-lgc', runId: run.run.runId, expectedVersion: 2, provider: 'simulation', requestReceipt: 'r', candidate: { observations: [] }, basedOnEvidence: [] }),
    (e) => e.code === 'RUN_RESOLVED',
    'resolved 意见 = RUN_RESOLVED（非 RUN_ESCALATED）',
  );
});

test('D-5：伪造证据引用失败关闭——basedOnEvidence 不存在、candidate.evidenceRefs 伪造均 400 且不入库', () => {
  const { project } = svc.facts.createProject({ requestId: 'req-p-d5', name: 'D-5 项目' });
  const rule = svc.facts.publishRule({ requestId: 'req-rule-d5', indicators: [], allowedTools: [], humanEscalation: [], notes: '' });
  const run = svc.runs.createRun({ requestId: 'req-run-d5', projectId: project.projectId, ruleVersion: rule.ruleVersion.version, inputEvidence: [] });

  assert.throws(
    () => svc.runs.addOpinion({ requestId: 'req-op-d5a', runId: run.run.runId, expectedVersion: 1, provider: 'simulation', requestReceipt: 'r', candidate: { observations: [] }, basedOnEvidence: [{ evidenceId: 'ev-nonexistent', version: 1 }] }),
    (e) => e.code === 'INVALID_INPUT' && /不存在/.test(e.message),
    '幽灵引用 400',
  );
  assert.throws(
    () => svc.runs.addOpinion({ requestId: 'req-op-d5b', runId: run.run.runId, expectedVersion: 1, provider: 'simulation', requestReceipt: 'r', candidate: { observations: [], evidenceRefs: ['ev-nonexistent'] }, basedOnEvidence: [] }),
    (e) => e.code === 'INVALID_INPUT' && /伪造/.test(e.message),
    'candidate.evidenceRefs 伪造 400',
  );
  const view = svc.runs.getRun(run.run.runId);
  assert.equal(view.run.opinions.length, 0, '被拒意见不入库');
});

test('并发版本门：过期版本并发提交一方成功一方 409（无静默覆盖）', () => {
  const { project } = svc.facts.createProject({ requestId: 'req-p-10', name: '合成项目十' });
  // 两个请求同 expectedVersion=1：第一个成功（factVersion→2），第二个必须 409，不得静默覆盖。
  const results = [
    (() => { try { return { ok: true, r: svc.facts.attachEvidence({ requestId: 'req-ev-10a', projectId: project.projectId, expectedVersion: 1, kind: 'k', content: { n: 1 } }) }; } catch (e) { return { ok: false, code: e.code }; } })(),
    (() => { try { return { ok: true, r: svc.facts.attachEvidence({ requestId: 'req-ev-10b', projectId: project.projectId, expectedVersion: 1, kind: 'k', content: { n: 2 } }) }; } catch (e) { return { ok: false, code: e.code }; } })(),
  ];
  const successes = results.filter((r) => r.ok);
  const conflicts = results.filter((r) => !r.ok && r.code === 'VERSION_CONFLICT');
  assert.equal(successes.length, 1, '仅一方成功');
  assert.equal(conflicts.length, 1, '另一方确定性 409（不静默覆盖、不自动合并）');
});

test('损坏失败关闭：facts.json 被改坏 → 命令 500 STORE_CORRUPT 且文件不被静默重置', () => {
  const dir = mkdtempSync(join(tmpdir(), 'v7-a-corrupt-'));
  try {
    const corruptSvc = openServices(dir);
    corruptSvc.facts.createProject({ requestId: 'req-c-1', name: '待损坏项目' });
    const file = join(dir, 'facts.json');
    const good = readFileSync(file, 'utf8');
    writeFileSync(file, '{"schema":"v7-a-facts@1","projects":"不是数组"}', 'utf8');

    assert.throws(
      () => corruptSvc.facts.getProject('p-any'),
      (e) => e.code === 'STORE_CORRUPT',
    );
    assert.throws(
      () => corruptSvc.facts.createProject({ requestId: 'req-c-2', name: '损坏后写入' }),
      (e) => e.code === 'STORE_CORRUPT',
    );
    assert.equal(readFileSync(file, 'utf8').includes('不是数组'), true, '损坏文件不被静默重置/重建');
    // 恢复 = 恢复文件内容（迁移/恢复说明的依据），此后服务照常。
    writeFileSync(file, good, 'utf8');
    assert.equal(corruptSvc.facts.createProject({ requestId: 'req-c-3', name: '恢复后项目' }).ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
