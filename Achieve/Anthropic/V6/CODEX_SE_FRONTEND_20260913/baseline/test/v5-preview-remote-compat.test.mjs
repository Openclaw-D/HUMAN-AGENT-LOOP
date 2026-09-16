// V6 REMOTE_F4_LEGACY_COMPAT · 旧 remote-store.json 非破坏兼容 + provider adapter 状态再判定回归。
// 两项关闭（服务层真执行，隔离数据；无网络、无密钥、全合成）：
//   A) 旧 store（缺 session.generation / calculation.basedOn）读取不拒：内存补默认 + legacy 标记，
//      原文件字节不动；合法写入后新格式落盘且旧数据 100% 保留；损坏 JSON 仍 REMOTE_STORE_CORRUPT。
//   B) adapter：provider await 完成后按当前状态再判定（paused/版本过期 → rejected）；回放缓存键 =
//      完整规范化请求身份（含 annotationId），命中缓存返回 provider 原始输出但仍过状态再判定。
// 运行：node --experimental-strip-types --test test/v5-preview-remote-compat.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'remote-compat-data-'));
const storeFile = join(dataDir, 'remote-store.json');

const svc = await import('../lib/v5-preview/remote-service.ts');
const store = await import('../lib/v5-preview/remote-store.ts');

// ---------------------------------------------------------------------------
// 旧样本 fixture：完整合法旧 store JSON（schema 相同、无 generation/basedOn/digestOf/supersedes，
// 含 1 会话 1 证据 1 标注 1 计算）。每次调用返回深拷贝，供各测试独立改写。
// ---------------------------------------------------------------------------

function legacyStoreFixture() {
  return JSON.parse(JSON.stringify({
    schema: 'v5-preview-remote-store@1',
    version: 7,
    sessions: [{
      sessionId: 'rs-legacy-1',
      projectId: 'JW-2026-018',
      title: '历史会话（旧格式样本）',
      status: 'live',
      participants: [{
        participantId: 'pt-legacy-1',
        displayName: '客户 · 实控人（合成）',
        kind: 'customer',
        domainRole: 'customer-actual-controller',
        attendance: 'on_site_declared',
        attendanceVerified: false,
        joined: true,
      }],
      video: { provider: 'none', state: 'not_configured', message: '视频服务未接入（旧格式样本）' },
      createdAt: '2026-09-01T02:00:00.000Z',
      updatedAt: '2026-09-01T03:00:00.000Z',
    }],
    evidence: [{
      evidenceId: 'ev-legacy-1',
      projectId: 'JW-2026-018',
      sessionId: 'rs-legacy-1',
      fixtureId: 'fixture-inspection',
      title: '生产现场巡检照片（合成测试图形）',
      sourceType: 'simulation_fixture',
      capturedAt: '2026-09-01T02:05:00.000Z',
      receivedAt: '2026-09-01T02:06:00.000Z',
      mime: 'image/svg+xml',
      width: 800,
      height: 600,
      sha256: 'legacy-sha-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      version: 1,
      supersededBy: null,
    }],
    annotations: [{
      annotationId: 'an-legacy-1',
      sessionId: 'rs-legacy-1',
      evidenceId: 'ev-legacy-1',
      evidenceVersion: 1,
      rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
      question: '该区块设备现状（旧格式样本）',
      author: '业务 · 王业务（演示身份）',
      status: 'open',
      version: 1,
      createdAt: '2026-09-01T02:10:00.000Z',
      replies: [],
    }],
    reviews: [],
    calculations: [{
      calcId: 'calc-legacy-1',
      sessionId: 'rs-legacy-1',
      status: 'ready_for_review',
      reasons: ['测试输入：算术观察为正（旧格式样本，非实际核算）。'],
      inputs: [{ label: '方案金额', value: 100, unit: '万元', source: 'test_fixture', version: 1 }],
      inputDigest: 'legacy-input-digest-abcdef',
      result: { kind: 'test_arithmetic_observation', totalCashFlow: 520, totalCost: 30, net: 490 },
      at: '2026-09-01T02:20:00.000Z',
      version: 1,
    }],
    ruleConfig: { version: 0, status: 'unconfigured', layers: { technicalQuality: null, evidenceSufficiency: null, businessRisk: null, economics: null } },
    idempotency: [],
  }));
}

function expectStoreError(action, code) {
  let caught = null;
  try { action(); } catch (e) { caught = e; }
  assert.ok(caught !== null, `应当抛出 ${code}`);
  assert.equal(caught && caught.code, code, `错误码应为 ${code}，实际 ${caught && caught.code}：${caught && caught.message}`);
}

// ---------------------------------------------------------------------------
// A：旧 store 非破坏兼容读
// ---------------------------------------------------------------------------

test('C0：隔离数据目录（本套件首个测试内设置 env；isolation=none 共享进程下避免跨套件互踩）', () => {
  process.env.V5_PREVIEW_DATA_DIR = dataDir;
});

test('C1：旧样本读取成功——session.generation 补 0、calculation.basedOn 补默认且带 legacy 标记；原文件字节不变（读取非破坏）', () => {
  writeFileSync(storeFile, JSON.stringify(legacyStoreFixture(), null, 2), 'utf8');
  const before = readFileSync(storeFile);
  assert.ok(existsSync(storeFile));

  const state = store.readRemoteStoreState();
  // 会话：generation 内存补 0 + legacy 标记
  assert.equal(state.sessions.length, 1);
  assert.equal(state.sessions[0].sessionId, 'rs-legacy-1');
  assert.equal(state.sessions[0].generation, 0, '缺 generation 的历史会话按 0 读取');
  assert.equal(state.sessions[0].legacy, true, '内存对象带 legacy 标记供上层显示');
  // 计算：basedOn 补默认 + legacy 标记
  assert.equal(state.calculations.length, 1);
  assert.deepEqual(state.calculations[0].basedOn, { remoteVersion: 0, ruleConfigStatus: 'unconfigured', generation: 0, legacy: true });
  // 其余记录原样（digestOf/supersedes 缺省容忍）
  assert.equal(state.evidence.length, 1);
  assert.equal(state.evidence[0].evidenceId, 'ev-legacy-1');
  assert.equal(state.evidence[0].digestOf, undefined, '不篡改原记录：evidence.digestOf 仍缺省');
  assert.equal(state.annotations.length, 1);
  assert.equal(state.annotations[0].annotationId, 'an-legacy-1');
  assert.equal(state.version, 7);

  // 读取非破坏：原文件字节完全不变
  const after = readFileSync(storeFile);
  assert.ok(before.equals(after), '读取不得改动原文件字节');
});

test('C1b：服务详情层可消费 legacy 读取态——generation 可用、旧核算显示 stale、旧证据按 legacy 摘要语义显示', () => {
  const detail = svc.getRemoteSessionDetail('rs-legacy-1');
  assert.equal(detail.session.generation, 0);
  // F4 stale 现算：basedOn.remoteVersion=0 < 当前 version → 显示过期，历史不改写
  assert.equal(detail.calculations[0].stale, true);
  assert.equal(detail.calculations[0].basedOn.legacy, true, 'legacy 标记透出给上层');
  // digestOf 缺省的历史证据按 legacy 语义显示（fixture_meta_legacy）
  assert.equal(detail.evidence[0].digestOf, 'fixture_meta_legacy');
  assert.equal(detail.evidence[0].expired, false);
});

test('C2：legacy 读后合法写入 → 新格式落盘（generation/basedOn 出现），旧数据内容 100% 保留，绝不以删文件"恢复"', () => {
  const current = svc.getRemoteState().remoteVersion;
  // 走真实服务写路径（附着证据）：读→内存补齐→推进→原子写
  const attach = svc.attachEvidence({ requestId: 'compat-attach-1', expectedVersion: current, sessionId: 'rs-legacy-1', fixtureId: 'fixture-equipment' });
  assert.equal(attach.ok, true);
  assert.ok(existsSync(storeFile), '写入是升级而非删建：文件始终存在');

  const onDisk = JSON.parse(readFileSync(storeFile, 'utf8'));
  assert.equal(onDisk.schema, 'v5-preview-remote-store@1');
  assert.equal(onDisk.version, current + 1);
  // 新格式字段出现在此前缺省的历史记录上
  assert.equal(onDisk.sessions[0].generation, 0, 'session.generation 已随合法写入落盘');
  assert.deepEqual(
    { remoteVersion: onDisk.calculations[0].basedOn.remoteVersion, ruleConfigStatus: onDisk.calculations[0].basedOn.ruleConfigStatus, generation: onDisk.calculations[0].basedOn.generation },
    { remoteVersion: 0, ruleConfigStatus: 'unconfigured', generation: 0 },
    'calculation.basedOn 已随合法写入落盘',
  );
  // 旧数据 100% 保留：计数 + 关键字段逐一比对
  assert.equal(onDisk.sessions.length, 1);
  assert.equal(onDisk.evidence.length, 2, '旧证据保留 + 新证据追加');
  assert.equal(onDisk.annotations.length, 1);
  assert.equal(onDisk.calculations.length, 1);
  assert.equal(onDisk.sessions[0].sessionId, 'rs-legacy-1');
  assert.equal(onDisk.sessions[0].title, '历史会话（旧格式样本）');
  const legacyEv = onDisk.evidence.find((e) => e.evidenceId === 'ev-legacy-1');
  assert.equal(legacyEv.sha256, 'legacy-sha-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
  assert.equal(legacyEv.digestOf, undefined, '旧证据缺省 digestOf 原样保留（读取侧已按 legacy 语义显示）');
  assert.equal(onDisk.annotations[0].question, '该区块设备现状（旧格式样本）');
  assert.equal(onDisk.calculations[0].calcId, 'calc-legacy-1');
  assert.deepEqual(onDisk.calculations[0].result, { kind: 'test_arithmetic_observation', totalCashFlow: 520, totalCost: 30, net: 490 });
  // 新证据走新格式写入路径不变
  const newEv = onDisk.evidence.find((e) => e.evidenceId === attach.evidence.evidenceId);
  assert.equal(newEv.digestOf, 'fixture_bytes');

  // 重读稳定：generation/basedOn 已在盘上，语义不变
  const reread = store.readRemoteStoreState();
  assert.equal(reread.sessions[0].generation, 0);
  assert.equal(reread.calculations[0].basedOn.remoteVersion, 0);
});

test('C3：损坏 JSON 仍 REMOTE_STORE_CORRUPT，且不静默重置（坏文件原样保留）', () => {
  const broken = '{broken json（合成损坏样本）';
  writeFileSync(storeFile, broken, 'utf8');
  expectStoreError(() => store.readRemoteStoreState(), 'REMOTE_STORE_CORRUPT');
  assert.equal(readFileSync(storeFile, 'utf8'), broken, '损坏文件不得被读取路径静默重置/删除');
});

test('C4：严格校验对新格式保持——generation/basedOn 存在但非法仍拒绝（兼容只针对"缺省"，不针对"坏值"）', () => {
  const badGeneration = legacyStoreFixture();
  badGeneration.sessions[0].generation = 'not-a-number';
  writeFileSync(storeFile, JSON.stringify(badGeneration), 'utf8');
  expectStoreError(() => store.readRemoteStoreState(), 'REMOTE_STORE_CORRUPT');

  const badBasedOn = legacyStoreFixture();
  badBasedOn.calculations[0].basedOn = { remoteVersion: 3, ruleConfigStatus: 'unconfigured' };
  writeFileSync(storeFile, JSON.stringify(badBasedOn), 'utf8');
  expectStoreError(() => store.readRemoteStoreState(), 'REMOTE_STORE_CORRUPT');

  const badGenerationType = legacyStoreFixture();
  badGenerationType.calculations[0].basedOn = { remoteVersion: 3, ruleConfigStatus: 'unconfigured', generation: 'legacy' };
  writeFileSync(storeFile, JSON.stringify(badGenerationType), 'utf8');
  expectStoreError(() => store.readRemoteStoreState(), 'REMOTE_STORE_CORRUPT');
});

// ---------------------------------------------------------------------------
// B：provider adapter 状态再判定 + 回放缓存完整请求身份
// ---------------------------------------------------------------------------

const baseReq = {
  sessionId: 's-compat',
  annotationId: 'an-compat-1',
  evidenceRef: { fixtureId: 'fixture-inspection', sha256: 'x', version: 1 },
  domainRoles: ['credit'],
  purpose: 'follow_up_generation',
};

test('B1：provider await 完成后按当前状态再判定——await 期间 paused → rejected；证据版本过期 → rejected；两者同现以后者（版本过期）为准；probe 缺省/null 行为不变', async () => {
  const adapter = svc.createModelProviderAdapter({
    provider: 'fake',
    handler: async () => ({ followUps: [{ domainRole: 'credit', text: '追问（合成）' }] }),
  });
  // 缺省（无 probe）：行为不变
  const plain = await adapter.generateFollowUps({ ...baseReq });
  assert.equal(plain.status, 'ok');
  // await 期间会话变 paused：provider 完成后再探测 → rejected（失败关闭）
  let phase = 'live';
  const flip = svc.createModelProviderAdapter({
    provider: 'fake',
    handler: async () => { await new Promise((r) => setTimeout(r, 20)); return { followUps: [{ domainRole: 'credit', text: '追问（合成）' }] }; },
  });
  const pending = flip.generateFollowUps({ ...baseReq }, () => ({ sessionStatus: phase === 'live' ? 'live' : 'paused' }));
  phase = 'paused'; // await 期间翻转
  const flipped = await pending;
  assert.equal(flipped.status, 'rejected', 'await 期间 paused 的结果不得以 ok 返回');
  assert.match(flipped.failureReason, /paused|暂停/i);
  assert.equal(flipped.replies.length, 0, '拒绝不得携带模型回复');
  // 证据版本过期（探测）→ rejected
  const stale = await adapter.generateFollowUps({ ...baseReq }, () => ({ sessionStatus: 'live', currentEvidenceVersion: 2 }));
  assert.equal(stale.status, 'rejected');
  assert.match(stale.failureReason, /expired|过期/i);
  // 两者同现：以后者（证据版本过期）为准
  const both = await adapter.generateFollowUps({ ...baseReq }, () => ({ sessionStatus: 'paused', currentEvidenceVersion: 2 }));
  assert.equal(both.status, 'rejected');
  assert.match(both.failureReason, /expired|过期/i);
  // probe 返回 null（无法判定）：不阻断（状态门只在可判定时改判）
  const nullProbe = await adapter.generateFollowUps({ ...baseReq }, () => null);
  assert.equal(nullProbe.status, 'ok');
});

test('B2：回放缓存键 = 完整规范化请求身份（含 annotationId）——同 requestId 换 annotationId 不命中旧缓存；同身份重放返回 provider 原始输出且不重调 provider', async () => {
  let calls = 0;
  const adapter = svc.createModelProviderAdapter({
    provider: 'fake',
    handler: async (req) => {
      calls += 1;
      return { followUps: [{ domainRole: 'credit', text: `针对 ${req.annotationId} 的追问（合成）` }] };
    },
  });
  const first = await adapter.generateFollowUps({ ...baseReq, annotationId: 'an-A', requestId: 'rq-1' });
  assert.equal(first.status, 'ok');
  assert.equal(calls, 1);
  // 同 requestId、同完整身份 → 幂等重放：provider 原始输出，不重调
  const replay = await adapter.generateFollowUps({ ...baseReq, annotationId: 'an-A', requestId: 'rq-1' });
  assert.equal(calls, 1, '同身份重放不得重调 provider');
  assert.deepEqual(replay, first);
  assert.equal(replay.replies[0].text, '针对 an-A 的追问（合成）');
  // 同 requestId 换 annotationId → 请求身份变化，不再命中缓存（不得把 an-A 的结果冒充给 an-B）
  const other = await adapter.generateFollowUps({ ...baseReq, annotationId: 'an-B', requestId: 'rq-1' });
  assert.equal(other.status, 'ok');
  assert.equal(calls, 2, '身份变化必须真实调用 provider');
  assert.equal(other.replies[0].text, '针对 an-B 的追问（合成）');
  assert.notDeepEqual(other.replies, first.replies);
});

test('B3：命中缓存仍过状态再判定——缓存结果被 paused 探测改判 rejected，且拒绝不覆盖缓存（恢复后同身份重试仍取回原始输出）', async () => {
  let calls = 0;
  const adapter = svc.createModelProviderAdapter({
    provider: 'fake',
    handler: async () => {
      calls += 1;
      return { followUps: [{ domainRole: 'policy', text: '缓存命中仍需再判定（合成）' }] };
    },
  });
  const first = await adapter.generateFollowUps({ ...baseReq, requestId: 'rq-2' });
  assert.equal(first.status, 'ok');
  assert.equal(calls, 1);
  // 命中缓存 + 当前 paused → 改判 rejected（不是 ok）
  const gated = await adapter.generateFollowUps({ ...baseReq, requestId: 'rq-2' }, () => ({ sessionStatus: 'paused' }));
  assert.equal(gated.status, 'rejected', '缓存的 ok 结果也必须按当前状态再判定');
  assert.match(gated.failureReason, /paused|暂停/i);
  // 状态门拒绝不写缓存：恢复后同身份重试仍返回 provider 原始输出
  const after = await adapter.generateFollowUps({ ...baseReq, requestId: 'rq-2' });
  assert.equal(after.status, 'ok');
  assert.equal(calls, 1, '恢复后的重试命中原缓存，不重调 provider');
  assert.deepEqual(after.replies, first.replies);
});
