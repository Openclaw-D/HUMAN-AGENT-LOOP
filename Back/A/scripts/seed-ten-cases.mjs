// 收尾02 · 十案例种子器：真实执行检查点（模拟的只是材料与外部事件；解析/规则/状态机/权限/持久化全真实）。
// 批次：'checkpoint'=登记材料并实际执行到该例检查点停（留执行历史）；'fresh'=只建客户+登记初始材料（从头体验）。
// 禁止直写业务表造结果；全部动作走 kernel.v2 / advance 引擎既有授权命令（requestId 幂等、审计留痕）。
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { CASES, caseFacts, FINANCIAL_KEYS, EQUIPMENT_KEYS, TRANSACTION_SCOPE } from './ten-cases-fixtures.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const MATERIALS = path.join(repo, 'docs/integration/2026-09-30-final/materials');
const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

export async function seedTenCases({ kernel, advance, cycles, adminCredential, humanCredential, serviceCredential, tenantId, run, batch = 'checkpoint', resetRegistry = true }) {
  const cred = { credential: humanCredential, tenantId };
  if (resetRegistry) await kernel.pool.query('DELETE FROM arrow_case_registry'); // 登记配置非业务执行结果：同库可重复种子
  const results = [];
  for (const c of CASES) {
    const facts = caseFacts(c);
    const customer = await kernel.v2.createCustomer({ ...cred, requestId: `ten:${run}:${c.caseId}:customer`,
      displayName: c.businessName, legalEntityRef: `SYNTHETIC-ARROW-TEN-${run}-${c.caseId}` });
    const cid = customer.customerId;
    // 材料登记：每事实一工件，content 携带来源文件（文件名+行号+sha256+全文），与 materials/ MANIFEST 同源。
    const fileText = {};
    const fileHash = {};
    for (const f of ['financial_summary.csv', 'equipment_list.csv', ...(c.extraConflict ? [c.extraConflict.fileName] : [])]) {
      fileText[f] = await readFile(path.join(MATERIALS, c.caseId, f), 'utf8');
      fileHash[f] = sha256(fileText[f]);
    }
    const lineOf = (fileName, factKey) => fileText[fileName].split('\n').findIndex(l => l.startsWith(factKey + ',')) + 1;
    const reg = async (factKey, fileName, override = {}) => {
      const f = { ...facts[factKey], ...override };
      return kernel.v2.registerArtifact({ ...cred, requestId: randomUUID(), kind: FINANCIAL_KEYS.includes(factKey) ? 'financial_statement' : 'equipment_list',
        factKey, grade: f.grade,
        content: { value: f.value, unit: f.unit, sourceMode: 'synthetic_declared', factKey,
          originFile: { name: fileName, sha256: fileHash[fileName], line: lineOf(fileName, factKey) }, fileText: fileText[fileName] },
        materialMeta: { subjectRef: cid, unit: f.unit, caliber: 'synthetic_declared' } }, cid);
    };
    const artifacts = {};
    for (const k of FINANCIAL_KEYS) artifacts[k] = (await reg(k, 'financial_summary.csv')).artifactId;
    for (const k of EQUIPMENT_KEYS) artifacts[k] = (await reg(k, 'equipment_list.csv')).artifactId;
    if (c.extraConflict) {
      const fileName = c.extraConflict.fileName;
      artifacts[`${c.extraConflict.factKey}:conflict`] = (await kernel.v2.registerArtifact({ ...cred, requestId: randomUUID(),
        kind: 'financial_statement', factKey: c.extraConflict.factKey, grade: c.extraConflict.grade,
        content: { value: c.extraConflict.value, unit: 'CNY', sourceMode: 'synthetic_declared', factKey: c.extraConflict.factKey,
          originFile: { name: fileName, sha256: fileHash[fileName], line: 2 }, fileText: fileText[fileName] },
        materialMeta: { subjectRef: cid, unit: 'CNY', caliber: 'synthetic_declared' } }, cid)).artifactId;
    }
    // 交易范围（引擎依赖图必需）
    await kernel.v2.registerArtifact({ ...cred, requestId: randomUUID(), kind: 'legal_document', factKey: 'transaction_scope', grade: 'confirmed',
      content: { value: TRANSACTION_SCOPE, sourceMode: 'synthetic_declared', factKey: 'transaction_scope' },
      materialMeta: { subjectRef: cid, unit: null, caliber: 'synthetic_declared' } }, cid);
    // 案例登记（A 权威目录；admin）
    await registerCase({ kernel, adminCredential, caseId: c.caseId, customerId: cid,
      displayOrder: c.displayOrder, category: c.category, businessName: c.businessName, summary: c.summary, batch });

    const out = { ...c, customerId: cid, artifacts };
    if (batch === 'fresh' || !c.recipe?.advance) { results.push(out); continue; }

    // ---- 以下为 checkpoint 批次配方执行（每步真实 API/命令，留历史）----
    const domain = 'business';
    await advanceOnce({ kernel, advance, humanCredential, tenantId, cid, domain });
    if (c.recipe.verificationRegistrations && c.recipe.postAdvance === 'readvance') { // case-02：核验登记（检查点本体）→ 受影响区重算
      for (const v of c.recipe.verificationRegistrations)
        await kernel.v2.registerArtifact({ ...cred, requestId: randomUUID(), kind: FINANCIAL_KEYS.includes(v.factKey) ? 'financial_statement' : 'equipment_list',
          factKey: v.factKey, grade: v.grade,
          content: { value: v.value, unit: null, sourceMode: 'human_verified_document', factKey: v.factKey, note: v.note,
            originFile: { name: `verification-${v.factKey}.json`, sha256: sha256(v.note), line: 1 } },
          materialMeta: { subjectRef: cid, unit: null, caliber: '人工核验原件后登记（合成）' } }, cid);
      await advanceOnce({ kernel, advance, humanCredential, tenantId, cid, domain: 'asset' }); // 权属核验只影响 asset/policy；对受影响域重算
      if (c.caseId === 'case-02') await adoptExpectConflict({ kernel, advance, humanCredential, cid, domain: 'asset' }); // HARD_BLOCK 采用被拒（留痕）
    }
    if (c.recipe.adoptDomains) {
      const domains = c.recipe.adoptDomains === 'all' ? ['business', 'policy', 'credit', 'commerce', 'asset'] : c.recipe.adoptDomains;
      for (const d of domains) await adoptOne({ kernel, advance, humanCredential, cid, domain: d });
    }
    if (c.recipe.supplement) { // case-04 不在此执行（停在待补件）；case-07 补证是检查点本体
      if (c.caseId === 'case-07') {
        const s = c.recipe.supplement;
        await kernel.v2.registerArtifact({ ...cred, requestId: randomUUID(), kind: 'equipment_list', factKey: s.factKey, grade: s.grade,
          supersedes: artifacts[s.factKey],
          content: { value: s.value, unit: 'CNY', sourceMode: 'human_verified_document', factKey: s.factKey, note: s.note },
          materialMeta: { subjectRef: cid, unit: 'CNY', caliber: '人工核实后登记（合成）' } }, cid);
      }
    }
    if (c.recipe.preassessment) { // case-08：评估链 + Gate CLEAR，停在待确认
      const artifactIds = Object.entries(artifacts).filter(([k]) => !k.includes(':conflict')).map(([, v]) => v);
      const ass = await kernel.v2.createAssessment({ ...cred, requestId: randomUUID(), ruleVersion: '1.0.0', evidenceSnapshot: artifactIds.map(artifactId => ({ artifactId })) }, cid);
      await kernel.v2.submitCandidate({ ...cred, requestId: randomUUID(),
        candidate: { tendency: c.recipe.preassessment.candidateTendency, producedBy: 'arrow-case-demo-v1',
          rationale: '五区协同候选（确定性，authority=none）；预评估范围', basisRefs: artifactIds } }, String(ass.assessmentId));
      await kernel.v2.submitForReview({ ...cred, requestId: randomUUID() }, String(ass.assessmentId));
      await kernel.analysis.registerGateReceipt({ credential: serviceCredential, tenantId, requestId: randomUUID(),
        result: 'CLEAR', rulesetVersion: '1.0.0', reasonCodes: [], ruleIds: [], evidenceRefs: artifactIds }, cid);
      out.assessmentId = String(ass.assessmentId);
    }
    if (c.recipe.cycle) {
      const open = await cycles.open({ ...cred, requestId: randomUUID() }, cid);
      out.cycleId = String(open.cycle.cycleId);
      if (c.recipe.cycle.fulfill) await cycles.transition({ ...cred, requestId: randomUUID() }, cid, out.cycleId, 'fulfill');
      if (c.recipe.cycle.externalReceipt) await cycles.transition({ ...cred, requestId: randomUUID(), ref: c.recipe.cycle.externalReceipt.ref, source: c.recipe.cycle.externalReceipt.source }, cid, out.cycleId, 'external-receipt');
      if (c.recipe.cycle.settle) await cycles.transition({ ...cred, requestId: randomUUID() }, cid, out.cycleId, 'settle');
      if (c.recipe.cycle.close) await cycles.transition({ ...cred, requestId: randomUUID() }, cid, out.cycleId, 'close');
    }
    results.push(out);
  }
  return results;
}

async function registerCase({ kernel, adminCredential, ...body }) {
  const { buildCaseDirectory } = await import('../src/domain/case-directory.ts');
  const directory = buildCaseDirectory(kernel);
  await directory.register({ credential: adminCredential, requestId: `ten:register:${body.caseId}`, ...body });
}

async function procVersion(kernel, cid) {
  return Number((await kernel.pool.query('SELECT version FROM arrow_processes WHERE customer_id=$1 ORDER BY created_at DESC LIMIT 1', [cid])).rows[0].version);
}
async function advanceOnce({ advance, humanCredential, cid, domain }) {
  const p = await advance.getPlan(humanCredential, cid, domain);
  if (!p.available) throw new Error(`advance 不可用: ${JSON.stringify({ cid, reason: p.reason })}`);
  await advance.advance({ credential: humanCredential, requestId: randomUUID(), domain, planId: p.planId, planHash: p.planHash,
    expectedVersion: p.expectedVersion, roundNo: p.roundNo, actionIds: p.actionIds }, cid);
  await advance.drain();
}
async function adoptOne({ kernel, advance, humanCredential, cid, domain }) {
  const read = await advance.read(humanCredential, cid, { domain });
  const j = read.receipt;
  const version = await procVersion(kernel, cid);
  const x = await advance.decide({ credential: humanCredential, requestId: randomUUID(), decision: 'adopt',
    resultId: j.actions[0].result.resultId, expectedVersion: version, rationale: '有权人工采用（十案例种子，检查点展示批次）' }, cid, j.roundId);
  if (!x.ok) throw new Error(`adopt 失败: ${JSON.stringify({ cid, domain, x: x.ok })}`);
}
/** case-02：对 HARD_BLOCK 候选发起 adopt，预期 409 留痕（负例即检查点演示的组成部分）。 */
async function adoptExpectConflict({ kernel, advance, humanCredential, cid, domain }) {
  const read = await advance.read(humanCredential, cid, { domain });
  const j = read.receipt;
  const version = await procVersion(kernel, cid);
  let conflicted = false;
  try {
    await advance.decide({ credential: humanCredential, requestId: randomUUID(), decision: 'adopt',
      resultId: j.actions[0].result.resultId, expectedVersion: version, rationale: '尝试采用硬阻断候选（应被拒）' }, cid, j.roundId);
  } catch (e) { conflicted = String(e?.message ?? e).includes('HARD_BLOCK_NOT_ADOPTABLE'); }
  if (!conflicted) throw new Error(`case-02 预期 HARD_BLOCK 采用被拒，实际未拒: ${cid}`);
}
