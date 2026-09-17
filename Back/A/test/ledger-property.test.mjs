// 任务01 · 额度账本属性测试（固定种子）。
// 随机 reserve/release/commit/disburse/settle/cancel/replay 序列，逐操作对照 JS 模型：
// 金额守恒、有效占用 ≤ 批准额、无负桶、无未授权状态跃迁；失败序列留档 test/evidence/。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { client, newId, startKernel } from './utils.mjs';

const CAP = 1_000_000_000;
const wan = (n) => n * 1_000_000;
const SEED = 20260917;

const V2_SPEC = [
  'tok-biz1=biz1:human:business:all:t1',
  'tok-cred1=cred1:human:credit:all:t1',
  'tok-app1=app1:human:approver:all:t1',
].join(',');

// mulberry32：可复现伪随机
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// JS 模型：非循环设施（revolving=false）——与 facilityView 公式逐项对应
function modelBuckets(f) {
  const reserved = f.reserved;
  const committed = f.committed;
  const outstanding = f.disbursed - f.settled;
  return { reserved, committed, outstanding, lifetimeDisbursed: f.disbursed, exposureNow: reserved + committed + outstanding };
}

test(`账本属性：随机操作序列下金额守恒、占用不超限、状态跃迁合法（seed=${SEED}）`, async (t) => {
  const rand = prng(SEED);
  const k = await startKernel({ extraArgs: ['--credit-matrix', 'matrix-dev-synthetic-1', '--credit-concentration', 'conc-dev-synthetic-1', '--allow-legacy-basis'], principalSpec: V2_SPEC });
  const ops = [];
  try {
    await k.pool.query(
      `INSERT INTO permission_matrix (matrix_version, role, action, allowed, max_amount_minor) VALUES
         ('matrix-dev-synthetic-1','approver','facility.approve',true,$1),
         ('matrix-dev-synthetic-1','approver','facility.activate',true,$1),
         ('matrix-dev-synthetic-1','approver','facility.suspend',true,NULL),
         ('matrix-dev-synthetic-1','approver','facility.reduce',true,NULL)
       ON CONFLICT DO NOTHING`, [CAP]);
    const biz = client(k.base, 'tok-biz1');
    const cred = client(k.base, 'tok-cred1');
    const app = client(k.base, 'tok-app1');
    // 两个非循环设施：A=1000万，B=500万
    const facilities = [];
    for (const amount of [wan(1000), wan(500)]) {
      const custResp = await biz('POST', '/api/v2/customers', { requestId: newId('r'), tenantId: 't1', legalEntityRef: `USCC-P-${newId('x')}`, displayName: 'property-cust' });
      const custId = custResp.json.customerId;
      const art = await biz('POST', `/api/v2/customers/${custId}/artifacts`, { requestId: newId('r'), tenantId: 't1', kind: 'profile', content: { rev: 1 } });
      const ass = await cred('POST', `/api/v2/customers/${custId}/assessments`, { requestId: newId('r'), tenantId: 't1', ruleVersion: 'r1', evidenceSnapshot: [{ artifactId: art.json.artifactId }] });
      await cred('POST', `/api/v2/assessments/${ass.json.assessmentId}/candidate`, { requestId: newId('r'), tenantId: 't1', candidate: { tendency: 'do', supportableAmountMinor: amount, currency: 'CNY', rationale: '', producedBy: 't', conditions: [], warnings: [] } });
      await cred('POST', `/api/v2/assessments/${ass.json.assessmentId}/submit-review`, { requestId: newId('r'), tenantId: 't1' });
      const prop = await cred('POST', `/api/v2/customers/${custId}/facilities`, { requestId: newId('r'), tenantId: 't1', assessmentId: ass.json.assessmentId, approvedAmountMinor: amount, currency: 'CNY' });
      await app('POST', `/api/v2/facilities/${prop.json.facilityId}/approve`, { requestId: newId('r'), tenantId: 't1', rationale: 'p' });
      await app('POST', `/api/v2/facilities/${prop.json.facilityId}/activate`, { requestId: newId('r'), tenantId: 't1', rationale: 'p' });
      facilities.push({ facilityId: prop.json.facilityId, customerId: custId, approved: amount, frs: [], reserved: 0, committed: 0, disbursed: 0, settled: 0 });
    }

    const pick = (arr) => arr[Math.floor(rand() * arr.length)];
    const amt = () => wan(1 + Math.floor(rand() * 120)); // 1万..120万

    // ============ 随机操作序列 ============
    for (let step = 0; step < 120; step++) {
      const f = pick(facilities);
      const candidates = ['create_fr', 'replay'];
      if (f.frs.some((x) => x.state === 'submitted')) candidates.push('reserve', 'cancel_submitted');
      if (f.frs.some((x) => x.state === 'reserved')) candidates.push('release', 'commit');
      if (f.frs.some((x) => x.state === 'committed')) candidates.push('disburse');
      if (f.frs.some((x) => x.state === 'disbursed')) candidates.push('settle');
      const op = pick(candidates);
      const entry = { step, op, facility: facilities.indexOf(f) };

      if (op === 'create_fr') {
        const amount = amt();
        const r = await biz('POST', `/api/v2/customers/${f.customerId}/financing-requests`, {
          requestId: newId('r'), tenantId: 't1', facilityId: f.facilityId, productType: 'direct_lease', amountMinor: amount, currency: 'CNY',
        });
        assert.equal(r.status, 200, `step${step}: ${JSON.stringify(r.json)}`);
        f.frs.push({ frId: r.json.frId, amount, state: 'submitted', reserveRid: null });
        entry.detail = { created: r.json.frId, amount };
      } else if (op === 'reserve') {
        const fr = pick(f.frs.filter((x) => x.state === 'submitted'));
        const rid = `prop-${newId('x')}`;
        const r = await biz('POST', `/api/v2/financing-requests/${fr.frId}/reserve`, { requestId: rid, tenantId: 't1' });
        if (r.status === 200) {
          fr.state = 'reserved'; fr.reserveRid = rid;
          f.reserved += fr.amount;
        } else {
          assert.equal(r.status, 409, `step${step}: reserve 非预期失败 ${JSON.stringify(r.json)}`);
          assert.equal(r.json.error, 'INSUFFICIENT_AVAILABLE_AMOUNT', `step${step}: ${JSON.stringify(r.json)}`);
        }
        entry.detail = { fr: fr.frId, outcome: r.status };
      } else if (op === 'release' || op === 'cancel_submitted') {
        const state = op === 'release' ? 'reserved' : 'submitted';
        const fr = pick(f.frs.filter((x) => x.state === state));
        const r = await biz('POST', `/api/v2/financing-requests/${fr.frId}/release`, { requestId: newId('r'), tenantId: 't1' });
        assert.equal(r.status, 200, `step${step}: ${JSON.stringify(r.json)}`);
        if (state === 'reserved') f.reserved -= fr.amount;
        fr.state = 'cancelled';
        entry.detail = { fr: fr.frId };
      } else if (op === 'commit') {
        const fr = pick(f.frs.filter((x) => x.state === 'reserved'));
        const r = await biz('POST', `/api/v2/financing-requests/${fr.frId}/commit`, { requestId: newId('r'), tenantId: 't1' });
        assert.equal(r.status, 200, `step${step}: ${JSON.stringify(r.json)}`);
        f.reserved -= fr.amount; f.committed += fr.amount;
        fr.state = 'committed';
        entry.detail = { fr: fr.frId };
      } else if (op === 'disburse') {
        const fr = pick(f.frs.filter((x) => x.state === 'committed'));
        const r = await biz('POST', `/api/v2/financing-requests/${fr.frId}/disburse`, { requestId: newId('r'), tenantId: 't1' });
        assert.equal(r.status, 200, `step${step}: ${JSON.stringify(r.json)}`);
        f.committed -= fr.amount; f.disbursed += fr.amount;
        fr.state = 'disbursed';
        entry.detail = { fr: fr.frId };
      } else if (op === 'settle') {
        const fr = pick(f.frs.filter((x) => x.state === 'disbursed'));
        const rid = `settle-${fr.frId}`;
        const r1 = await biz('POST', `/api/v2/financing-requests/${fr.frId}/settle`, { requestId: rid, tenantId: 't1' });
        assert.equal(r1.status, 200, `step${step}: ${JSON.stringify(r1.json)}`);
        // 同键重放：零额外效应（retry 语义）
        const r2 = await biz('POST', `/api/v2/financing-requests/${fr.frId}/settle`, { requestId: rid, tenantId: 't1' });
        assert.equal(r2.status, 200);
        assert.equal(r2.json.replayed, true, `step${step}: settle 重放必须 replayed`);
        f.settled += fr.amount;
        fr.state = 'settled';
        entry.detail = { fr: fr.frId };
      } else { // replay：最近一次预占的重放
        const reserved = f.frs.filter((x) => x.state === 'reserved' && x.reserveRid !== null);
        if (reserved.length === 0) { entry.detail = { skipped: true }; ops.push(entry); continue; }
        const fr = pick(reserved);
        const r = await biz('POST', `/api/v2/financing-requests/${fr.frId}/reserve`, { requestId: fr.reserveRid, tenantId: 't1' });
        assert.equal(r.status, 200, `step${step}: ${JSON.stringify(r.json)}`);
        assert.equal(r.json.replayed, true, `step${step}: 同键重放必须 replayed`);
        entry.detail = { fr: fr.frId, replayed: true };
      }
      ops.push(entry);

      // ============ 逐操作对照服务端推导视图 ============
      const view = await biz('GET', `/api/v2/facilities/${f.facilityId}`);
      assert.equal(view.status, 200);
      const expect = modelBuckets(f);
      const got = view.json.exposure;
      const label = `seed=${SEED} step=${step} op=${op}`;
      assert.equal(got.reservedMinor, expect.reserved, `${label} reserved 不守恒`);
      assert.equal(got.committedMinor, expect.committed, `${label} committed 不守恒`);
      assert.equal(got.outstandingMinor, expect.outstanding, `${label} outstanding 不守恒`);
      assert.equal(got.lifetimeDisbursedMinor, expect.lifetimeDisbursed, `${label} lifetimeDisbursed 不守恒`);
      assert.equal(got.exposureNowMinor, expect.exposureNow, `${label} exposureNow 不守恒`);
      assert.ok(got.exposureNowMinor <= f.approved, `${label} 有效占用超过批准额`);
      for (const [name, v] of Object.entries({ reserved: got.reservedMinor, committed: got.committedMinor, outstanding: got.outstandingMinor })) {
        assert.ok(v >= 0, `${label} ${name} 出现负值：${v}`);
      }
      const availableRaw = f.approved - expect.lifetimeDisbursed - expect.committed - expect.reserved;
      assert.equal(got.availableForNewDrawMinor, Math.max(0, availableRaw), `${label} available 公式不符`);
    }
  } catch (error) {
    // 失败序列留档（固定种子可复现）
    try {
      mkdirSync('test/evidence', { recursive: true });
      writeFileSync(`test/evidence/ledger-property-failure-seed-${SEED}.json`, JSON.stringify({ seed: SEED, ops, message: String(error) }, null, 2));
    } catch { /* 留档失败不掩盖原错误 */ }
    throw error;
  } finally {
    await k.stop();
  }
});
