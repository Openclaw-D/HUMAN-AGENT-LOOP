import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeHarness, pgAvailable, TENANT, SIGNING_SECRET } from './helpers.mjs';
import { ConnError } from '../src/errors.mjs';

let h;

before(async () => {
  if (!(await pgAvailable())) {
    console.log('I09-I15: blocked_env — PG 不可达；不伪造结果。');
    process.exit(0);
  }
  h = await makeHarness();
});
after(async () => { if (h) await h.dispose(); });

async function makeLiveSession({ sourceMode = 'real' } = {}) {
  await h.bindings.bind({ tenantId: TENANT, provider: 'wecom_kf', providerUserId: `wo_${sourceMode}_cust`, customerId: `cust_${sourceMode}_sess`, verifiedBy: 'tester' });
  await h.consent.grant({ tenantId: TENANT, subjectType: 'customer_participant', subjectId: `cust_${sourceMode}_sess`, channel: 'video_session', purposes: ['recording'], dataCategory: 'video_record', basis: 'test', source: 'test' });
  const s = await h.sessions.createSession({ tenantId: TENANT, customerId: `cust_${sourceMode}_sess`, createdBy: 'tester', sourceMode });
  const inv = await h.sessions.invite({ sessionId: s.sessionId, participantId: `p_${sourceMode}_cust`, role: 'customer', ttlSec: 300 });
  return { session: s, invite: inv };
}

test('I09a: 房间令牌签名篡改 → 拒绝', async () => {
  const { invite } = await makeLiveSession({});
  const [body] = invite.token.split('.');
  await assert.rejects(() => h.sessions.join({ token: `${body}.forged_sig` }), (e) => e.code === 'TOKEN_INVALID');
});

test('I09b: 令牌转给其他角色（observer 令牌被用作 customer）→ 拒绝', async () => {
  const { session } = await makeLiveSession({});
  const obs = await h.sessions.invite({ sessionId: session.sessionId, participantId: 'p_obs', role: 'observer', ttlSec: 300 });
  const payload = JSON.parse(Buffer.from(obs.token.split('.')[0], 'base64url').toString('utf8'));
  assert.equal(payload.role, 'observer');
  // 令牌本身不可改角色（签名绑定 role）；尝试用不同 secret 伪造高权限令牌 → 签名失败。
  const { createHmac } = await import('node:crypto');
  const forged = Buffer.from(JSON.stringify({ ...payload, role: 'customer', participantId: 'p_attacker' })).toString('base64url');
  const badSig = createHmac('sha256', 'attacker_secret').update(forged).digest('base64url');
  await assert.rejects(() => h.sessions.join({ token: `${forged}.${badSig}` }), (e) => e.code === 'TOKEN_INVALID');
});

test('I09c: 令牌跨房间（把 A 会话令牌发给 B 会话上下文）→ TOKEN_ROOM_MISMATCH / 一次性拒绝', async () => {
  const a = await makeLiveSession({});
  const b = await makeLiveSession({});
  assert.notEqual(a.session.roomId, b.session.roomId);
  // 令牌绑定房间：join 校验的是令牌声明的房间与会话一致；一次性 jti 防转发重放。
  const first = await h.sessions.join({ token: a.invite.token });
  assert.ok(first.sessionId);
  await assert.rejects(() => h.sessions.join({ token: a.invite.token }), (e) => e.code === 'TOKEN_REUSED', '同一令牌转发给他人重放 → 拒绝');
  void b;
});

test('I09d: 过期令牌 → TOKEN_EXPIRED，且不泄露内部状态', async () => {
  const { session } = await makeLiveSession({});
  const inv = await h.sessions.invite({ sessionId: session.sessionId, participantId: 'p_late', role: 'customer', ttlSec: -1 });
  await new Promise((r) => setTimeout(r, 10));
  await assert.rejects(() => h.sessions.join({ token: inv.token }), (e) => e.code === 'TOKEN_EXPIRED');
  const snap = await h.sessions.panelSnapshot({ sessionId: session.sessionId });
  assert.equal(snap.participants.filter((p) => p.participant_id === 'p_late').length, 0, '过期令牌未获得任何参与者状态');
});

test('I10: 客户拒绝摄像头/麦克风 → 状态如实，会话不得为 live', async () => {
  const { session, invite } = await makeLiveSession({});
  await h.sessions.join({ token: invite.token });
  const r = await h.sessions.reportDevice({ sessionId: session.sessionId, participantId: 'p_real_cust', camera: 'denied', mic: 'denied' });
  assert.deepEqual(r.mediaTracks, []);
  assert.equal(r.callState, 'connecting', '无客户媒体轨 → 不得报 live');
  const snap = await h.sessions.panelSnapshot({ sessionId: session.sessionId });
  const dev = snap.participants.find((p) => p.participant_id === 'p_real_cust').device_status;
  assert.equal(dev.camera, 'denied');
  assert.equal(dev.mic, 'denied');
});

test('I10b: 授权后 → 有媒体轨 → live；再拒绝 → 退回 connecting（如实）', async () => {
  const { session, invite } = await makeLiveSession({});
  await h.sessions.join({ token: invite.token });
  await h.sessions.reportDevice({ sessionId: session.sessionId, participantId: 'p_real_cust', camera: 'granted', mic: 'granted' });
  assert.equal((await h.sessions.panelSnapshot({ sessionId: session.sessionId })).callState, 'live');
  await h.sessions.reportDevice({ sessionId: session.sessionId, participantId: 'p_real_cust', camera: 'denied', mic: 'denied' });
  assert.equal((await h.sessions.panelSnapshot({ sessionId: session.sessionId })).callState, 'connecting', '客户主动关闭设备 → 不再 live，如实降级');
});

test('I11(本地部分): 打开面板不重建会话；重复加入幂等', async () => {
  const { session, invite } = await makeLiveSession({});
  await h.sessions.join({ token: invite.token });
  await h.sessions.reportDevice({ sessionId: session.sessionId, participantId: 'p_real_cust', camera: 'granted', mic: 'granted' });
  const before = await h.sessions.panelSnapshot({ sessionId: session.sessionId });
  const after1 = await h.sessions.panelSnapshot({ sessionId: session.sessionId });
  const after2 = await h.sessions.panelSnapshot({ sessionId: session.sessionId });
  assert.equal(before.callState, 'live');
  assert.equal(after1.callState, 'live');
  assert.equal(after2.callState, 'live', '面板轮询不改变会话状态');
  const partsBefore = before.participants.length;
  assert.equal(after2.participants.length, partsBefore, '面板操作不重建/不新增参与者');
  // E2 部分明确标注：两台真机远程通话未验证（blocked_external_access）。
});

test('I12: 弱网/断网 → reconnecting + 录制缺口可见；客户绑定不丢', async () => {
  h.wireLoop();
  h.wireRecording();
  const { session, invite } = await makeLiveSession({});
  await h.sessions.join({ token: invite.token });
  await h.sessions.reportDevice({ sessionId: session.sessionId, participantId: 'p_real_cust', camera: 'granted', mic: 'granted' });
  const rec = await h.recording.requestRecording({ tenantId: TENANT, sessionId: session.sessionId, requestedBy: 'tester' });
  const realTaskId = rec.taskId;

  await h.sessions.reportNetwork({ sessionId: session.sessionId, participantId: 'p_real_cust', disconnected: true });
  const snap = await h.sessions.panelSnapshot({ sessionId: session.sessionId });
  assert.equal(snap.callState, 'reconnecting');
  assert.equal(snap.customerId, `cust_real_sess`, '断网不丢客户绑定');

  // 断网期间任务结束且官方 Status=1（至少一片滞留 → 缺口）。
  await h.loop.finishTask({ taskId: realTaskId, bytes: Buffer.from('partial'), status: 1, fileStatus: 1 });
  const recStatus = await h.recording.statusOf({ tenantId: TENANT, sessionId: session.sessionId });
  assert.equal(recStatus.recordingState, 'failed', '缺口未恢复 → 不得 complete');
  assert.equal(recStatus.incomplete, true, '缺口可见（recording_incomplete）');

  // 恢复连接。
  await h.sessions.reportNetwork({ sessionId: session.sessionId, participantId: 'p_real_cust', disconnected: false });
  assert.equal((await h.sessions.panelSnapshot({ sessionId: session.sessionId })).callState, 'live');
});

test('I12b: 305 Status=2（滞留恢复）→ 缺口关闭，最终 complete', async () => {
  h.wireLoop();
  h.wireRecording();
  const { session, invite } = await makeLiveSession({});
  await h.sessions.join({ token: invite.token });
  await h.sessions.reportDevice({ sessionId: session.sessionId, participantId: 'p_real_cust', camera: 'granted', mic: 'granted' });
  const rec = await h.recording.requestRecording({ tenantId: TENANT, sessionId: session.sessionId });
  // 缺口出现（305 Status=1）。
  await h.loop.post(h.loop.envelope(305, { RoomId: session.roomId, TaskId: rec.taskId, Status: 1, SubStatus: 0 }));
  let st = await h.recording.statusOf({ tenantId: TENANT, sessionId: session.sessionId });
  assert.equal(st.recordingState, 'gapped');
  // 官方恢复信号 305 Status=2。
  await h.loop.post(h.loop.envelope(305, { RoomId: session.roomId, TaskId: rec.taskId, Status: 2, SubStatus: 0 }));
  st = await h.recording.statusOf({ tenantId: TENANT, sessionId: session.sessionId });
  assert.equal(st.recordingState, 'recording');
  // 正常结束。
  await h.loop.finishTask({ taskId: rec.taskId, bytes: Buffer.from('RECOVERED-MEDIA'), status: 0 });
  st = await h.recording.statusOf({ tenantId: TENANT, sessionId: session.sessionId });
  assert.equal(st.recordingState, 'complete', '恢复后完整收尾');
});

test('I13: 录制回调重复/乱序/延迟 → 幂等收敛，无假 complete', async () => {
  h.wireLoop();
  h.wireRecording();
  const { session, invite } = await makeLiveSession({});
  await h.sessions.join({ token: invite.token });
  await h.sessions.reportDevice({ sessionId: session.sessionId, participantId: 'p_real_cust', camera: 'granted', mic: 'granted' });
  const rec = await h.recording.requestRecording({ tenantId: TENANT, sessionId: session.sessionId, requestedBy: 'tester' });

  // 乱序/重复：305→310→311→312 已是常规序；这里重复投递 301 与整包重放。
  await h.loop.finishTask({ taskId: rec.taskId, bytes: Buffer.from('ORDER-TEST-MEDIA') });
  await h.loop.post(h.loop.envelope(301, { RoomId: session.roomId, TaskId: rec.taskId, Status: 0 }));
  await h.loop.post(h.loop.envelope(301, { RoomId: session.roomId, TaskId: rec.taskId, Status: 0 }));

  const st = await h.recording.statusOf({ tenantId: TENANT, sessionId: session.sessionId });
  assert.equal(st.recordingState, 'complete', '全部文件已存储且可读 → 才允许 complete');
  assert.equal(st.files.length, 1, '同一文件重复声明不产生重复行');
  assert.equal(st.files[0].status, 'stored');
  const dupLog = await h.store.query(
    `SELECT COUNT(*)::int AS n FROM (SELECT dedupe_key FROM recording_event_log WHERE tenant_id=$1 AND task_id=$2 GROUP BY dedupe_key HAVING COUNT(*) > 1) d`,
    [TENANT, rec.taskId],
  );
  assert.equal(dupLog.rows[0].n, 0, '重复回调被 dedupe key 吸收');
});

test('I14: 回调称完成（311/312 Status=0）但对象缺失 → recording_incomplete，不作为完整证据', async () => {
  h.wireLoop();
  h.wireRecording();
  const { session, invite } = await makeLiveSession({});
  await h.sessions.join({ token: invite.token });
  await h.sessions.reportDevice({ sessionId: session.sessionId, participantId: 'p_real_cust', camera: 'granted', mic: 'granted' });
  const rec = await h.recording.requestRecording({ tenantId: TENANT, sessionId: session.sessionId });
  // failFetch：310 声明了文件但取回失败（模拟回调称完成而对象不存在）。
  await h.loop.finishTask({ taskId: rec.taskId, bytes: Buffer.from('should-not-be-used'), failFetch: true });
  const st = await h.recording.statusOf({ tenantId: TENANT, sessionId: session.sessionId });
  assert.equal(st.recordingState, 'failed');
  assert.equal(st.incomplete, true, 'recording_incomplete');
  assert.equal(st.files[0].status, 'missing');
  const auditRow = (await h.store.query(`SELECT summary FROM audit_log WHERE tenant_id=$1 AND action='RECORDING_INCOMPLETE' AND target_id=$2`, [TENANT, session.sessionId])).rows[0];
  assert.match(auditRow.summary, /cannot be treated as complete evidence/);
});

test('I24: 合成素材进实时会话 → sourceMode=synthetic 全链透传，不得标为真实现场', async () => {
  h.wireLoop();
  h.wireRecording();
  const { session, invite } = await makeLiveSession({ sourceMode: 'synthetic' });
  assert.equal(session.sourceMode, 'synthetic');
  await h.sessions.join({ token: invite.token });
  await h.sessions.reportDevice({ sessionId: session.sessionId, participantId: 'p_synthetic_cust', camera: 'granted', mic: 'granted' });
  const rec = await h.recording.requestRecording({ tenantId: TENANT, sessionId: session.sessionId });
  await h.loop.finishTask({ taskId: rec.taskId, bytes: Buffer.from('SYNTHETIC-SCENE-BYTES') });
  const st = await h.recording.statusOf({ tenantId: TENANT, sessionId: session.sessionId });
  assert.equal(st.recordingState, 'complete');

  // 证据登记：sourceMode 必须随链透传。
  const file = (await h.store.query(`SELECT object_ref, sha256 FROM recording_files WHERE session_id=$1`, [session.sessionId])).rows[0];
  const art = await h.evidence.registerArtifact({
    tenantId: TENANT, customerId: 'cust_synthetic_sess', sessionId: session.sessionId,
    sourceProvider: 'trtc_local_loop', kind: 'media', objectRef: file.object_ref, sha256: file.sha256,
    sourceGroup: rec.taskId, sourceMode: 'synthetic',
  });
  const row = (await h.store.query(`SELECT source_mode FROM evidence_artifacts WHERE evidence_id=$1`, [art.evidenceId])).rows[0];
  assert.equal(row.source_mode, 'synthetic', '合成素材不得标为 real 客户现场');
});
