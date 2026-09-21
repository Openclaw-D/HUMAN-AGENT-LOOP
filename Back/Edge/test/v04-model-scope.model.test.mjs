// R2-03 材料scope贯穿模型调用与回执摘要 · 模型层专项（本地可计数替身，零真实出站）。
// 被测：assistant-model.mjs 的 selection 发送前独立复核与回执身份绑定（本任务 ownership 修改）。
// 只读依赖：assistant-evidence-provider/scope（02路交付）、assistant-receipts（03路基线）、B transport 替身。
// 每例断言替身真实命中数（不以 HTTP 返回码代替）；替身形态验证协议语义，不构成真实模型质量测试。
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createAssistantModel } from '../src/assistant-model.mjs';
import { createAssistantEvidenceProvider } from '../src/assistant-evidence-provider.mjs';
import { prepareEvidence } from '../src/assistant-evidence.mjs';
import { normalizeSelection } from '../src/assistant-evidence-scope.mjs';
import { digest } from '../src/assistant-receipts.mjs';
import { startTransportStub } from '../../B/test/v04-transport-stub.mjs';

const TEXT_A = '合成材料甲：申请设备回租500万元，合同未付余额为应收，需核对付款流水与发票一致。';
const TEXT_B = '合成材料乙：开票期间与经营流水期间不同，需核对期间归属与重复交易。';
const hashOf = t => createHash('sha256').update(t).digest('hex');
const HASH_A = hashOf(TEXT_A), HASH_B = hashOf(TEXT_B);

/** Connectors internal/assistant-evidence 计数替身：materials 库 + 可注入缺件（取代模拟）/500/跨户。 */
async function startConnectorsStub() {
  let hits = 0;
  const requests = [];
  const control = { omit: [], status500: false };
  const server = http.createServer((req, res) => {
    let raw = ''; req.on('data', c => raw += c);
    req.on('end', async () => {
      hits++; const body = JSON.parse(raw); requests.push(body);
      if (control.status500) { res.writeHead(500); res.end(JSON.stringify({ ok: false, error: 'STUB_DOWN' })); return; }
      const materials = body.artifactIds.filter(id => !control.omit.includes(id)).map(id => ({
        tenantId: body.tenantId, customerId: body.customerId, artifactId: id,
        evidenceId: 'ev-' + id, hash: id === 'art-a' ? HASH_A : HASH_B,
        parserVersion: 'v04-test-v1', current: true, text: id === 'art-a' ? TEXT_A : TEXT_B,
        facts: [], limitations: [],
      }));
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true, materials }));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const close = async () => { server.closeAllConnections(); return new Promise(r => server.close(r)); };
  return { url: `http://127.0.0.1:${server.address().port}`, hits: () => hits, requests, control, close };
}

async function fixture(tag) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'v04-ms-' + tag + '-'));
  const conn = await startConnectorsStub();
  const modelStub = await startTransportStub({ label: 'v04-model-scope' });
  const configPath = path.join(dir, 'model-config.json');
  const args = { configPath, receiptsDir: path.join(dir, 'model-state'), requireEvidence: true, log: () => { } };
  await fs.writeFile(configPath, JSON.stringify({
    transport: { mode: 'mock', mock: { baseUrl: modelStub.url, timeoutMs: 2000 } },
    evidencePolicy: { allowedHashes: [HASH_A, HASH_B] },
  }));
  const model = await createAssistantModel(args);
  const snapshot = { snapshot: { artifactsReadable: true, artifacts: [{ artifactId: 'art-a' }, { artifactId: 'art-b' }] } };
  const provider = createAssistantEvidenceProvider({ baseUrl: conn.url, token: 'synthetic-token', policy: model.evidencePolicy });
  const packOf = async artifactIds => provider({ snapshot, tenantId: 'tenant', customerId: 'cust', revision: '0', scope: { artifactIds } });
  const legacyPack = () => prepareEvidence({ tenantId: 'tenant', customerId: 'cust', revision: '0',
    allowedHashes: [HASH_A, HASH_B], maxChars: 6000, materials: [
      { tenantId: 'tenant', customerId: 'cust', artifactId: 'art-a', evidenceId: 'ev-art-a', hash: HASH_A, parserVersion: 'v04-test-v1', current: true, text: TEXT_A, facts: [], limitations: [] },
      { tenantId: 'tenant', customerId: 'cust', artifactId: 'art-b', evidenceId: 'ev-art-b', hash: HASH_B, parserVersion: 'v04-test-v1', current: true, text: TEXT_B, facts: [], limitations: [] },
    ] });
  const context = pack => ({ customerName: '合成客户', contextVersion: '0', assessmentState: 'awaiting_human_review',
    blockersCount: 0, materialsByDomain: {}, evidenceRefs: pack.snippets.map(s => ({ id: s.id, version: s.parserVersion, hash: s.hash })), evidencePack: pack });
  const bindObserve = m => (pack, over = {}) => m.observe({ customerId: 'cust', tenantId: 'tenant',
    assistant: 'credit', question: '请分析所选材料', context: context(pack), ...over });
  const observe = bindObserve(model);
  // 重启实例返回同形 observe 包装（新实例读同一持久回执目录）。
  const restart = async () => ({ observe: bindObserve(await createAssistantModel(args)) });
  const receiptFile = requestId => path.join(args.receiptsDir, 'receipts', encodeURIComponent(requestId) + '.json');
  const receiptsLeftovers = async () => (await fs.readdir(path.join(args.receiptsDir, 'receipts')).catch(() => []));
  const close = async () => { await conn.close(); await modelStub.close(); await fs.rm(dir, { recursive: true, force: true }); };
  return { dir, conn, modelStub, model, provider, snapshot, packOf, legacyPack, observe, restart, receiptFile, receiptsLeftovers, close };
}

test('MS-M-01 显式单件：请求正文只含所选、提示词与回执身份绑定所选材料、重放零出站', async () => {
  const f = await fixture('single');
  try {
    const pack = await f.packOf(['art-b']);
    assert.deepEqual(f.conn.requests[0].artifactIds, ['art-b'], '上游请求正文只含所选ID');
    assert.deepEqual(pack.selection, normalizeSelection({ snapshot: { artifactsReadable: true, artifacts: [{ artifactId: 'art-b' }] }, scope: { artifactIds: ['art-b'] } }),
      'pack.selection 与 scope 模块同一版本化算法产出一致');
    const r = await f.observe(pack);
    assert.equal(r.status, 'simulated');
    assert.equal(f.modelStub.hits(), 1);
    const prompt = f.modelStub.requests[0].body;
    assert.ok(prompt.includes(TEXT_B), '出站上下文含所选材料');
    assert.ok(!prompt.includes(TEXT_A), '出站上下文不含未选材料');
    const receipt = JSON.parse(await fs.readFile(f.receiptFile(r.requestId), 'utf8'));
    assert.equal(receipt.identity.context.evidencePack.selection.summary, pack.selection.summary, '选择摘要进入回执身份');
    const replay = await f.observe(pack);
    assert.equal(replay.replayed, true);
    assert.equal(f.modelStub.hits(), 1, '同选择同上下文重放零出站');
  } finally { await f.close(); }
});

test('MS-M-02 乱序/重复输入经规范摘要与干净输入同一身份：同 requestId 重放，不重复出站', async () => {
  const f = await fixture('canonical');
  try {
    const messy = await f.packOf(['art-b', 'art-a', 'art-b', 'art-a']);
    assert.deepEqual(messy.selection.artifactIds, ['art-a', 'art-b'], 'canonical 升序去重');
    assert.deepEqual(f.conn.requests.at(-1).artifactIds, ['art-a', 'art-b'], '上游请求正文为 canonical 集');
    const clean = await f.packOf(['art-a', 'art-b']);
    assert.deepEqual(messy, clean, '乱序重复输入与干净输入产出同一证据包');
    const first = await f.observe(messy);
    assert.equal(first.status, 'simulated');
    assert.equal(f.modelStub.hits(), 1);
    const second = await f.observe(clean);
    assert.equal(second.replayed, true, '同规范选择命中同一回执');
    assert.equal(second.requestId, first.requestId);
    assert.equal(f.modelStub.hits(), 1);
  } finally { await f.close(); }
});

test('MS-M-03 不同选择互不同一身份、不命中同一旧输出；各自重放零出站', async () => {
  const f = await fixture('distinct');
  try {
    const ra = await f.observe(await f.packOf(['art-a']));
    const rb = await f.observe(await f.packOf(['art-b']));
    const rl = await f.observe(f.legacyPack());
    assert.equal(f.modelStub.hits(), 3, '三种选择各出站一次');
    assert.notEqual(ra.requestId, rb.requestId);
    assert.notEqual(ra.requestId, rl.requestId, '显式选择不命中 legacy 旧输出');
    assert.notEqual(rb.requestId, rl.requestId);
    assert.equal((await f.observe(await f.packOf(['art-a']))).replayed, true);
    assert.equal((await f.observe(await f.packOf(['art-b']))).replayed, true);
    assert.equal((await f.observe(f.legacyPack())).replayed, true);
    assert.equal(f.modelStub.hits(), 3, '重放零新增出站');
  } finally { await f.close(); }
});

test('MS-M-04 selection 篡改/不一致/未选片段混入/形状非法：发送前失败关闭，零出站零围栏残留', async () => {
  const f = await fixture('tamper');
  try {
    const packB = await f.packOf(['art-b']);
    const packAB = await f.packOf(['art-a', 'art-b']);
    const packA = await f.packOf(['art-a']);
    const forgedSnippet = () => {
      // 哈希自洽但片段来自未选材料：专门命 M3（片段⊆所选），不被 digest 检查提前拦截。
      const forged = { ...packB, snippets: [...packB.snippets, packA.snippets[0]] };
      delete forged.hash; forged.hash = digest(forged); return forged;
    };
    const cases = [
      ['summary篡改', { ...packB, selection: { ...packB.selection, summary: '0'.repeat(64) } }, 'EVIDENCE_IDENTITY_MISMATCH'],
      ['artifactIds乱序', { ...packAB, selection: { ...packAB.selection, artifactIds: [...packAB.selection.artifactIds].reverse() } }, 'EVIDENCE_IDENTITY_MISMATCH'],
      ['mode改legacy', { ...packB, selection: { ...packB.selection, mode: 'legacy' } }, 'EVIDENCE_IDENTITY_MISMATCH'],
      ['多余键', { ...packB, selection: { ...packB.selection, note: 'x' } }, 'EVIDENCE_IDENTITY_MISMATCH'],
      ['未选片段混入', forgedSnippet(), 'EVIDENCE_IDENTITY_MISMATCH'],
      ['selection为字符串', { ...packB, selection: 'art-b' }, 'EVIDENCE_SCOPE_INVALID'],
      ['selection空数组', { ...packB, selection: { mode: 'explicit', artifactIds: [], summary: packB.selection.summary } }, 'EVIDENCE_SCOPE_EMPTY'],
    ];
    for (const [name, pack, code] of cases) {
      const r = await f.observe(pack);
      assert.equal(r.status, 'failed', name);
      assert.equal(r.sent, false, name);
      assert.equal(r.error.code, code, name);
    }
    assert.equal(await f.receiptsLeftovers().then(a => a.length), 0, '确定性发送前失败不留 claim/intent 残留');
    assert.equal(f.modelStub.hits(), 0, '全部零出站');
  } finally { await f.close(); }
});

test('MS-M-05 未知围栏（显式scope）：同进程与重启重试零重发；换选择是新身份而非绕过，原围栏不失效', async () => {
  const f = await fixture('unknown');
  try {
    const packA = await f.packOf(['art-a']);
    const packB = await f.packOf(['art-b']);
    f.modelStub.control.mode = 'destroy';
    const a = await f.observe(packA);
    assert.equal(a.status, 'unknown');
    assert.equal(f.modelStub.hits(), 1, '请求已到达替身：发送后未知');
    assert.equal((await f.observe(packA)).status, 'unknown');
    assert.equal(await (await f.restart()).observe(packA).then(r => r.status), 'unknown');
    assert.equal(f.modelStub.hits(), 1, '同进程与重启重试均不重复出站');
    f.modelStub.control.mode = 'ok';
    const b = await f.observe(packB);
    assert.equal(b.status, 'simulated');
    assert.equal(f.modelStub.hits(), 2, '不同选择=新身份，属现行契约允许的新调用');
    assert.notEqual(b.requestId, a.requestId);
    const aAgain = await f.observe(packA);
    assert.equal(aAgain.status, 'unknown');
    assert.equal(aAgain.replayed, true, '原未知回执围栏持续有效');
    assert.equal(f.modelStub.hits(), 2);
  } finally { await f.close(); }
});

test('MS-M-06 显式scope成功回执跨进程重启重放：零出站', async () => {
  const f = await fixture('restart');
  try {
    const pack = await f.packOf(['art-a', 'art-b']);
    const first = await f.observe(pack);
    assert.equal(first.status, 'simulated');
    assert.equal(f.modelStub.hits(), 1);
    const again = await (await f.restart()).observe(pack);
    assert.equal(again.replayed, true);
    assert.equal(again.requestId, first.requestId);
    assert.equal(f.modelStub.hits(), 1, '重启后持久回执重放');
  } finally { await f.close(); }
});
