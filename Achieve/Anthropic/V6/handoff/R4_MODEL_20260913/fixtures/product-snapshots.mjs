// 冻结产品形状的合成快照(R3 接入测试用)。
// 形状严格对照产品源码(只读核对,2026-09-13):
//   RemoteStoreState     lib/v5-preview/remote-store.ts:44-56(version/sessions/evidence/...)
//   RemoteSessionRecord  lib/v5-preview/remote-types.ts:44-55(status: scheduled|live|paused|ended;generation 初始 0)
//   EvidenceRecord       lib/v5-preview/remote-types.ts:61-81(evidenceId/fixtureId/sha256/version/supersededBy)
// 内容全部为合成尽调场景;sha256 为合成字节的真 SHA256(16 hex 截断样例仅供合成用,
// 桥只要求非空字符串)。无真实客户数据/真实端点。
import { createHash } from 'node:crypto';

const sha = (seed) => createHash('sha256').update(`synthetic:${seed}`).digest('hex');

function evidence(partial) {
  return Object.freeze({
    evidenceId: 'EV-SYN-001',
    projectId: '2026PA21001',
    sessionId: 'sess-remote-001',
    fixtureId: 'fixture-syn-001',
    title: '【合成】现场照片:仓库实景',
    sourceType: 'simulation_fixture',
    capturedAt: '2026-09-13T02:00:00+08:00',
    receivedAt: '2026-09-13T02:01:00+08:00',
    mime: 'image/svg+xml',
    width: 800,
    height: 600,
    sha256: sha('ev1'),
    version: 1,
    supersededBy: null,
    supersedes: null,
    digestOf: 'fixture_bytes',
    ...partial,
  });
}

function session(partial) {
  return Object.freeze({
    sessionId: 'sess-remote-001',
    projectId: '2026PA21001',
    title: '【合成】实控人远程访谈',
    status: 'live',
    generation: 0, // 产品初始 0(pause/resume 各 +1;legacy 读侧补 0)
    participants: [],
    video: { provider: 'none', message: '视频服务未接入' },
    createdAt: '2026-09-13T01:00:00+08:00',
    updatedAt: '2026-09-13T02:00:00+08:00',
    ...partial,
  });
}

/** 基准:单会话、3 条有效证据、remoteVersion=7。 */
export function snapshotV7() {
  return {
    version: 7,
    sessions: [session({})],
    evidence: [
      evidence({ evidenceId: 'EV-SYN-001', fixtureId: 'fixture-syn-001', sha256: sha('ev1') }),
      evidence({ evidenceId: 'EV-SYN-002', fixtureId: 'fixture-syn-002', sha256: sha('ev2'), title: '【合成】银行流水节选' }),
      evidence({ evidenceId: 'EV-SYN-003', fixtureId: 'fixture-syn-003', sha256: sha('ev3'), title: '【合成】生产排班表' }),
    ],
  };
}

/** 暂停中:status='paused',generation=2(两次 pause_round)。 */
export function snapshotPausedGen2() {
  return {
    version: 9,
    sessions: [session({ status: 'paused', generation: 2 })],
    evidence: snapshotV7().evidence,
  };
}

/** 证据升级:EV-SYN-001 被 EV-SYN-004 取代(重拍链);remoteVersion=10。 */
export function snapshotEvidenceUpgraded() {
  return {
    version: 10,
    sessions: [session({ generation: 2 })],
    evidence: [
      evidence({ evidenceId: 'EV-SYN-001', fixtureId: 'fixture-syn-001', sha256: sha('ev1'), supersededBy: 'EV-SYN-004' }),
      evidence({ evidenceId: 'EV-SYN-004', fixtureId: 'fixture-syn-004', sha256: sha('ev4'), title: '【合成】现场照片:仓库实景(重拍)', supersedes: 'EV-SYN-001' }),
      evidence({ evidenceId: 'EV-SYN-002', fixtureId: 'fixture-syn-002', sha256: sha('ev2'), title: '【合成】银行流水节选' }),
      evidence({ evidenceId: 'EV-SYN-003', fixtureId: 'fixture-syn-003', sha256: sha('ev3'), title: '【合成】生产排班表' }),
    ],
  };
}

/** 跨会话:第二会话(sess-remote-002,已结束)持有独立证据,用于跨项目/跨会话污染为零的测试。 */
export function snapshotTwoSessions() {
  const base = snapshotV7();
  return {
    version: 11,
    sessions: [base.sessions[0], session({ sessionId: 'sess-remote-002', projectId: '2026PA21002', status: 'ended', generation: 1, title: '【合成】另一项目访谈' })],
    evidence: [
      ...base.evidence,
      evidence({ evidenceId: 'EV-B-001', projectId: '2026PA21002', sessionId: 'sess-remote-002', fixtureId: 'fixture-b-001', sha256: sha('b1'), title: '【合成】另一项目凭据' }),
    ],
  };
}

/** 缺元:version 缺失(拒绝正式输出的负样本)。 */
export function snapshotMissingVersion() {
  const s = snapshotV7();
  const { version, ...rest } = s; // 故意去掉 version
  return rest;
}

/** legacy:generation 缺失(R2 FIELD_MAPPING 指出的读侧补 0 场景;桥应拒绝,由读侧先补)。 */
export function snapshotLegacyNoGeneration() {
  const base = snapshotV7();
  const sess = { ...base.sessions[0] };
  delete sess.generation;
  return { ...base, sessions: [sess] };
}
