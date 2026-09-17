// E1·任务三 贯穿场景（C02/C03/C04/C05/C07/C11 单轮自动化核心；automated client，如实标注）：
//   九个独立 Edge 会话（九角色目录）→ 客户建档 → 材料 → 评估/候选/待审 → 提案/批准/激活
//   → 两笔不同交易方式申请并发预占（同客户约束）→ 超占拒绝 → 回执幂等重试 →
//   不利材料 + 取代 → 新批准被 STALE_BASIS 阻断且历史决定保留 → 中途停库重启 → 无丢失无双重效应。
// 运行：node --test test/e1/e1-task3-scenario.test.mjs（需 docker + 15434/17919 空闲）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { checkTask3Gate } from './task3-gate.mjs';

const gate = await checkTask3Gate();
const skipReason = gate.ok ? false : `任务三 E1 门未过: ${gate.reasons.join('; ')}`;
const wan = (n) => n * 1_000_000;
const rid = (p) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

async function readSse(base, path, headers, { timeoutMs = 9000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const frames = [];
  try {
    const res = await fetch(`${base}${path}`, { headers, signal: controller.signal });
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    try {
      for (; ;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const ev = { event: null, data: null, id: null };
          for (const line of frame.split('\n')) {
            if (line.startsWith('event:')) ev.event = line.slice(6).trim();
            else if (line.startsWith('data:')) ev.data = line.slice(5).trim();
            else if (line.startsWith('id:')) ev.id = line.slice(3).trim();
          }
          if (ev.event) frames.push(ev);
        }
      }
    } catch { /* 超时中断即停止读取 */ }
  } catch { /* abort */ }
  clearTimeout(timer);
  return frames;
}

test('E1·任务三 贯穿场景（automated 九会话矩阵 + 信用链 + Gate 阻断 + 重启恢复）', { skip: skipReason }, async (t) => {
  const { bootStack } = await import('./task3-boot.mjs');
  const B = await bootStack({ t, runName: 'task3-e2e' });
  const { call, sessions } = B;
  const T1 = 't1';

  // ---- [C02] 九个独立授权会话；连接矩阵如实标注 automated ----
  const ids = Object.keys(sessions);
  assert.equal(ids.length, 10, '九角色 + admin(setup) 会话齐备');
  assert.equal(new Set(ids).size, ids.length, 'principalId 两两不同');
  const matrix = {
    capturedAt: new Date().toISOString(),
    kind: 'automated-client',
    note: '自动化客户端矩阵：证明九角色独立授权会话与权限分发；三物理终端/真人视角属用户现场验收（NOT_RUN）',
    sessions: ids.map((p) => ({ principalId: p, roles: sessions[p].roles, roleLabel: { biz1: '业务', jw1: '见微', pol1: '政策', cred1: '信审', comm1: '商务', asset1: '资产', app1: '有权人类', dir1: '厂长', cust1: '客户实控人', adm1: 'admin(setup)' }[p] || p })),
  };
  writeFileSync(`${B.RUN_DIR}/connection-matrix.json`, JSON.stringify(matrix, null, 2));

  // ---- [C01/C06] 版本可核对 + readiness 逐依赖独立 ----
  const vz = await (await fetch(`${B.base}/versionz`)).json();
  assert.match(vz.buildId, /^[0-9a-f]{16}$/, 'versionz buildId 可核对');
  const ready = await (await fetch(`${B.base}/healthz/ready`)).json();
  assert.equal(ready.ok, true, '全依赖在线 readiness ok');
  assert.equal(ready.capabilities.all_ok, undefined, '禁止 all_ok 汇总');

  // ---- 建档（经 Edge 动作代理）+ 幂等重放（同载荷 replayed；异载荷 409 冲突） ----
  const custRid = rid('cust');
  const custPayload = { requestId: custRid, tenantId: T1, legalEntityRef: `USCC-E1-${rid('e')}`, displayName: '合成精密机械有限公司（E1任务三）' };
  const c1 = await call('biz1', 'POST', '/api/jw/v2/actions/customers', custPayload);
  assert.equal(c1.status, 200, `建档失败: ${JSON.stringify(c1.json)}`);
  const customerId = c1.json.customerId;
  const c1replay = await call('biz1', 'POST', '/api/jw/v2/actions/customers', { ...custPayload });
  assert.equal(c1replay.json.replayed, true, '同 requestId 同载荷重放 → 原效应（replayed:true，响应丢失后安全重试）');
  const c1conflict = await call('biz1', 'POST', '/api/jw/v2/actions/customers', { ...custPayload, requestId: rid('cust') });
  assert.equal(c1conflict.status, 409, '新 requestId 撞同租户同主体 → 409 CUSTOMER_EXISTS');
  assert.equal(c1conflict.json.error, 'CUSTOMER_EXISTS');

  // ---- workspace：live 投影 + 会话必需 + 404 不泄露 ----
  const wsAnon = await call(null, 'GET', `/api/jw/v2/customers/${customerId}/workspace`);
  assert.equal(wsAnon.status, 403, '无会话读 workspace → Edge 鉴权层 403（先于内核投影）');
  assert.equal(wsAnon.json.error, 'SESSION_REQUIRED', 'live 语义：需要会话');
  const wsNone = await call('biz1', 'GET', `/api/jw/v2/customers/cust-not-exist/workspace`);
  assert.equal(wsNone.status, 404, '不存在客户 404（不泄露存在性）');
  const ws1 = await call('biz1', 'GET', `/api/jw/v2/customers/${customerId}/workspace`);
  assert.equal(ws1.status, 200);
  assert.equal(ws1.json.source, 'kernel', 'live 投影来源标注 kernel');
  assert.equal(ws1.json.snapshot.customer.displayName, '合成精密机械有限公司（E1任务三）');
  const wsCust = await call('cust1', 'GET', `/api/jw/v2/customers/${customerId}/workspace`);
  assert.equal(wsCust.status, 200, `客户实控人读工作台: ${JSON.stringify(wsCust.json)}`);
  assert.ok(
    (wsCust.json.snapshot?.facilities?.length ?? 0) >= 0 && wsCust.json.snapshot?.customer,
    '客户会话获得快照主体（服务端按角色分发的部分）',
  );
  assert.ok(
    (wsCust.json.projection?.notes ?? []).some((n) => n.includes('受限') || n.includes('事件补取失败')),
    '客户会话的事件流受限如实标注（A 侧 B13：customer 角色不授证据/事件读取；Edge 不绕道）',
  );

  // ---- [C04] SSE：订阅后真实动作 → 事件到达；信封字段符合协议 ----
  const sseHeaders = { 'x-jw-session': sessions.biz1.sessionId, accept: 'text/event-stream' };
  const ssePromise = readSse(B.base, `/api/jw/v2/customers/${customerId}/events`, sseHeaders, { timeoutMs: 9000 });
  await new Promise((r) => setTimeout(r, 600));
  const art1Rid = rid('art');
  const art1 = await call('biz1', 'POST', `/api/jw/v2/actions/customers/${customerId}/artifacts`, {
    requestId: art1Rid, tenantId: T1, kind: 'purchase_contract', factKey: 'profile',
    content: { device: 'DEV-1', contractNo: `HT-${rid('c')}`, amountMinor: wan(120) }, grade: 'source_supported',
  });
  assert.equal(art1.status, 200, `材料登记失败: ${JSON.stringify(art1.json)}`);
  const frames = await ssePromise;
  const cursorFrame = frames.find((f) => f.event === 'cursor');
  assert.ok(cursorFrame, 'SSE 先收到 cursor 基线');
  const bizFrames = frames.filter((f) => f.event === 'business');
  const artEvent = bizFrames.find((f) => f.data && JSON.parse(f.data).payloadRef?.type === 'ARTIFACT_REGISTERED');
  assert.ok(artEvent, '真实动作产生的事件经 SSE 到达（收新事件才触发，不剧本补成）');
  const artEnv = JSON.parse(artEvent.data);
  assert.equal(artEnv.schemaVersion, 'jw.event.v1');
  assert.equal(artEnv.scope.customer, customerId);
  assert.equal(artEnv.eventId, artEvent.id, 'SSE id 与信封 eventId 一致（游标可补取）');

  // ---- 信用链：评估 → 候选 → 待审 → 提案 → 批准 → 激活 ----
  const ass = await call('cred1', 'POST', `/api/jw/v2/actions/customers/${customerId}/assessments`, {
    requestId: rid('as'), tenantId: T1, ruleVersion: 'rules-e1-task3', evidenceSnapshot: [{ artifactId: art1.json.artifactId }],
  });
  assert.equal(ass.status, 200, `评估创建失败: ${JSON.stringify(ass.json)}`);
  const assessmentId = ass.json.assessmentId;
  const cand = await call('cred1', 'POST', `/api/jw/v2/actions/assessments/${assessmentId}/candidate`, {
    requestId: rid('cd'), tenantId: T1,
    candidate: { tendency: 'do', supportableAmountMinor: wan(500), currency: 'CNY', rationale: 'e1-task3', producedBy: 'task3-e1-automated', conditions: [], warnings: [] },
  });
  assert.equal(cand.status, 200, `候选失败: ${JSON.stringify(cand.json)}`);
  assert.equal(cand.json.candidate?.authority ?? 'none', 'none', '候选 authority 恒 none');
  const sr = await call('cred1', 'POST', `/api/jw/v2/actions/assessments/${assessmentId}/submit-review`, { requestId: rid('sr'), tenantId: T1 });
  assert.equal(sr.status, 200, `提交待审失败: ${JSON.stringify(sr.json)}`);
  const prop = await call('cred1', 'POST', `/api/jw/v2/actions/customers/${customerId}/facilities`, {
    requestId: rid('pf'), tenantId: T1, assessmentId, approvedAmountMinor: wan(500), currency: 'CNY',
  });
  assert.equal(prop.status, 200, `额度提案失败: ${JSON.stringify(prop.json)}`);
  const facilityId = prop.json.facilityId;

  // [C03] 角色不提权：见微/业务不在批准矩阵 → POLICY_PENDING（服务端目录裁决）
  const jwApprove = await call('jw1', 'POST', `/api/jw/v2/actions/facilities/${facilityId}/approve`, { requestId: rid('ap'), tenantId: T1, rationale: '越权尝试' });
  assert.equal(jwApprove.status, 409, '见微批准 → 409');
  assert.equal(jwApprove.json.error, 'POLICY_PENDING', `见微批准被矩阵拒绝: ${JSON.stringify(jwApprove.json)}`);

  const ap1 = await call('app1', 'POST', `/api/jw/v2/actions/facilities/${facilityId}/approve`, { requestId: rid('ap'), tenantId: T1, rationale: 'e1-task3 有权人类' });
  assert.equal(ap1.status, 200, `批准失败: ${JSON.stringify(ap1.json)}`);
  const ac1 = await call('app1', 'POST', `/api/jw/v2/actions/facilities/${facilityId}/activate`, { requestId: rid('ac'), tenantId: T1, rationale: 'e1-task3' });
  assert.equal(ac1.status, 200, `激活失败: ${JSON.stringify(ac1.json)}`);

  // ---- 两笔不同交易方式申请 + 并发预占（同客户约束） ----
  const fr1 = await call('biz1', 'POST', `/api/jw/v2/actions/customers/${customerId}/financing-requests`, {
    requestId: rid('fr'), tenantId: T1, facilityId, productType: 'direct_lease', amountMinor: wan(100), currency: 'CNY', equipmentRefs: ['DEV-1'],
  });
  assert.equal(fr1.status, 200, `FR1 创建失败: ${JSON.stringify(fr1.json)}`);
  const fr2 = await call('biz1', 'POST', `/api/jw/v2/actions/customers/${customerId}/financing-requests`, {
    requestId: rid('fr'), tenantId: T1, facilityId, productType: 'sale_leaseback', amountMinor: wan(80), currency: 'CNY', equipmentRefs: ['DEV-2'],
  });
  assert.equal(fr2.status, 200, `FR2 创建失败: ${JSON.stringify(fr2.json)}`);
  const ridFr1 = rid('res');
  const ridFr2 = rid('res');
  const [res1, res2] = await Promise.all([
    call('biz1', 'POST', `/api/jw/v2/actions/financing-requests/${fr1.json.frId}/reserve`, { requestId: ridFr1, tenantId: T1 }),
    call('cred1', 'POST', `/api/jw/v2/actions/financing-requests/${fr2.json.frId}/reserve`, { requestId: ridFr2, tenantId: T1 }),
  ]);
  assert.equal(res1.status, 200, `FR1 预占失败: ${JSON.stringify(res1.json)}`);
  assert.equal(res2.status, 200, `FR2 预占失败: ${JSON.stringify(res2.json)}`);

  const ws2 = await call('biz1', 'GET', `/api/jw/v2/customers/${customerId}/workspace`);
  const fac2 = ws2.json.snapshot.facilities.find((f) => f.facilityId === facilityId);
  assert.equal(fac2.reservedMinor, wan(180), '两笔并发预占累计入同一客户额度桶');
  assert.equal(fac2.availableForNewDrawMinor, wan(320), '可用额 = 已批准 − 预占（非循环口径）');
  const fr3 = await call('biz1', 'POST', `/api/jw/v2/actions/customers/${customerId}/financing-requests`, {
    requestId: rid('fr'), tenantId: T1, facilityId, productType: 'direct_lease', amountMinor: wan(400), currency: 'CNY', equipmentRefs: ['DEV-1'],
  });
  assert.equal(fr3.status, 200);
  const res3 = await call('biz1', 'POST', `/api/jw/v2/actions/financing-requests/${fr3.json.frId}/reserve`, { requestId: rid('res'), tenantId: T1 });
  assert.equal(res3.status, 409, `超预占必须拒绝: ${JSON.stringify(res3.json)}`);
  assert.equal(res3.json.error, 'INSUFFICIENT_AVAILABLE_AMOUNT');

  // ---- [C05] 丢响应恢复：同 requestId 重放幂等 + 回执可查；无双重业务效应 ----
  const res1Replay = await call('biz1', 'POST', `/api/jw/v2/actions/financing-requests/${fr1.json.frId}/reserve`, { requestId: ridFr1, tenantId: T1 });
  assert.equal(res1Replay.json.replayed, true, '同 requestId 重试 → replayed（不重复预占）');
  const ws3 = await call('biz1', 'GET', `/api/jw/v2/customers/${customerId}/workspace`);
  assert.equal(ws3.json.snapshot.facilities.find((f) => f.facilityId === facilityId).reservedMinor, wan(180), '重试后账面不变（无双重效应）');
  const receipt = await call('biz1', 'GET', `/api/jw/v2/receipts/${ridFr1}`);
  assert.equal(receipt.status, 200);
  assert.equal(receipt.json.found, true, '回执经 Edge 可查（对账依据）');

  // ---- 不利材料 → 取代 → 新批准被 STALE_BASIS 阻断；历史决定保留 ----
  const art2 = await call('biz1', 'POST', `/api/jw/v2/actions/customers/${customerId}/artifacts`, {
    requestId: rid('art'), tenantId: T1, kind: 'litigation_record', factKey: 'litigation',
    content: { case: `LA-${rid('l')}`, amountMinor: wan(300), adverse: true }, grade: 'source_supported',
  });
  assert.equal(art2.status, 200);
  const ass2 = await call('cred1', 'POST', `/api/jw/v2/actions/customers/${customerId}/assessments`, {
    requestId: rid('as'), tenantId: T1, ruleVersion: 'rules-e1-task3', evidenceSnapshot: [{ artifactId: art2.json.artifactId }],
  });
  assert.equal(ass2.status, 200);
  await call('cred1', 'POST', `/api/jw/v2/actions/assessments/${ass2.json.assessmentId}/candidate`, {
    requestId: rid('cd'), tenantId: T1,
    candidate: { tendency: 'do_with_adjusted_terms', supportableAmountMinor: wan(200), currency: 'CNY', rationale: '不利材料后调整', producedBy: 'task3-e1-automated', conditions: [], warnings: [] },
  });
  await call('cred1', 'POST', `/api/jw/v2/actions/assessments/${ass2.json.assessmentId}/submit-review`, { requestId: rid('sr'), tenantId: T1 });
  const prop2 = await call('cred1', 'POST', `/api/jw/v2/actions/customers/${customerId}/facilities`, {
    requestId: rid('pf'), tenantId: T1, assessmentId: ass2.json.assessmentId, approvedAmountMinor: wan(200), currency: 'CNY',
  });
  assert.equal(prop2.status, 200);
  // 客户补证（更正取代不利材料）→ 依据失效传播
  const sup = await call('biz1', 'POST', `/api/jw/v2/actions/customers/${customerId}/artifacts`, {
    requestId: rid('art'), tenantId: T1, kind: 'litigation_record', factKey: 'litigation',
    content: { settled: true, reconcile: `RC-${rid('r')}` }, grade: 'source_supported', supersedes: art2.json.artifactId,
  });
  assert.equal(sup.status, 200, `更正取代失败: ${JSON.stringify(sup.json)}`);
  const ap2 = await call('app1', 'POST', `/api/jw/v2/actions/facilities/${prop2.json.facilityId}/approve`, { requestId: rid('ap'), tenantId: T1, rationale: '依据已变化仍尝试批准' });
  assert.equal(ap2.status, 409, `Gate 阻断：${JSON.stringify(ap2.json)}`);
  assert.equal(ap2.json.error, 'STALE_BASIS', '不利材料被取代后，新批准被依据复查阻断');
  const ws4 = await call('biz1', 'GET', `/api/jw/v2/customers/${customerId}/workspace`);
  const fac4 = ws4.json.snapshot.facilities.find((f) => f.facilityId === facilityId);
  assert.equal(fac4.status, 'active', '历史决定保留：设施1 仍 active');
  assert.equal(fac4.approvedAmountMinor, wan(500), '历史决定保留：批准额不变');
  assert.equal(fac4.reservedMinor, wan(180), '历史决定保留：预占不变');
  const staleItem = ws4.json.snapshot.openItems.find((o) => o.kind === 'assessment_stale');
  assert.ok(staleItem, 'openItems 如实呈现 stale 依据（不隐藏）');

  // ---- [C03] 消息受众分流 + 内部内容不外发 ----
  const msg1 = await call('cust1', 'POST', `/api/jw/v2/customers/${customerId}/messages`, { requestId: rid('m'), audience: 'customer', text: '客户补充说明（E1）' });
  assert.equal(msg1.status, 200, `客户消息失败: ${JSON.stringify(msg1.json)}`);
  const msg2 = await call('biz1', 'POST', `/api/jw/v2/customers/${customerId}/messages`, { requestId: rid('m'), audience: 'internal', text: '内部备注：诉讼已更正' });
  assert.equal(msg2.status, 200, `内部消息失败: ${JSON.stringify(msg2.json)}`);
  const msg3 = await call('biz1', 'POST', `/api/jw/v2/customers/${customerId}/messages`, { requestId: rid('m'), audience: 'customer', text: '内部意见', internalContent: true });
  assert.equal(msg3.status, 403, '内部内容外发默认 403');
  assert.equal(msg3.json.error, 'AUDIENCE_MISMATCH');

  // ---- [C07] 停库/停内核 → live 保持、ready 如实翻转、上游不可用不伪装 → 重启恢复 ----
  const preCursor = ws4.json.eventCursor;
  B.killKernel();
  const downReady = await (async () => {
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      const r = await (await fetch(`${B.base}/healthz/ready`)).json();
      if (r.ok === false && r.checks.some((c) => c.name === 'kernel-a' && c.ok === false)) return r;
      await new Promise((x) => setTimeout(x, 500));
    }
    return null;
  })();
  assert.ok(downReady, '内核停止后 readiness 必须如实翻转（kernel-a 检查失败）');
  const liveChk = await (await fetch(`${B.base}/healthz/live`)).json();
  assert.equal(liveChk.ok, true, 'Edge 进程存活 liveness 保持 ok');
  const wsDown = await call('biz1', 'GET', `/api/jw/v2/customers/${customerId}/workspace`);
  assert.equal(wsDown.status, 502, `内核不可达时如实 502: ${JSON.stringify(wsDown.json)}`);
  assert.equal(wsDown.json.error, 'UPSTREAM_UNAVAILABLE');

  await B.restartKernel();
  const upReady = await (async () => {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const r = await (await fetch(`${B.base}/healthz/ready`)).json();
      if (r.ok === true) return r;
      await new Promise((x) => setTimeout(x, 600));
    }
    return null;
  })();
  assert.ok(upReady, '内核重启后 readiness 恢复 ok');

  const ws5 = await call('biz1', 'GET', `/api/jw/v2/customers/${customerId}/workspace`);
  assert.equal(ws5.status, 200, '重启后 workspace 恢复');
  const fac5 = ws5.json.snapshot.facilities.find((f) => f.facilityId === facilityId);
  assert.equal(fac5.reservedMinor, wan(180), '重启后预占账面无丢失');
  assert.equal(ws5.json.snapshot.customer.customerId, customerId, '客户档案无丢失');
  const res1PostRestart = await call('biz1', 'POST', `/api/jw/v2/actions/financing-requests/${fr1.json.frId}/reserve`, { requestId: ridFr1, tenantId: T1 });
  assert.equal(res1PostRestart.json.replayed, true, '重启后同 requestId 仍幂等（不重复预占）');
  // 事件流续跑：重启后新动作事件可继续收到（游标单调，不重复触发旧提示由客户端按 eventId 去重保证）
  const fr1Get = await call('biz1', 'GET', `/api/jw/v2/customers/${customerId}/workspace`);
  // snapshotVersion 现为字符串化 seq（BigInt 精度）——用 BigInt 比较，避免字典序误报（增量复核 P3）
  assert.ok(
    BigInt(fr1Get.json.snapshotVersion) >= BigInt(ws4.json.snapshotVersion),
    `事件水位不回退（${ws4.json.snapshotVersion} → ${fr1Get.json.snapshotVersion}）`,
  );
  assert.ok(preCursor, '重启前游标已记录（Edge 不重启场景下游标补取语义由 E0 覆盖）');

  // ---- [C12] API 直连保底路径：本场景全程未依赖任何前端/三维 ----
  // （整个用例即保底路径证据；前端/三维不可用不影响业务操作完整性）
  writeFileSync(`${B.RUN_DIR}/scenario-result.json`, JSON.stringify({
    at: new Date().toISOString(), result: 'PASS', automated: true,
    covered: ['C02-matrix-automated', 'C03-role-scope', 'C04-sse-live-event', 'C05-idempotent-retry', 'C07-restart-recovery', 'C12-api-direct'],
    customer: { customerId, facilityId, fr1: fr1.json.frId, fr2: fr2.json.frId },
    migrationNotes: B.migrationNotes,
  }, null, 2));
});
