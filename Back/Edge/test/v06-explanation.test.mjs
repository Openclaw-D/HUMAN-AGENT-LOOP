// V0.6-01（2026-09-30）· 01-back 离线回归（零出站、零 docker）：
//   1) admission 投影 arrow 面：现行候选投影/四态分列/isCurrent 修正/无 advance 旧行为逐字节兼容；
//   2) 确定性说明与 workspaceContext 的 arrow 同源透出；
//   3) transport 离线失败关闭：出站白名单拒绝/预算超限=确定未发送（离线等价"预算拒绝"）；
//   4) assistant-model 配置失败关闭：apiKeyEnv 非法/环境缺失=启动即抛错，绝不静默降级。
// R2-01（2026-10-01）增补（零出站）：
//   5) 03-eval 封存输入哈希白名单接通（只读 MANIFEST.json 路径+sha256，不读输入正文/gold）；
//   6) 配置检查真实校验 transport/budget（漂移=逐字段报错，不再假绿）；
//   7) arrow 面键集与 BUSINESS_EXPLANATION §2.1 合同一致（含 found，防合同漂移）。
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { deriveAdmission } from '../src/admission-projection.mjs';
import { buildBriefing } from '../src/assistant-briefing.mjs';
import { workspaceContext } from '../src/assistant-receipts.mjs';
import { createModelTransport } from '../../B/src/transport/glm.mjs';
import { EVAL_MANIFEST_PATH, evalManifestHashes, collectAllowedHashes, buildConfig, verifyConfig } from '../scripts/v06-model-config.mjs';

const ARROW = (over = {}) => ({
  found: true, processId: 'ap-1', caseOutcome: { status: 'in_progress' },
  domains: [
    { domain: 'business', state: 'awaiting_confirmation', roundId: 'j-biz' },
    { domain: 'asset', state: 'waiting_evidence', roundId: 'j-asset' },
    { domain: 'credit', state: 'not_started', roundId: null },
  ],
  receipts: [
    { domain: 'business', state: 'awaiting_confirmation', current: true, roundId: 'j-biz', basisVersion: 'bv-7',
      candidate: { summary: '流动资金回租候选，等待人工确认' }, zoneCandidates: { options: [{ id: 'o1' }, { id: 'o2' }, { id: 'o3' }, { id: 'o4' }], scoreType: 'rule_rank' }, selection: null, semantic: null },
    { domain: 'asset', state: 'waiting_evidence', current: true, roundId: 'j-asset', basisVersion: 'bv-8',
      candidate: null, zoneCandidates: null, selection: null, semantic: null },
  ],
  needsReselection: [], affectedDomains: ['asset'],
  ...over,
});

test('投影：arrow 现行候选进 candidateDomains；智能行 outcome/basisRefs/阻断四态如实', () => {
  const adm = deriveAdmission({ customerId: 'c1', assessments: [], artifacts: [], advance: ARROW() });
  assert.equal(adm.arrow.found, true);
  assert.equal(adm.arrow.candidateDomains.length, 1, '仅 business 有现行候选');
  const biz = adm.arrow.candidateDomains[0];
  assert.equal(biz.domain, 'business');
  assert.equal(biz.state, 'awaiting_confirmation');
  assert.equal(biz.zoneCandidateCount, 4, '3–5 候选实际条数如实');
  assert.equal(biz.zoneCandidateScoreType, 'rule_rank', '规则排序分，非概率');
  assert.equal(adm.arrow.domains.find(d => d.domain === 'asset').state, 'waiting_evidence');

  const bizIntel = adm.cells.find(c => c.domain === 'business' && c.row === 'intelligence');
  assert.equal(bizIntel.outcome, '候选待人工确认');
  assert.equal(bizIntel.basisRefs.roundId, 'j-biz');
  assert.equal(bizIntel.basisRefs.current, true);
  assert.deepEqual(bizIntel.displayBucket, { kind: 'zoneCandidates', count: 4, scoreType: 'rule_rank' });

  const assetIntel = adm.cells.find(c => c.domain === 'asset' && c.row === 'intelligence');
  assert.equal(assetIntel.outcome, '等待补证');
  assert.equal(assetIntel.needsReview, true);
  assert.ok(assetIntel.blockers.some(b => b.scope === 'arrow' && b.reason === 'EVIDENCE_GAP'));

  const creditIntel = adm.cells.find(c => c.domain === 'credit' && c.row === 'intelligence');
  assert.equal(creditIntel.outcome, '未定', 'arrow 未涉域保持投影缺省“未定”，不冒充已分析');
});

test('投影：失效候选不冒充有效——current=false→STALE_BASIS 阻断；stale 评估 isCurrent=false；无 advance 旧行为兼容', () => {
  const staleArrow = deriveAdmission({ customerId: 'c1', assessments: [], artifacts: [],
    advance: ARROW({ receipts: [ARROW().receipts[0] && { domain: 'business', state: 'awaiting_confirmation', current: false, roundId: 'j-biz', basisVersion: 'old', candidate: { summary: 'x' }, zoneCandidates: null, selection: null, semantic: null }], affectedDomains: ['business'] }) });
  const bizIntel = staleArrow.cells.find(c => c.domain === 'business' && c.row === 'intelligence');
  assert.ok(bizIntel.blockers.some(b => b.scope === 'arrow' && b.reason === 'STALE_BASIS'), '过期候选如实阻断');
  assert.equal(staleArrow.arrow.candidateDomains.length, 0, '失效候选不进现行候选投影');

  const staleAssessment = deriveAdmission({ customerId: 'c1',
    assessments: [{ assessmentId: 'a', status: 'awaiting_human_review', stale: true, candidateRevision: 1, candidate: { tendency: 'increase' } }],
    artifacts: [] });
  assert.equal(staleAssessment.candidate.isCurrent, false, 'isCurrent 不再恒 true');

  const legacy = deriveAdmission({ customerId: 'c1', assessments: [], artifacts: [] });
  assert.equal(legacy.arrow, null, '不传 advance=旧形态（arrow null），零回归');
});

test('说明层同源：briefing/workspaceContext 透出 arrow 候选与状态', () => {
  const snapshot = { snapshot: { customer: { displayName: '合成客户甲' }, admission: deriveAdmission({ customerId: 'c1', assessments: [], artifacts: [], advance: ARROW() }) } };
  const brief = buildBriefing({ snapshot, customerId: 'c1', assistant: 'business', question: '这个客户情况怎么样？' });
  assert.ok(brief.answer.includes('商机：候选待人工确认'), 'briefing 含现行候选状态');
  const ctx = workspaceContext(snapshot, 'business');
  assert.equal(ctx.arrow.candidateDomains[0].domain, 'business', 'workspaceContext 携带同一 arrow 投影');
});

test('transport 离线失败关闭：白名单外=未发送；预算超限=确定未发送（账本持久）', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v06-budget-'));
  const ledger = path.join(dir, 'cost.jsonl');
  const base = { mode: 'real', apiKey: 'offline-test', timeoutMs: 3000 };
  const req = { requestId: 'r1', text: 'x', contextTags: { projectId: 'p', runId: 's', role: 'business' }, evidenceRefs: [] };
  const t1 = createModelTransport({ mode: 'real', real: { ...base, endpoint: 'https://api.deepseek.com/chat/completions', model: 'deepseek-flash', outboundAllow: ['https://open.bigmodel.cn'] }, budget: { maxTotalCost: 1, perCallEstimate: 0.03, currency: 'USD' }, costLogPath: ledger });
  const r1 = await t1.complete(req);
  assert.equal(r1.status, 'failed'); assert.equal(r1.sentFlag, false);
  assert.equal(r1.error.code, 'OUTBOUND_NOT_ALLOWED', '白名单外确定未发送');
  // 预算包络不足：perCallEstimate 0.03 > maxTotalCost 0.02 → 出站前拒绝，零网络动作
  const t2 = createModelTransport({ mode: 'real', real: { ...base, endpoint: 'https://api.deepseek.com/chat/completions', model: 'deepseek-flash', outboundAllow: ['https://api.deepseek.com'] }, budget: { maxTotalCost: 0.02, perCallEstimate: 0.03, currency: 'USD' }, costLogPath: ledger });
  const r2 = await t2.complete(req);
  assert.equal(r2.status, 'failed'); assert.equal(r2.sentFlag, false);
  assert.equal(r2.error.code, 'BUDGET_EXCEEDED', '预算拒绝=失败关闭，调用未发送');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('assistant-model 配置失败关闭：apiKeyEnv 非法/环境缺失=抛错，不静默 not_configured/mock', async () => {
  const { createAssistantModel } = await import('../src/assistant-model.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v06-cfg-'));
  const cfgPath = path.join(dir, 'model-config.json');
  const write = (real) => fs.writeFileSync(cfgPath, JSON.stringify({ transport: { mode: 'real', real } }));
  const real = { endpoint: 'https://api.deepseek.com/chat/completions', model: 'deepseek-flash', outboundAllow: ['https://api.deepseek.com'] };
  write({ ...real, apiKeyEnv: 'NOT_ALLOWED_ENV' });
  await assert.rejects(() => createAssistantModel({ configPath: cfgPath }), /apiKeyEnv/, '环境变量名不符 JW_* 规范=失败关闭');
  write({ ...real, apiKeyEnv: 'JW_TEST_MISSING_KEY_V06' });
  delete process.env.JW_TEST_MISSING_KEY_V06;
  await assert.rejects(() => createAssistantModel({ configPath: cfgPath }), /apiKeyEnv|环境变量缺失/, '环境缺失=失败关闭');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---- R2-01（2026-10-01）----

test('R2 白名单接通：03-eval 封存输入哈希全部入列（只读清单路径+sha256，不读输入正文/gold）', () => {
  const entries = evalManifestHashes(); // 真实封存清单（只取 caseId/files.name/sha256）
  assert.ok(entries.length >= 8, `eval 封存输入应为全部 8 份（实得 ${entries.length}）`);
  for (const e of entries) {
    assert.match(e.sha256, /^[0-9a-f]{64}$/, '哈希形状合法');
    assert.ok(e.path.includes('03-eval') && e.path.split(path.sep).includes('inputs'), '路径必须指向 inputs/，绝不指向 gold/');
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v06-wl-'));
  for (let i = 0; i < 21; i++) fs.writeFileSync(path.join(dir, `m${i}.bin`), `material-${i}`);
  const { hashes, evalCount, materialCount } = collectAllowedHashes({ materialDirs: [dir] });
  assert.ok(evalCount === entries.length && materialCount >= 20, '来源计数如实（本地材料与 eval 清单分开计）');
  const have = new Set(hashes);
  for (const e of entries) assert.ok(have.has(e.sha256), '每条 eval 封存输入哈希都必须在白名单内');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('R2 白名单清单失败关闭：MANIFEST 缺失/案例为空/哈希非法=抛错，不生成缺白名单配置', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v06-wlneg-'));
  assert.throws(() => evalManifestHashes(path.join(dir, 'missing.json')), /不可读.*失败关闭/, '清单缺失=失败关闭');
  const bad = path.join(dir, 'bad.json');
  fs.writeFileSync(bad, JSON.stringify({ cases: [] }));
  assert.throws(() => evalManifestHashes(bad), /缺 cases 或为空/, '空案例=失败关闭');
  fs.writeFileSync(bad, JSON.stringify({ cases: [{ caseId: 'c1', files: [{ name: 'a.csv' }] }] }));
  assert.throws(() => evalManifestHashes(bad), /缺 name\/sha256/, '哈希缺失=失败关闭');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('R2 配置检查真实校验：transport/budget 漂移=逐字段报错（不再假绿）；白名单缺失=拒绝', () => {
  const hashes = Array.from({ length: 21 }, (_, i) => `h${i}`.padEnd(64, '0'));
  const good = buildConfig(hashes);
  assert.deepEqual(verifyConfig(good, { expectedHashes: hashes }), [], '合法配置零问题');
  const drift = buildConfig(hashes);
  drift.budget.maxTotalCost = 5; // 预算被擅自放大
  drift.transport.real.endpoint = 'https://api.example.com/v1'; // 端点被换
  drift.transport.real.routing.strategy = 'some-other-route';
  drift.transport.real.apiKey = 'sk-leak'; // 密钥不得写入配置
  const problems = verifyConfig(drift, { expectedHashes: hashes });
  assert.ok(problems.some(p => p.includes('budget.maxTotalCost')), '预算漂移必须逐字段报出');
  assert.ok(problems.some(p => p.includes('transport.real.endpoint')), '端点漂移必须报出');
  assert.ok(problems.some(p => p.includes('routing.strategy')), '路由漂移必须报出');
  assert.ok(problems.some(p => p.includes('apiKey 不得出现')), '配置内嵌密钥必须报出');
  const shrunk = buildConfig(hashes);
  shrunk.evidencePolicy.allowedHashes = hashes.slice(0, 10); // 白名单被掏空
  const shrunkProblems = verifyConfig(shrunk, { expectedHashes: hashes });
  assert.ok(shrunkProblems.some(p => p.includes('缺') && p.includes('白名单')), '白名单缺哈希必须拒绝，不得以关闭白名单绕过');
  const closed = buildConfig(hashes);
  closed.evidencePolicy.allowedHashes = [];
  assert.ok(verifyConfig(closed, { expectedHashes: hashes }).some(p => p.includes('不得关闭')), '白名单关闭=拒绝');
});

test('R2 CLI 端到端：--check 对漂移配置退出 2 并点名字段；正常生成+--check 退出 0（--out 隔离，不触碰运行配置）', (t) => {
  const node = process.execPath;
  const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../scripts/v06-model-config.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v06-cli-'));
  const outPath = path.join(dir, 'model-config.json');
  // 负例：伪造预算漂移配置 → --check 必须失败并点名 budget.maxTotalCost
  const forged = buildConfig(Array.from({ length: 21 }, (_, i) => `x${i}`.padEnd(64, '0')));
  forged.budget.maxTotalCost = 99;
  fs.writeFileSync(outPath, JSON.stringify(forged, null, 2));
  const bad = spawnSync(node, [script, '--check', '--out', outPath], { encoding: 'utf8' });
  assert.equal(bad.status, 2, '漂移配置 --check 退出码必须为 2');
  assert.match(bad.stderr, /budget\.maxTotalCost/, '报错必须点名漂移字段，不得假绿');
  // 正例：全量生成到临时路径（依赖本仓默认材料目录；缺失则跳过，不假绿）
  const edgeRoot = path.resolve(path.dirname(script), '..');
  const repoRoot = path.resolve(edgeRoot, '..', '..');
  const defaultDirsExist = [path.join(repoRoot, 'docs/integration/2026-09-30-final/materials'), path.join(edgeRoot, '.run/v05/devsample')]
    .map((p) => fs.existsSync(p));
  if (defaultDirsExist.every(Boolean)) {
    const good = spawnSync(node, [script, '--out', outPath], { encoding: 'utf8' });
    assert.equal(good.status, 0, `生成应成功：${good.stderr}`);
    const again = spawnSync(node, [script, '--check', '--out', outPath], { encoding: 'utf8' });
    assert.equal(again.status, 0, `--check 应通过：${again.stderr}`);
    assert.match(again.stdout, /真实校验通过|逐字段一致/, '通过输出必须来自真实比对');
  } else {
    t.skip('默认材料目录缺失（非完整工作区），正例跳过');
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('R2 合同当前性：arrow 面键集与 BUSINESS_EXPLANATION §2.1 完全一致（含 found；候选条目十键）', () => {
  const adm = deriveAdmission({ customerId: 'c1', assessments: [], artifacts: [], advance: ARROW() });
  assert.deepEqual(Object.keys(adm.arrow).sort(),
    ['affectedDomains', 'candidateDomains', 'domains', 'found', 'needsReselection', 'note', 'processId', 'processStatus'].sort(),
    'arrow 顶层键集=合同 §2.1（found 必须在文档中，不得未记载就变更）');
  assert.deepEqual(Object.keys(adm.arrow.candidateDomains[0]).sort(),
    ['basisVersion', 'domain', 'roundId', 'selection', 'semantic', 'state', 'summary', 'tendency', 'zoneCandidateCount', 'zoneCandidateScoreType'].sort(),
    'candidateDomains 条目键集=合同 §2.1');
  assert.deepEqual(Object.keys(adm.arrow.domains[0]).sort(), ['domain', 'roundId', 'state'].sort(), 'domains 条目键集=合同 §2.1');
  const intel = adm.cells.find(c => c.domain === 'business' && c.row === 'intelligence');
  assert.deepEqual(Object.keys(intel.basisRefs).sort(), ['basisVersion', 'current', 'roundId'].sort(), '智能行 basisRefs 键集=合同 §2.2');
  assert.ok(intel.blockers.every(b => b.scope !== 'arrow' || ['EVIDENCE_GAP', 'STALE_BASIS', 'NEEDS_REASSESSMENT'].includes(b.reason)),
    'arrow 阻断 reason 枚举=合同 §2.2');
});
