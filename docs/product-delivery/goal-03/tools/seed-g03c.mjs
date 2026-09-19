// goal-03c 部署种子工具（管理员初始化的一部分，非用户路径）：
// 为指定 customerId 建立 v1 模板/项目与检查会话（preparing），供工作本"问题·补证"面板演示。
// 直连本轮 A 内核（17933），凭据经环境变量传入（adm1/biz1 令牌原文），不写入任何文件。
// 用法：G03C_ADM=<adm1令牌> G03C_BIZ=<biz1令牌> node seed-g03c.mjs <customerId> [aBase=http://127.0.0.1:17933]
import process from 'node:process';

const [customerId, aBase = 'http://127.0.0.1:17933'] = process.argv.slice(2);
const admTok = process.env.G03C_ADM || '';
const bizTok = process.env.G03C_BIZ || '';
if (!customerId || !admTok || !bizTok) {
  console.error('用法: G03C_ADM=<adm1令牌> G03C_BIZ=<biz1令牌> node seed-g03c.mjs <customerId> [aBase]');
  process.exit(2);
}
const rid = (p) => `${p}-g03c-${Date.now().toString(36)}`.slice(0, 128);

async function call(cred, method, path, body) {
  const r = await fetch(`${aBase}${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-principal-credential': cred },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(j).slice(0, 300)}`);
  return j;
}

const tpl = await call(admTok, 'POST', '/api/v1/templates', {
  requestId: rid('tpl'), name: 'goal-03c 演示模板', industry: null,
  roles: [
    { roleKey: 'business', title: '业务', isHumanRole: true },
    { roleKey: 'customer_owner', title: '客户实控人', isHumanRole: true },
    { roleKey: 'customer_finance', title: '客户财务', isHumanRole: true },
    { roleKey: 'customer_plant', title: '客户厂长', isHumanRole: true },
  ],
  goals: [{ goalKey: 'intake', title: '受理', description: '演示', responsibleRole: 'business', executorKind: 'human', acceptanceRole: 'business', decisionRole: 'business', inputEvidenceKinds: [], dependsOn: [], params: {} }],
});
const proj = await call(admTok, 'POST', '/api/v1/projects', {
  requestId: rid('pj'), templateId: tpl.templateId, name: `goal-03c 演示项目 ${customerId}`,
});
console.log('[seed] template/project:', tpl.templateId, proj.projectId);

const ins = await call(bizTok, 'POST', `/api/v1/projects/${proj.projectId}/inspections`, {
  requestId: rid('ins'), customerId, title: 'goal-03c·联合尽调检查会话', ownerRole: 'business',
  roles: [
    { roleKey: 'business', kind: 'human' },
    { roleKey: 'customer_owner', kind: 'human' },
    { roleKey: 'customer_finance', kind: 'human' },
    { roleKey: 'customer_plant', kind: 'human' },
  ],
  items: [{
    itemKey: 'ownership-verify', title: '设备权属核验', required: true,
    responsibleRole: 'business', targetRole: 'customer_owner', requiresHumanVerification: true,
    expectedEvidenceKinds: ['purchase_contract'], objectRef: 'DEV-1@scene-0',
    detail: { whyNeeded: '权属确认', expectedEvidence: '购销合同原件', stopCondition: 'confirmed' },
  }],
  planSnapshot: { prerequisites: ['purchase_contract'], source: 'goal-03c-seed' },
});
console.log('[seed] inspection session:', ins.sessionId, ins.runStatus);
console.log('[seed] DONE customerId=', customerId);
