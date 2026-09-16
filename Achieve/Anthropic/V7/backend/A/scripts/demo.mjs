#!/usr/bin/env node
// V7 A · 可复跑端到端演示（CONTRACT v0 全链：项目→证据→规则→运行→意见/计算→人工）。
// 用法：node scripts/demo.mjs [baseUrl]   （默认 http://127.0.0.1:3601；先启动 src/server.mjs）
// 退出码 0 = 全链通过；任何一步失败非零退出。幂等 requestId 带时间片，可重复运行。

const BASE = process.argv[2] ?? 'http://127.0.0.1:3601';
const tag = Date.now().toString(36);
let failures = 0;

function log(step, text) {
  console.log(`[${step}] ${text}`);
}

async function call(method, path, body) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json();
  if (response.status !== 200 || payload.ok !== true) {
    failures += 1;
    console.log(`  !! ${method} ${path} → ${response.status} ${JSON.stringify(payload)}`);
    return payload;
  }
  return payload;
}

function expect(name, cond, detail = '') {
  if (cond) {
    console.log(`  ok: ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL: ${name} ${detail}`);
  }
}

const projectId = (await call('POST', '/api/v7/projects', { requestId: `demo-p-${tag}`, name: `端到端演示项目 ${tag}` })).project.projectId;
log('1', `项目已创建 ${projectId}`);

const rule = (await call('POST', '/api/v7/rules', {
  requestId: `demo-rule-${tag}`,
  indicators: ['产能口径一致性', '电费与产值匹配'],
  allowedTools: ['cashflow-coverage'],
  humanEscalation: ['证据相互矛盾', '计算缺参', '模型结果不可知'],
  notes: '规则只界定关注指标/范围/工具与人工门，不硬编码风险结论（C 路规则包将替换本演示包内容）。',
})).ruleVersion;
log('2', `规则版本 v${rule.version} 已发布（indicators=${rule.indicators.join('/')}）`);

const ev1 = (await call('POST', `/api/v7/projects/${projectId}/evidence`, { requestId: `demo-ev1-${tag}`, expectedVersion: 1, kind: '现场巡检', content: { text: '产能口径：基本满负荷（口径 A）', source: '合成演示' } })).evidence;
log('3', `证据已挂接 ${ev1.evidenceId}（项目 factVersion → 2）`);

// 模型候选意见（authority=none；真实通道由 B 路接入，此处走 simulation provider 演示同一接口）。
const run = (await call('POST', `/api/v7/projects/${projectId}/runs`, {
  requestId: `demo-run-${tag}`, expectedVersion: 2, ruleVersion: rule.version,
  inputEvidence: [{ evidenceId: ev1.evidenceId, version: 1 }],
})).run;
log('4', `运行已创建 ${run.runId}（factVersion 快照=${run.factVersion}，state=${run.state}）`);

const calc = await call('POST', `/api/v7/runs/${run.runId}/calculation`, {
  requestId: `demo-calc-${tag}`, expectedVersion: 1, toolVersion: 'demo-cashflow@0',
  inputHash: 'demo-input-hash', output: { note: '占位记录：正式计算工具由 C 路交付后经 assembly 接入' }, assumptions: ['演示占位'], computedBy: 'assembly-demo',
});
expect('计算记录可附（占位，待 C 交付替换）', calc.ok === true);

const opinion = await call('POST', `/api/v7/runs/${run.runId}/opinions`, {
  requestId: `demo-op-${tag}`, expectedVersion: 2, provider: 'simulation', requestReceipt: `sim-${tag}`,
  candidate: {
    observations: ['口径 A 与证据一致，未见矛盾'],
    evidenceRefs: [ev1.evidenceId],
    assumptions: ['以现场巡检口径为准'],
    uncertainty: ['电费记录未提供，无法交叉验证'],
    recommendedHumanAction: 'need_more_evidence',
  },
  basedOnEvidence: [{ evidenceId: ev1.evidenceId, version: 1 }],
});
expect('模型候选意见已落库（authority=none）', opinion.opinion?.authority === 'none');
expect('状态迁移 pending→candidate_ready', opinion.runState === 'candidate_ready');

// 权威分离反例：带审批语义键的意见必须被结构拒绝。
const badOpinion = await fetch(`${BASE}/api/v7/runs/${run.runId}/opinions`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ requestId: `demo-op-bad-${tag}`, expectedVersion: 3, provider: 'simulation', requestReceipt: 'x', candidate: { observations: [], approval: '同意放行' }, basedOnEvidence: [] }),
});
expect('禁用键（approval）被结构拒绝 400', badOpinion.status === 400);

// 证据更正（取代）：旧意见转 stale，事实版本前进。
const sup = await call('POST', `/api/v7/projects/${projectId}/evidence/${ev1.evidenceId}/supersede`, {
  requestId: `demo-sup-${tag}`, expectedVersion: 2, content: { text: '产能口径更正：约一半（口径 B）', source: '合成演示·人工更正' },
});
expect('证据更正生成新版本', sup.evidence?.supersedes === ev1.evidenceId);

const after = await call('GET', `/api/v7/runs/${run.runId}`);
expect('旧意见标记 stale（历史保留）', after.run.opinions[0]?.stale === true);
expect('run 顶层 stale（项目事实前进）', after.stale === true);

// 人工接管（正式动作；模型/Agent 角色会被 403 拒绝——CONTRACT 权威分离）。
const human = await call('POST', `/api/v7/runs/${run.runId}/human-actions`, {
  requestId: `demo-ha-${tag}`, expectedVersion: after.run.version,
  action: 'take_over', actorRole: 'human', actorName: '信审员（演示）', principalCredential: 'demo-human-token',
  note: '证据口径已更正，人工接管后续判断（正式动作）',
});
expect('人工正式动作落库 → resolved', human.runState === 'resolved' && human.formalOutcome?.action === 'take_over');

// 重复提交：同 requestId 原样重放（回执语义）。
const replay = await call('POST', `/api/v7/runs/${run.runId}/human-actions`, {
  requestId: `demo-ha-${tag}`, expectedVersion: after.run.version,
  action: 'take_over', actorRole: 'human', actorName: '信审员（演示）', principalCredential: 'demo-human-token',
  note: '证据口径已更正，人工接管后续判断（正式动作）',
});
expect('重复提交重放原回执（replayed=true）', replay.replayed === true);

// 双端一致性：另一客户端 GET 看到同一事实。
const other = await call('GET', `/api/v7/projects/${projectId}`);
expect('另一端读到相同 factVersion', other.projectFactVersion === 3);

console.log(failures === 0 ? '\nDEMO PASS：全链通过' : `\nDEMO FAIL：${failures} 处失败`);
process.exit(failures === 0 ? 0 : 1);
