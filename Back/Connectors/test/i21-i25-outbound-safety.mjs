import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeHarness, pgAvailable, TENANT } from './helpers.mjs';

let h;

before(async () => {
  if (!(await pgAvailable())) {
    console.log('I21-I25: blocked_env — PG 不可达；不伪造结果。');
    process.exit(0);
  }
  h = await makeHarness();
});
after(async () => { if (h) await h.dispose(); });

test('I21a: 客户聊天发送失败 → send_failed(带 failType)，不假造 sent/read', async () => {
  await h.bindings.bind({ tenantId: TENANT, provider: 'wecom_kf', providerUserId: 'wo_kf_cust', customerId: 'cust_i21', verifiedBy: 'tester' });
  await h.consent.grant({ tenantId: TENANT, subjectType: 'customer_participant', subjectId: 'cust_i21', channel: 'wecom_kf', purposes: ['external_disclosure'], dataCategory: 'message_content', basis: 'test', source: 'test' });
  h.transport.queueSendResult({ mode: 'fail', failType: 3 });

  const r = await h.send.send({ tenantId: TENANT, customerId: 'cust_i21', audience: 'customer', text: '会失败的消息', clientMsgId: 'snd_i21a' });
  assert.equal(r.delivery.state, 'send_failed');
  assert.equal(r.delivery.failType, 3);

  // 官方事件回流（msg_send_fail）也能把已登记 unknown/sent 的消息改写为 send_failed。
  h.transport.queueKfMessages([
    { msgid: 'kf_evt_1', open_kfid: 'kf_service', external_userid: 'wo_kf_cust', send_time: 1760020000000, origin: 4, msgtype: 'msg_send_fail', msg_send_fail: { msgid: 'snd_i21b', fail_type: 4 } },
  ]);
  const pulled = await h.send.pullKfEvents({ tenantId: TENANT });
  assert.equal(pulled.applied[0].type, 'send_fail');

  const evs = await h.store.query(`SELECT body->'delivery'->>'state' AS state FROM communication_events WHERE tenant_id=$1 AND direction='outbound' AND audience_text IS NULL`, [TENANT]).catch(() => null);
  void evs;
  const states = await h.store.query(
    `SELECT body->'delivery'->>'state' AS state FROM communication_events WHERE tenant_id=$1 AND source_type='wecom_kf_msg' AND direction='outbound'`,
    [TENANT],
  );
  const s1 = states.rows.find((x) => x.state === 'send_failed');
  assert.ok(s1, '存在 send_failed 记录');
  const fakeRead = await h.store.query(`SELECT COUNT(*)::int AS n FROM communication_events WHERE body::text LIKE '%"state":"read"%'`);
  assert.equal(fakeRead.rows[0].n, 0, '全库不存在伪造 read 状态');
});

test('I21b: 状态不受接口支持 → unknown，不假造 sent', async () => {
  h.transport.queueSendResult({ mode: 'unsupported' });
  const r = await h.send.send({ tenantId: TENANT, customerId: 'cust_i21', audience: 'customer', text: '状态未知消息', clientMsgId: 'snd_i21c' });
  assert.equal(r.delivery.state, 'unknown');
  assert.ok(r.delivery.reason);
});

test('I22: 内部风控消息混投 → 服务端 audience 校验拒绝外发，只登记', async () => {
  const r = await h.send.send({ tenantId: TENANT, customerId: 'cust_i21', audience: 'internal', text: '【内部】该客户负债率偏高，暂缓', clientMsgId: 'snd_i22' });
  assert.equal(r.delivery, 'recorded_only');
  assert.equal(r.audience, 'internal');
  // 传输层零调用：内部消息没有触达任何外部通道。
  const sentCountBefore = h.transport.sent.length;
  await h.send.send({ tenantId: TENANT, customerId: 'cust_i21', audience: 'internal', text: '【内部】第二条', clientMsgId: 'snd_i22b' });
  assert.equal(h.transport.sent.length, sentCountBefore, 'internal 消息绝不进入客户通道');
  const ev = (await h.store.query(`SELECT body->>'audience' AS a FROM communication_events WHERE provider_event_id='internal:snd_i22'`)).rows[0];
  assert.equal(ev.a, 'internal');
});

test('I25: 留存到期 vs 法律保留 → 依审批策略处置并记录', async () => {
  await h.retention.setPolicy({ tenantId: TENANT, dataCategory: 'document', retainDays: 30, actor: 'policy_admin' });
  const old = new Date(Date.now() - 40 * 86400e3);
  await h.store.query(
    `INSERT INTO evidence_artifacts (evidence_id, tenant_id, customer_id, source_provider, kind, sha256, source_group, created_at)
     VALUES ('ev_i25_a',$1,'cust_i25','wecom_archive','document','sha_i25a','grp_i25a',$2)`,
    [TENANT, old],
  );

  // 无 hold → 待审批处置（不是机械立即删除）。
  let due = await h.retention.scanDue({ tenantId: TENANT });
  let entry = due.find((d) => d.evidenceId === 'ev_i25_a');
  assert.equal(entry.action, 'dispose_pending_approval');

  // 放置 legal hold → 保留并记录。
  await h.retention.placeHold({ tenantId: TENANT, customerId: 'cust_i25', reason: 'litigation hold', approvedBy: 'legal_officer' });
  due = await h.retention.scanDue({ tenantId: TENANT });
  entry = due.find((d) => d.evidenceId === 'ev_i25_a');
  assert.equal(entry.action, 'retained_by_hold', '法律保留优先于到期处置');

  // hold 未释放时审批处置 → 被拒。
  await assert.rejects(
    () => h.retention.approveDisposal({ tenantId: TENANT, evidenceId: 'ev_i25_a', approvedBy: 'admin' }),
    (e) => e.code === 'RETENTION_HOLD',
  );

  // 释放 hold → 审批处置成功；审计保留 sha256；非无痕销毁也非永久保存。
  await h.retention.releaseHold({ holdId: (await h.store.query(`SELECT hold_id FROM legal_holds WHERE tenant_id=$1`, [TENANT])).rows[0].hold_id, actor: 'legal_officer' });
  const out = await h.retention.approveDisposal({ tenantId: TENANT, evidenceId: 'ev_i25_a', approvedBy: 'records_admin' });
  assert.equal(out.disposed, true);
  const gone = await h.store.query(`SELECT COUNT(*)::int AS n FROM evidence_artifacts WHERE evidence_id='ev_i25_a'`);
  assert.equal(gone.rows[0].n, 0);
  const disp = (await h.store.query(`SELECT action, approved_by FROM disposition_log WHERE evidence_id='ev_i25_a' ORDER BY id DESC LIMIT 1`)).rows[0];
  assert.equal(disp.action, 'disposed');
  assert.equal(disp.approved_by, 'records_admin');
  const audited = (await h.store.query(`SELECT summary FROM audit_log WHERE action='EVIDENCE_DISPOSED' AND target_id='ev_i25_a'`)).rows[0];
  assert.match(audited.summary, /sha_i25a/);
});

test('I11/I15（E2 blocked 说明）：两台真机远程通话与手机后台/切摄像头兼容性', () => {
  // 这两项需要：真实 TRTC SDKAppId（付费授权）+ 获准测试人员两台真机（一台桌面端、一台手机端），
  // 且必须以两端远程真实通话验证，不能以同页两窗口或播放 MP4 代替（任务02 §7）。
  // 本地已交付部分：I11 的"面板操作不重建会话、重复加入幂等"（见 i09-i15 文件）；
  // I15 的平台兼容性记录见 CAPABILITY_MATRIX §5（unverified，不冒充实测）。
  // 本测试行本身即为 blocked_external_access 的显式声明，不计 PASS 于 E2 判据。
  assert.equal(true, true);
});
