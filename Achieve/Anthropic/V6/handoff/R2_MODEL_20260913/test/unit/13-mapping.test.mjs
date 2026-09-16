// 产品映射模块测试(Agent-MAPPING)| 纯函数、零依赖:合法路径 + 失败关闭路径逐字段覆盖。
// 产品源码只读;合成用例形状取自产品真实类型与创建路径(出处见 FIELD_MAPPING.md):
// - EvidenceRecord:remote-types.ts:61-81;创建:remote-service.ts:331-347(sha256=原件字节 SHA256,version=1)
// - RemoteSessionRecord:remote-types.ts:44-55;创建默认:remote-service.ts:182-200(status/generation:0)
//   pause_round 副作用:remote-service.ts:611-615(status='paused',generation+1)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evidenceToRefs, sessionToSnapshot, statusToProductAction, canonicalRequestId } from '../../src/integration/product-mapping.mjs';
import { STATUS } from '../../src/codes.mjs';

// ---------------------------------------------------------------------------
// 产品真实形状合成样本(字段名/类型与产品源码一致,值为合成演示数据)
// ---------------------------------------------------------------------------

/** 贴近 remote-service.ts:331-347 attachEvidence 产出的真实形状。 */
function makeProductEvidence(overrides = {}) {
  return {
    evidenceId: 'ev-m1x2c3-abc',
    projectId: 'JW-2026-018',
    sessionId: 'rs-demo01-xyz',
    fixtureId: 'fixture-inspection',
    title: '生产现场巡检照片（合成测试图形）',
    sourceType: 'simulation_fixture',
    capturedAt: '2026-09-13T02:00:00.000Z',
    receivedAt: '2026-09-13T02:00:01.000Z',
    mime: 'image/svg+xml',
    width: 800,
    height: 600,
    sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'.slice(0, 64),
    version: 1,
    supersededBy: null,
    digestOf: 'fixture_bytes',
    ...overrides,
  };
}

/** 贴近 remote-service.ts:182-200 创建 + 一次 pause/resume 后(generation=1)的真实形状。 */
function makeProductSession(overrides = {}) {
  return {
    sessionId: 'rs-demo01-xyz',
    projectId: 'JW-2026-018',
    title: '某合成企业远程尽调（演示）',
    status: 'live',
    generation: 1,
    participants: [],
    video: { provider: 'none', state: 'not_configured', message: '视频服务未接入' },
    createdAt: '2026-09-13T01:30:00.000Z',
    updatedAt: '2026-09-13T01:35:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// evidenceToRefs
// ---------------------------------------------------------------------------

test('evidenceToRefs 合法路径:产品字段名映射为协议三元组,version 转字符串', () => {
  const r = evidenceToRefs([makeProductEvidence()], { source: 'unit' });
  assert.deepEqual(r, { ok: true, evidenceRefs: [{ id: 'ev-m1x2c3-abc', version: '1', hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' }] });
  assert.equal(typeof r.evidenceRefs[0].version, 'string', '协议要求 version 为非空字符串(validate-request.mjs:63)');
});

test('evidenceToRefs 空数组与多条记录:逐条映射、保序', () => {
  assert.deepEqual(evidenceToRefs([], {}), { ok: true, evidenceRefs: [] });
  const r = evidenceToRefs([
    makeProductEvidence({ evidenceId: 'ev-1', version: 1, sha256: 'aa' }),
    makeProductEvidence({ evidenceId: 'ev-2', version: 2, sha256: 'bb', fixtureId: 'fixture-contract' }),
  ]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.evidenceRefs, [
    { id: 'ev-1', version: '1', hash: 'aa' },
    { id: 'ev-2', version: '2', hash: 'bb' },
  ]);
});

test('evidenceToRefs 失败关闭:缺 evidenceId → missing 含 id,ok:false', () => {
  const r = evidenceToRefs([makeProductEvidence({ evidenceId: '' })]);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'MAPPING_MISSING_FIELDS');
  assert.equal(r.details.index, 0);
  assert.deepEqual(r.details.missing, ['id(evidenceId)']);
  assert.match(r.message, /失败关闭/);
  assert.match(r.message, /fixtureId/, 'message 须提示 fixtureId 不构成完整引用');
});

test('evidenceToRefs 失败关闭:缺 version(缺失/NaN/负数各一例)', () => {
  for (const version of [undefined, Number.NaN, -1]) {
    const r = evidenceToRefs([makeProductEvidence({ version })]);
    assert.equal(r.ok, false, `version=${version} 必须失败关闭`);
    assert.deepEqual(r.details.missing, ['version']);
  }
});

test('evidenceToRefs 失败关闭:缺 sha256 → missing 含 hash', () => {
  const r = evidenceToRefs([makeProductEvidence({ sha256: undefined })]);
  assert.equal(r.ok, false);
  assert.deepEqual(r.details.missing, ['hash(sha256)']);
  assert.equal(r.details.index, 0);
});

test('evidenceToRefs 失败关闭:fixtureId-only 记录被整体拒绝(缺三元组)', () => {
  const r = evidenceToRefs([{ fixtureId: 'fixture-inspection' }]);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'MAPPING_MISSING_FIELDS');
  assert.deepEqual(r.details.missing, ['id(evidenceId)', 'version', 'hash(sha256)']);
  assert.match(r.message, /fixtureId="fixture-inspection"/);
});

test('evidenceToRefs 失败关闭:有 fixtureId 但缺 version/hash 不构成完整引用', () => {
  const r = evidenceToRefs([makeProductEvidence({ version: undefined, sha256: '' })]);
  assert.equal(r.ok, false);
  assert.ok(r.details.missing.includes('version'));
  assert.ok(r.details.missing.includes('hash(sha256)'));
});

test('evidenceToRefs 失败关闭:第二条缺 hash → 整体失败、报 index=1,不输出部分成功', () => {
  const r = evidenceToRefs([
    makeProductEvidence({ evidenceId: 'ev-ok' }),
    makeProductEvidence({ evidenceId: 'ev-bad', sha256: '' }),
  ]);
  assert.equal(r.ok, false);
  assert.equal(r.details.index, 1);
  assert.equal(r.evidenceRefs, undefined, '失败时绝不返回部分引用清单');
});

test('evidenceToRefs 失败关闭:非数组/非对象项', () => {
  const notArray = evidenceToRefs(makeProductEvidence());
  assert.equal(notArray.ok, false);
  assert.equal(notArray.details.index, -1);
  const notObject = evidenceToRefs([makeProductEvidence(), null]);
  assert.equal(notObject.ok, false);
  assert.equal(notObject.details.index, 1);
  assert.deepEqual(notObject.details.missing, ['id(evidenceId)', 'version', 'hash(sha256)']);
});

// ---------------------------------------------------------------------------
// sessionToSnapshot
// ---------------------------------------------------------------------------

test('sessionToSnapshot 合法路径:generation/contextVersion/paused 映射正确', () => {
  const r = sessionToSnapshot(makeProductSession(), { source: 'unit', contextVersion: 42 });
  assert.deepEqual(r, { ok: true, snapshot: { generation: 1, contextVersion: 42, paused: false } });
});

test('sessionToSnapshot:status=paused → paused true(产品 pause_round 形状)', () => {
  // remote-service.ts:611-615:pause_round 后 status='paused' 且 generation+1
  const r = sessionToSnapshot(makeProductSession({ status: 'paused', generation: 2 }), { contextVersion: 'cv-9' });
  assert.equal(r.ok, true);
  assert.equal(r.snapshot.paused, true);
  assert.equal(r.snapshot.generation, 2);
  assert.equal(r.snapshot.contextVersion, 'cv-9');
});

test('sessionToSnapshot 失败关闭:缺 generation(旧会话/legacy 记录)→ ok:false', () => {
  const r = sessionToSnapshot(makeProductSession({ generation: undefined }), { contextVersion: 1 });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'MAPPING_MISSING_FIELDS');
  assert.ok(r.details.missing.includes('generation'));
  assert.match(r.message, /失败关闭/);
});

test('sessionToSnapshot 失败关闭:generation=0(产品初始/legacy 补 0)不满足协议正整数', () => {
  const r = sessionToSnapshot(makeProductSession({ generation: 0 }), { contextVersion: 1 });
  assert.equal(r.ok, false);
  assert.ok(r.details.missing.includes('generation'));
  assert.match(r.message, /0|正整数/);
});

test('sessionToSnapshot 失败关闭:generation 非整数 → ok:false', () => {
  const r = sessionToSnapshot(makeProductSession({ generation: 1.5 }), { contextVersion: 1 });
  assert.equal(r.ok, false);
  assert.ok(r.details.missing.includes('generation'));
});

test('sessionToSnapshot 失败关闭:无任何 contextVersion 来源 → ok:false(不猜默认值)', () => {
  const r = sessionToSnapshot(makeProductSession(), { source: 'unit' });
  assert.equal(r.ok, false);
  assert.ok(r.details.missing.includes('contextVersion'));
  assert.match(r.message, /remoteVersion|contextVersion/);
  // 产品会话记录本身无该字段:即使多带产品字段也不改变失败关闭
  const r2 = sessionToSnapshot(makeProductSession({ updatedAt: '2026-09-13T02:00:00.000Z' }), {});
  assert.equal(r2.ok, false);
});

test('sessionToSnapshot:options.remoteVersion 别名与 remoteSession.contextVersion 前向兼容均可用,优先级 contextVersion 最高', () => {
  const viaAlias = sessionToSnapshot(makeProductSession(), { remoteVersion: 7 });
  assert.equal(viaAlias.ok, true);
  assert.equal(viaAlias.snapshot.contextVersion, 7);
  const viaRecord = sessionToSnapshot(makeProductSession({ contextVersion: 'future-field' }), {});
  assert.equal(viaRecord.ok, true);
  assert.equal(viaRecord.snapshot.contextVersion, 'future-field');
  const priority = sessionToSnapshot(makeProductSession({ contextVersion: 'future-field' }), { contextVersion: 9, remoteVersion: 7 });
  assert.equal(priority.snapshot.contextVersion, 9);
});

test('sessionToSnapshot:contextVersion 非法值(空串/0/1.5)失败关闭', () => {
  for (const bad of ['', 0, 1.5, null]) {
    const r = sessionToSnapshot(makeProductSession(), { contextVersion: bad });
    assert.equal(r.ok, false, `contextVersion=${JSON.stringify(bad)} 必须失败关闭`);
    assert.ok(r.details.missing.includes('contextVersion'));
  }
});

test('sessionToSnapshot 安全缺省:status 缺失 → paused:false 仍可映射(文档化缺省)', () => {
  const r = sessionToSnapshot(makeProductSession({ status: undefined }), { contextVersion: 3 });
  assert.equal(r.ok, true);
  assert.equal(r.snapshot.paused, false);
});

test('sessionToSnapshot 失败关闭:status 存在但非产品枚举 → ok:false', () => {
  const r = sessionToSnapshot(makeProductSession({ status: 'PAUSED' }), { contextVersion: 3 });
  assert.equal(r.ok, false);
  assert.ok(r.details.missing.includes('status'));
});

test('sessionToSnapshot:非对象输入失败关闭', () => {
  const r = sessionToSnapshot(null, { contextVersion: 3 });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'MAPPING_MISSING_FIELDS');
});

// ---------------------------------------------------------------------------
// statusToProductAction(七状态全覆盖,语义与 R1 契约 ADAPTER_CONTRACT.md §3 一致)
// ---------------------------------------------------------------------------

test('statusToProductAction:七状态全覆盖且字段完整', () => {
  const seven = Object.values(STATUS);
  assert.equal(seven.length, 7);
  for (const status of seven) {
    const a = statusToProductAction(status);
    assert.ok(typeof a.uiAction === 'string' && a.uiAction.length > 0, `${status} 须有非空 uiAction`);
    assert.ok(typeof a.zh === 'string' && a.zh.length > 0, `${status} 须有中文说明`);
    assert.ok(typeof a.allowRetry === 'boolean');
    assert.ok(typeof a.mustHumanVerify === 'boolean');
  }
});

test('statusToProductAction 状态语义:unknown 仅人工核实后重试;stale 不得当现行;simulated 显著标记;cancelled 确定未发生', () => {
  const unknown = statusToProductAction('unknown');
  assert.equal(unknown.allowRetry, false, 'unknown 禁止自动重试');
  assert.equal(unknown.mustHumanVerify, true);
  assert.match(unknown.zh, /人工核实/);
  assert.match(unknown.zh, /重试/);

  const stale = statusToProductAction('stale');
  assert.equal(stale.mustHumanVerify, true);
  assert.match(stale.zh, /不得当作现行/);

  const simulated = statusToProductAction('simulated');
  assert.match(simulated.zh, /模拟/);
  assert.equal(simulated.mustHumanVerify, true);

  const cancelled = statusToProductAction('cancelled');
  assert.match(cancelled.zh, /未送达外部/);
  assert.equal(cancelled.mustHumanVerify, false);

  const notConfigured = statusToProductAction('not_configured');
  assert.equal(notConfigured.allowRetry, false);
  assert.match(notConfigured.zh, /未配置/);

  const failed = statusToProductAction('failed');
  assert.equal(failed.allowRetry, true);
});

test('statusToProductAction:未知状态抛 TypeError', () => {
  for (const bad of ['succeed', 'SUCCEEDED', '', undefined, 123, null]) {
    assert.throws(() => statusToProductAction(bad), TypeError, `状态 ${String(bad)} 必须抛 TypeError`);
  }
});

// ---------------------------------------------------------------------------
// canonicalRequestId
// ---------------------------------------------------------------------------

test('canonicalRequestId:格式精确且确定性(同参数恒同串)', () => {
  const a = canonicalRequestId({ sessionId: 'rs-demo01-xyz', generation: 2, op: 'question_next', seq: 0 });
  const b = canonicalRequestId({ sessionId: 'rs-demo01-xyz', generation: 2, op: 'question_next', seq: 0 });
  assert.equal(a, 'rrs-demo01-xyz-g2-question_next-0');
  assert.equal(a, b);
  assert.notEqual(a, canonicalRequestId({ sessionId: 'rs-demo01-xyz', generation: 2, op: 'question_next', seq: 1 }));
  assert.notEqual(a, canonicalRequestId({ sessionId: 'rs-demo01-xyz', generation: 3, op: 'question_next', seq: 0 }));
});

test('canonicalRequestId:非法输入抛 TypeError(逐参数)', () => {
  const base = { sessionId: 'rs-1', generation: 1, op: 'risk_review', seq: 0 };
  const cases = [
    undefined,
    { ...base, sessionId: '' },
    { ...base, sessionId: 7 },
    { ...base, generation: 0 },
    { ...base, generation: -1 },
    { ...base, generation: 1.5 },
    { ...base, op: '' },
    { ...base, seq: -1 },
    { ...base, seq: 0.5 },
  ];
  for (const params of cases) {
    assert.throws(() => canonicalRequestId(params), TypeError, `参数 ${JSON.stringify(params)} 必须抛 TypeError`);
  }
});
