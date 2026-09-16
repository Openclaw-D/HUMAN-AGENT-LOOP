import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeHarness, pgAvailable, TENANT } from './helpers.mjs';
import { verifyCallback, callbackSignature, aesKeyFromEncodingAESKey, encryptCallbackMessage } from '../src/wecom/crypto.mjs';
import { ConnError } from '../src/errors.mjs';

let h;

before(async () => {
  if (!(await pgAvailable())) {
    console.log('I01-I05: blocked_env — PG 127.0.0.1:15443 不可达；不伪造结果。');
    process.exit(0);
  }
  h = await makeHarness();
});

after(async () => { if (h) await h.dispose(); });

const AES_KEY = aesKeyFromEncodingAESKey('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ');
const TOKEN = 'test_callback_token';
const CORPID = 'corpid_demo';

function enc(plaintext, receiveId = CORPID) {
  return encryptCallbackMessage({ aesKey: AES_KEY, plaintext, receiveId });
}

test('I01a: 回调签名错误 → 拒绝，不进入客户事实', async () => {
  const encrypt = enc(JSON.stringify({ msgid: 'm_i01a', msgtype: 'text', text: { content: 'x' } }));
  const ts = String(Math.floor(Date.now() / 1000));
  assert.throws(
    () => verifyCallback({ token: TOKEN, aesKey: AES_KEY, receiveId: CORPID, signature: 'deadbeef', timestamp: ts, nonce: 'n1', encrypt, nowMs: Date.now() }),
    (e) => e instanceof ConnError && e.code === 'CALLBACK_BAD_SIGNATURE',
  );
  const events = await h.store.query(`SELECT COUNT(*)::int AS n FROM communication_events WHERE tenant_id=$1`, [TENANT]);
  assert.equal(events.rows[0].n, 0, '没有任何客户事实产生');
});

test('I01b: 回调时间戳超窗（过期）→ 拒绝', () => {
  const encrypt = enc(JSON.stringify({ msgid: 'm_i01b', msgtype: 'text' }));
  const oldTs = String(Math.floor(Date.now() / 1000) - 3600);
  assert.throws(
    () => verifyCallback({ token: TOKEN, aesKey: AES_KEY, receiveId: CORPID, signature: callbackSignature(TOKEN, oldTs, 'n', encrypt), timestamp: oldTs, nonce: 'n', encrypt, nowMs: Date.now(), maxAgeSec: 300 }),
    (e) => e.code === 'CALLBACK_EXPIRED',
  );
});

test('I01c: receiveid 不匹配（跨企业投递）→ 拒绝', () => {
  const encrypt = enc(JSON.stringify({ msgid: 'm_i01c' }), 'corpid_OTHER');
  const ts = String(Math.floor(Date.now() / 1000));
  assert.throws(
    () => verifyCallback({ token: TOKEN, aesKey: AES_KEY, receiveId: CORPID, signature: callbackSignature(TOKEN, ts, 'n', encrypt), timestamp: ts, nonce: 'n', encrypt, nowMs: Date.now() }),
    (e) => e.code === 'CALLBACK_RECEIVEID_MISMATCH',
  );
});

test('I02: 同一事件重放 100 次 → 只形成一次业务登记，重放全部可审计', async () => {
  const msg = { msgid: 'm_i02', action: 'send', from: 'wo_cust_dup', tolist: ['userid_sales'], msgtime: 1760001000000, msgtype: 'text', text: { content: '重复投递测试' } };
  await h.bindings.bind({ tenantId: TENANT, provider: 'wecom_archive', providerUserId: 'wo_cust_dup', customerId: 'cust_i02', verifiedBy: 'tester' });
  await h.consent.grant({ tenantId: TENANT, subjectType: 'customer_participant', subjectId: 'cust_i02', channel: 'wecom_archive', purposes: ['archival'], dataCategory: 'message_content', basis: 'test', source: 'test' });

  let first;
  for (let i = 0; i < 100; i++) {
    const r = await h.ingest.ingestMessage({ tenantId: TENANT, seq: 5000, msg });
    if (i === 0) first = r;
    else { assert.equal(r.replayed, true, `replay #${i} must be marked replayed`); }
  }
  assert.equal(first.replayed, undefined);
  assert.ok(first.eventId, 'first ingest registers once');

  const evs = await h.store.query(
    `SELECT COUNT(*)::int AS n FROM communication_events WHERE tenant_id=$1 AND provider_event_id=$2`,
    [TENANT, '5000:m_i02:send'],
  );
  assert.equal(evs.rows[0].n, 1, 'exactly one business registration');

  const replays = await h.store.query(
    `SELECT COUNT(*)::int AS n FROM audit_log WHERE tenant_id=$1 AND action='INBOX_REPLAY' AND target_id='5000:m_i02:send'`,
    [TENANT],
  );
  assert.equal(replays.rows[0].n, 99, 'all replays auditable');
});

test('I03: 收到后崩溃（inbox=persisted, 未 processed）→ 恢复补拉不漏登记、不重复产生效果', async () => {
  await h.bindings.bind({ tenantId: TENANT, provider: 'wecom_archive', providerUserId: 'wo_cust_crash', customerId: 'cust_i03', verifiedBy: 'tester' });
  await h.consent.grant({ tenantId: TENANT, subjectType: 'customer_participant', subjectId: 'cust_i03', channel: 'wecom_archive', purposes: ['archival'], dataCategory: 'message_content', basis: 'test', source: 'test' });

  // 模拟崩溃：直接以底层方式插入 inbox（等价于"已收到未处理"状态）。
  const msg = { msgid: 'm_i03', action: 'send', from: 'wo_cust_crash', tolist: ['userid_sales'], msgtime: 1760002000000, msgtype: 'text', text: { content: '崩溃恢复' } };
  await h.store.query(
    `INSERT INTO inbox_events (tenant_id, provider, provider_event_id, seq, payload) VALUES ($1,'wecom_archive',$2,$3,$4)`,
    [TENANT, '6000:m_i03:send', 6000, JSON.stringify(msg)],
  );

  const recovered = await h.ingest.recoverPending({ tenantId: TENANT });
  assert.equal(recovered.length, 1, 'recovery processed the pending inbox row');
  assert.ok(recovered[0].eventId);

  // 再次恢复：不重复产生效果。
  const again = await h.ingest.recoverPending({ tenantId: TENANT });
  assert.equal(again.length, 0, 'second recovery finds nothing pending');

  const evs = await h.store.query(
    `SELECT COUNT(*)::int AS n FROM communication_events WHERE tenant_id=$1 AND provider_event_id='6000:m_i03:send'`,
    [TENANT],
  );
  assert.equal(evs.rows[0].n, 1);
});

test('I04: 正文已登记、附件下载失败 → attachment 状态如实、不自动核验通过', async () => {
  await h.bindings.bind({ tenantId: TENANT, provider: 'wecom_archive', providerUserId: 'wo_cust_att', customerId: 'cust_i04', verifiedBy: 'tester' });
  await h.consent.grant({ tenantId: TENANT, subjectType: 'customer_participant', subjectId: 'cust_i04', channel: 'wecom_archive', purposes: ['archival'], dataCategory: 'message_content', basis: 'test', source: 'test' });

  const r = await h.ingest.ingestMessage({
    tenantId: TENANT, seq: 7000,
    msg: { msgid: 'm_i04', action: 'send', from: 'wo_cust_att', tolist: ['userid_sales'], msgtime: 1760003000000, msgtype: 'image', image: { sdkfileid: 'sdk_fail_1', filesize: 10 } },
  });
  assert.ok(r.eventId);
  let ev = (await h.store.query(`SELECT completeness FROM communication_events WHERE event_id=$1`, [r.eventId])).rows[0];
  assert.equal(ev.completeness, 'attachment_pending');

  await h.transport.failMedia('sdk_fail_1', 'error');
  let results;
  for (let i = 0; i < 3; i++) {
    results = await h.ingest.runAttachmentWorker({ tenantId: TENANT, transport: h.transport, maxRetries: 3 });
  }
  assert.equal(results[0].status, 'failed', '重试耗尽后如实失败');

  ev = (await h.store.query(`SELECT completeness FROM communication_events WHERE event_id=$1`, [r.eventId])).rows[0];
  assert.equal(ev.completeness, 'attachment_pending', 'event remains incomplete after failure');

  const job = (await h.store.query(`SELECT status, retries, last_error FROM attachment_jobs WHERE event_id=$1`, [r.eventId])).rows[0];
  assert.equal(job.status, 'failed');
  assert.equal(job.retries, 3);
  assert.ok(job.last_error);
});

test('I04b: 附件重试成功 → completeness=complete，对象可读', async () => {
  const r = await h.ingest.ingestMessage({
    tenantId: TENANT, seq: 7001,
    msg: { msgid: 'm_i04b', action: 'send', from: 'wo_cust_att', tolist: ['userid_sales'], msgtime: 1760003001000, msgtype: 'image', image: { sdkfileid: 'sdk_ok_1', filesize: 4 } },
  });
  h.transport.setMedia('sdk_ok_1', Buffer.from('DEMO'));
  const results = await h.ingest.runAttachmentWorker({ tenantId: TENANT, transport: h.transport });
  assert.equal(results[0].status, 'done');
  const ev = (await h.store.query(`SELECT completeness FROM communication_events WHERE event_id=$1`, [r.eventId])).rows[0];
  assert.equal(ev.completeness, 'complete');
  const obj = (await h.store.query(`SELECT sha256, size_bytes FROM objects WHERE object_ref LIKE 'media/%' ORDER BY created_at DESC LIMIT 1`)).rows[0];
  assert.equal(obj.size_bytes, 4);
});

test('I05: 超出官方可补拉窗口（>5天）→ 确认 archive_gap + 补救流程，不静默丢失', async () => {
  const out = await h.ingest.confirmArchiveGap({ tenantId: TENANT, provider: 'wecom_archive', channel: 'archive', fromSeq: 8000, toSeq: 9000, reason: '拉取中断超过官方5天窗口（U1）' });
  assert.equal(out.status, 'archive_gap');
  assert.equal(out.remediation, 'manual_backfill_or_business_compensation');
  const cp = await h.ingest.getCheckpoint({ tenantId: TENANT, provider: 'wecom_archive', channel: 'archive' });
  assert.equal(cp.confirmed_gaps, 1);
  const auditRow = (await h.store.query(`SELECT summary FROM audit_log WHERE tenant_id=$1 AND action='ARCHIVE_GAP_CONFIRMED'`, [TENANT])).rows[0];
  assert.match(auditRow.summary, /manual backfill|business compensation/i);
});

test('I05b: seq 非连续 → 记录疑似缺口（suspected_gap），不必然当丢失', async () => {
  await h.ingest.advanceCheckpoint({ tenantId: TENANT, provider: 'wecom_archive', channel: 'archive', throughSeq: 100 });
  const r1 = await h.ingest.advanceCheckpoint({ tenantId: TENANT, provider: 'wecom_archive', channel: 'archive', throughSeq: 105 });
  assert.equal(r1.suspectedGap, true, 'jump recorded');
  const cp = await h.ingest.getCheckpoint({ tenantId: TENANT, provider: 'wecom_archive', channel: 'archive' });
  assert.equal(cp.suspected_gaps, 1);
  assert.equal(cp.confirmed_gaps, 1); // 来自 I05，不受影响
  const a = (await h.store.query(`SELECT summary FROM audit_log WHERE tenant_id=$1 AND action='CHECKPOINT_SEQ_JUMP'`, [TENANT])).rows[0];
  assert.match(a.summary, /not confirmed loss/);
});
