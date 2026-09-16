// 任务三 C4·现场验收演示种子：对"运行中的交付栈"（delivery-up 拉起的 A@48180）走一遍贯穿场景前置，
// 造出可演示的客户/材料/评估/额度/两笔申请/检查会话（preparing 未开始，供现场演示开始/暂停/恢复）。
// 纪律：全部经真实 HTTP API + requestId 幂等；不写数据库、不跳过任何业务门。
// 每次运行新建一个客户（互不影响）；运行前提：delivery-up 已启动（本脚本不拉起服务）。
// 用法：node scripts/delivery-seed.mjs [--kernel-port 48180]
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EDGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt;
};
const port = Number(argOf('kernel-port', process.env.JW_A_PORT || 48180));
const base = `http://127.0.0.1:${port}`;

const cfg = JSON.parse(readFileSync(path.join(EDGE_ROOT, 'config', 'delivery-runtime.json'), 'utf8'));
const tokens = new Map();
for (const entry of cfg.principalTokens.split(',')) {
  const [token, spec] = entry.split('=');
  tokens.set(spec.split(':')[0], token); // principalId → credential
}
const call = async (who, method, p, body) => {
  const r = await fetch(`${base}${p}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-principal-credential': tokens.get(who) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (r.status !== 200 || j.ok !== true) throw new Error(`${method} ${p} → ${r.status}: ${JSON.stringify(j).slice(0, 220)}`);
  return j;
};
const rid = (p) => `seed-${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const wan = (n) => n * 1_000_000;
const T = 't1';

// 0) 前置：健康 + 模板/项目（admin；验收前一次性）
const health = await fetch(`${base}/healthz`).then((r) => r.json());
if (!health.ok || health.db !== 'up') throw new Error('A 内核未就绪（先运行 delivery-up.mjs）');
const tpl = await call('adm1', 'POST', '/api/v1/templates', {
  requestId: rid('tpl'), name: '交付演示模板', industry: null,
  roles: [{ roleKey: 'business', title: '业务', isHumanRole: true }],
  goals: [{ goalKey: 'intake', title: '受理', description: '演示', responsibleRole: 'business', executorKind: 'human', acceptanceRole: 'business', decisionRole: 'business', inputEvidenceKinds: [], dependsOn: [], params: {} }],
});
const proj = await call('adm1', 'POST', '/api/v1/projects', { requestId: rid('pj'), templateId: tpl.templateId, name: '交付演示项目' });

// 1) 客户 + 两台可区分设备的材料
const cust = await call('biz1', 'POST', '/api/v2/customers', {
  requestId: rid('cust'), tenantId: T, legalEntityRef: `USCC-DEMO-${Date.now().toString(36)}`, displayName: '演示·合成精密机械有限公司',
});
const customerId = cust.customerId;
const art = async (kind, factKey, content) => call('biz1', 'POST', `/api/v2/customers/${customerId}/artifacts`, {
  requestId: rid('art'), tenantId: T, kind, factKey, content, grade: 'source_supported',
});
await art('customer_profile', 'profile', { rev: 1 });
await art('purchase_contract', 'profile', { device: 'DEV-1', contractNo: `HT-${rid('d1')}`, amountMinor: wan(120) });
await art('purchase_contract', 'profile', { device: 'DEV-2', contractNo: `HT-${rid('d2')}`, amountMinor: wan(90) });

// 2) 评估 → 候选 → 待审（模型/Agent 候选 authority=none，批准走人类命令通道）
const ass = await call('cred1', 'POST', `/api/v2/customers/${customerId}/assessments`, {
  requestId: rid('as'), tenantId: T, ruleVersion: 'rules-delivery-demo',
  evidenceSnapshot: [{ artifactId: (await call('cred1', 'GET', `/api/v2/customers/${customerId}/artifacts`)).artifacts[0].artifactId }],
});
await call('cred1', 'POST', `/api/v2/assessments/${ass.assessmentId}/candidate`, {
  requestId: rid('cd'), tenantId: T,
  candidate: { tendency: 'do', supportableAmountMinor: wan(500), currency: 'CNY', rationale: '演示种子', producedBy: 'delivery-seed', conditions: ['按合同核验设备权属'], warnings: [] },
});
await call('cred1', 'POST', `/api/v2/assessments/${ass.assessmentId}/submit-review`, { requestId: rid('sr'), tenantId: T });

// 3) 额度提案 → 有权人类批准 → 激活（正式授信流程，全部留痕）
const prop = await call('cred1', 'POST', `/api/v2/customers/${customerId}/facilities`, {
  requestId: rid('pf'), tenantId: T, assessmentId: ass.assessmentId, approvedAmountMinor: wan(500), currency: 'CNY',
});
await call('app1', 'POST', `/api/v2/facilities/${prop.facilityId}/approve`, { requestId: rid('ap'), tenantId: T, rationale: '演示·有权人类批准' });
await call('app1', 'POST', `/api/v2/facilities/${prop.facilityId}/activate`, { requestId: rid('ac'), tenantId: T, rationale: '演示' });

// 4) 两笔不同交易方式的申请（未预占——现场演示"用信准备与预占"）
const fr = async (productType, amountMinor, device) => call('biz1', 'POST', `/api/v2/customers/${customerId}/financing-requests`, {
  requestId: rid('fr'), tenantId: T, facilityId: prop.facilityId, productType, amountMinor, currency: 'CNY', equipmentRefs: [device],
});
const fr1 = await fr('direct_lease', wan(100), 'DEV-1');
const fr2 = await fr('sale_leaseback', wan(80), 'DEV-2');

// 5) 检查会话（preparing——现场演示 开始/暂停自动提问/恢复/结束）
const ins = await call('biz1', 'POST', `/api/v1/projects/${proj.projectId}/inspections`, {
  requestId: rid('ins'), customerId, title: '演示·联合尽调检查会话', ownerRole: 'business',
  roles: [
    { roleKey: 'business', kind: 'human' }, { roleKey: 'director', kind: 'human' },
    { roleKey: 'customer', kind: 'human' }, { roleKey: 'asset_agent', kind: 'agent' },
  ],
  items: [{
    itemKey: 'dev1-ownership', title: '设备1权属核验', required: true,
    responsibleRole: 'business', targetRole: 'director', requiresHumanVerification: true,
    expectedEvidenceKinds: ['purchase_contract'], objectRef: 'DEV-1@scene-0',
    detail: { whyNeeded: '权属确认', expectedEvidence: '购销合同原件', stopCondition: 'confirmed' },
  }],
  planSnapshot: { prerequisites: ['purchase_contract'], source: 'delivery-seed' },
});

console.log('──────────────────────────────────────────────');
console.log('[delivery-seed] 演示数据已就绪（全部经真实 API 产生）：');
console.log(`  客户 ID（前端"连接真实后台"填这个）: ${customerId}`);
console.log(`  额度: 已批准 500 万（active）｜申请1: 直租 100 万 DEV-1（${fr1.frId}）｜申请2: 售后回租 80 万 DEV-2（${fr2.frId}）`);
console.log(`  检查会话: ${ins.sessionId}（preparing，未开始）`);
console.log('  现场建议动线：');
console.log('   1. Front 首页连接真实后台 → 用工作台看额度/核验卡');
console.log('   2. 会话操作条：开始会话 → 暂停自动提问（看等待原因）→ 恢复 → 结束本轮');
console.log('   3. 预占演示：任一终端对申请1/申请2 做 reserve（同一客户额度联动，超占会被拒）');
console.log('   4. 补证演示：登记不利材料→新批准被 Gate 阻断，历史决定保留');
console.log('──────────────────────────────────────────────');
