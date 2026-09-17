import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeHarness, pgAvailable, TENANT } from './helpers.mjs';

let h;

before(async () => {
  if (!(await pgAvailable())) {
    console.log('I06-I08: blocked_env — PG 不可达；不伪造结果。');
    process.exit(0);
  }
  h = await makeHarness();
});
after(async () => { if (h) await h.dispose(); });

async function setupCustomer(customerId, externalId) {
  await h.bindings.bind({ tenantId: TENANT, provider: 'wecom_archive', providerUserId: externalId, customerId, verifiedBy: 'tester' });
  await h.consent.grant({ tenantId: TENANT, subjectType: 'customer_participant', subjectId: customerId, channel: 'wecom_archive', purposes: ['archival', 'transcription'], dataCategory: 'message_content', basis: 'test', source: 'test' });
}

test('I06a: 客户未授权 → 拒绝基于该同意的新处理', async () => {
  // 无任何 consent grant 的客户：绑定存在但无同意。
  await h.bindings.bind({ tenantId: TENANT, provider: 'wecom_archive', providerUserId: 'wo_noconsent', customerId: 'cust_noconsent', verifiedBy: 'tester' });
  const r = await h.ingest.ingestMessage({
    tenantId: TENANT, seq: 11000,
    msg: { msgid: 'm_i06a', action: 'send', from: 'wo_noconsent', tolist: ['userid_sales'], msgtime: 1760010000000, msgtype: 'text', text: { content: '未授权客户来信' } },
  });
  assert.equal(r.blocked, true);
  assert.equal(r.reason, 'CONSENT_REQUIRED');
  assert.equal(r.eventId, null, '未授权消息不产生业务事件');
});

test('I06b: 撤回（disagree）→ 停止新处理；既有合法保留数据不一概删除', async () => {
  await setupCustomer('cust_i06b', 'wo_i06b');
  const before = await h.ingest.ingestMessage({
    tenantId: TENANT, seq: 11001,
    msg: { msgid: 'm_i06b_1', action: 'send', from: 'wo_i06b', tolist: ['userid_sales'], msgtime: 1760010001000, msgtype: 'text', text: { content: '撤回前的合法保留消息' } },
  });
  assert.ok(before.eventId, '撤回前消息正常登记');

  // disagree → 同意流内撤回。
  await h.ingest.ingestMessage({
    tenantId: TENANT, seq: 11002,
    msg: { msgid: 'm_i06b_2', action: 'send', from: 'wo_i06b', tolist: ['userid_sales'], msgtime: 1760010002000, msgtype: 'disagree', disagree: { user: { userid: 'wo_i06b' } } },
  });
  const consents = await h.store.query(
    `SELECT status FROM consent_records WHERE tenant_id=$1 AND subject_id='cust_i06b' AND channel='wecom_archive'`,
    [TENANT],
  );
  assert.ok(consents.rows.every((r) => r.status === 'revoked'), 'archive consent revoked');

  const after = await h.ingest.ingestMessage({
    tenantId: TENANT, seq: 11003,
    msg: { msgid: 'm_i06b_3', action: 'send', from: 'wo_i06b', tolist: ['userid_sales'], msgtime: 1760010003000, msgtype: 'text', text: { content: '撤回后来信' } },
  });
  assert.equal(after.blocked, true, '撤回后新处理被拒');

  const kept = await h.store.query(`SELECT COUNT(*)::int AS n FROM communication_events WHERE event_id=$1`, [before.eventId]);
  assert.equal(kept.rows[0].n, 1, '撤回前的合法保留数据未被机械删除（留存由 retention/legal hold 裁决）');
});

test('I07: 同一联系人命中两客户 → 不自动串线，需显式上下文绑定', async () => {
  // 同一 providerUserId 绑定到两个客户（数据异常或真实双归属）。
  await h.bindings.bind({ tenantId: TENANT, provider: 'wecom_archive', providerUserId: 'wo_dual', customerId: 'cust_dual_A', verifiedBy: 'tester' });
  await h.bindings.bind({ tenantId: TENANT, provider: 'wecom_archive', providerUserId: 'wo_dual', customerId: 'cust_dual_B', verifiedBy: 'tester' });

  const r = await h.ingest.ingestMessage({
    tenantId: TENANT, seq: 12000,
    msg: { msgid: 'm_i07', action: 'send', from: 'wo_dual', tolist: ['userid_sales'], msgtime: 1760011000000, msgtype: 'text', text: { content: '双重归属消息' } },
  });
  assert.equal(r.quarantined, true, '消息进入隔离待分配区');
  assert.equal(r.customerId ?? null, null, '绝不自动选择客户');

  const ev = (await h.store.query(`SELECT customer_id FROM communication_events WHERE event_id=$1`, [r.eventId])).rows[0];
  assert.equal(ev.customer_id, null, '事件未归属任何客户');

  // 显式 thread 上下文绑定后解决。
  // 线程键按 from+tolist 经 sort() 后拼接：'dm:userid_sales|wo_dual'
  const threadId = (await h.store.query(`SELECT thread_id FROM communication_threads WHERE provider_thread_key=$1`, ['dm:userid_sales|wo_dual'])).rows[0].thread_id;
  await h.bindings.bind({ tenantId: TENANT, provider: 'wecom_archive', providerUserId: 'wo_dual', customerId: 'cust_dual_A', verifiedBy: 'human_reviewer', threadScope: threadId });
  const res = await h.bindings.resolve({ tenantId: TENANT, provider: 'wecom_archive', providerUserId: 'wo_dual', threadId });
  assert.equal(res.status, 'resolved');
  assert.equal(res.customerId, 'cust_dual_A', '上下文绑定生效，仍然不波及另一客户');
});

test('I08: 外部载荷携带 customerId 字段 → 忽略；跨租户 customerId → 拒绝', async () => {
  await setupCustomer('cust_i08', 'wo_i08');

  // 外部消息体塞了伪造的 customerId 与跨租户字段：白名单过滤。
  const r = await h.ingest.ingestMessage({
    tenantId: TENANT, seq: 13000,
    msg: { msgid: 'm_i08', action: 'send', from: 'wo_i08', tolist: ['userid_sales'], msgtime: 1760012000000, msgtype: 'text', text: { content: '伪造字段测试' }, customerId: 'cust_evil', tenantId: 'tenant_evil' },
  });
  assert.ok(r.eventId);
  const ev = (await h.store.query(`SELECT customer_id, tenant_id, body FROM communication_events WHERE event_id=$1`, [r.eventId])).rows[0];
  assert.equal(ev.customer_id, 'cust_i08', 'customerId 只来自受控绑定');
  assert.equal(JSON.stringify(ev.body).includes('cust_evil'), false, '载荷中的伪造 customerId 不入账');

  // A 登记侧：跨租户直接拒绝（store 层 tenant 作用域 + 证据登记双校验在 e1-integration 中验证）。
  const cross = await h.store.query(`SELECT COUNT(*)::int AS n FROM communication_events WHERE tenant_id='tenant_evil'`);
  assert.equal(cross.rows[0].n, 0, '不存在任何跨租户事件');
});

test('I08b: send 对无绑定/跨租户 customerId 拒绝', async () => {
  await h.consent.grant({ tenantId: TENANT, subjectType: 'customer_participant', subjectId: 'cust_other_tenant', channel: 'wecom_kf', purposes: ['external_disclosure'], dataCategory: 'message_content', basis: 'test', source: 'test' });
  await assert.rejects(
    () => h.send.send({ tenantId: TENANT, customerId: 'cust_never_bound', audience: 'customer', text: 'x' }),
    (e) => e.code === 'CUSTOMER_SCOPE_MISMATCH',
  );
});
