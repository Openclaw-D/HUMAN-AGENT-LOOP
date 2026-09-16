// 任务三 C2·Edge 接线纯逻辑层测试：SSE 帧解析、连接状态机、会话动作推导、等待原因、
// 额度行投影、金额格式化。不涉及 DOM/网络（网络语义由 Back/Edge E0/E1 覆盖）。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  actionRequestId, deriveCreditLines, deriveSessionActions, deriveWaitReason,
  fmtAmount, modeBadge, nextPhase, parseSseFrames,
} from '../../site-mirror/lib/v5-preview/edge/edge-logic.ts';

test('SSE 帧解析：多帧/心跳/残帧缓冲', () => {
  const first = parseSseFrames(': hb 123\n\nevent: cursor\ndata: {"eventCursor":"e1","snapshotVersion":3}\n\nevent: business\nid: e2\ndata: {"payloadRef":{"type":"ARTIFACT_REGISTERED"}}\n\n');
  assert.equal(first.frames.length, 2);
  assert.equal(first.frames[0].event, 'cursor');
  assert.equal(first.frames[1].id, 'e2');
  assert.equal(first.rest, '');
  // 残帧留在缓冲
  const second = parseSseFrames('event: business\ndata: {"half":');
  assert.equal(second.frames.length, 0);
  assert.ok(second.rest.startsWith('event:'));
});

test('连接状态机：不把失败伪装成 live；重连与显式停止区分', () => {
  assert.equal(nextPhase('off', { type: 'connect' }), 'connecting');
  assert.equal(nextPhase('connecting', { type: 'opened' }), 'live');
  assert.equal(nextPhase('live', { type: 'drop' }), 'reconnecting');
  assert.equal(nextPhase('reconnecting', { type: 'opened' }), 'live');
  assert.equal(nextPhase('reconnecting', { type: 'stop' }), 'off');
  assert.equal(nextPhase('live', { type: 'auth-failed' }), 'off');
  assert.equal(nextPhase('off', { type: 'drop' }), 'off');
});

test('会话操作条：按服务端 runStatus 推导可用动作（不发明第五种状态）', () => {
  const mk = (runStatus, closureStatus = 'open') => deriveSessionActions({ runStatus, closureStatus, sessionId: 's1' });
  assert.deepEqual(mk('preparing').map((a) => a.key), ['start']);
  assert.deepEqual(mk('in_progress').map((a) => a.key), ['pause', 'end']);
  assert.deepEqual(mk('suspended').map((a) => a.key), ['resume', 'end']);
  assert.deepEqual(mk('ended', 'pending_evidence').map((a) => a.key), ['close']);
  assert.deepEqual(mk('ended', 'closed'), []);
});

test('等待原因：暂停/在途/开放问题/未决核验如实呈现', () => {
  assert.match(deriveWaitReason({ runStatus: 'suspended', sessionId: 's' }) ?? '', /自动提问停发/);
  assert.match(deriveWaitReason({ runStatus: 'in_progress', sessionId: 's', outbound: { paused: true, inFlight: [{ status: 'sent' }] } }) ?? '', /在途外发 1 条/);
  assert.match(deriveWaitReason({ runStatus: 'in_progress', sessionId: 's', openQuestions: 2 }) ?? '', /开放问题 2 个/);
  assert.match(deriveWaitReason({ runStatus: 'in_progress', sessionId: 's', coverage: { open: 3 } }) ?? '', /3 项必要核验/);
  assert.equal(deriveWaitReason({ runStatus: 'in_progress', sessionId: 's', coverage: { open: 0 }, outbound: { paused: false, inFlight: [] } }), null);
});

test('额度行投影：候选=评估、已批准=设施、可用=服务端推导值；阻断位显式呈现', () => {
  const lines = deriveCreditLines({
    assessments: [{ assessmentId: 'a1', status: 'awaiting_human_review', ruleVersion: 'rules-v1', snapshotHash: 'abc123456789', candidate: { tendency: 'do', supportableAmountMinor: 500_000_000, currency: 'CNY', conditions: [], warnings: [] } }],
    facilities: [{ facilityId: 'f1', status: 'active', approvedAmountMinor: 500_000_000, currency: 'CNY', reservedMinor: 180_000_000, availableForNewDrawMinor: 320_000_000, staleBlockers: ['stale_basis'] }],
    totalsMinor: { exposureNow: 180_000_000, reserved: 180_000_000, committed: 0, outstanding: 0 },
  });
  assert.ok(lines[0].label.includes('候选'));
  assert.match(lines[0].value, /rules-v1/);
  assert.match(lines[0].value, /abc12345/);
  assert.ok(lines[1].label.includes('已激活'));
  assert.match(lines[1].value, /500 万元/);
  assert.match(lines[1].value, /阻断：依据已失效/);
  assert.ok(lines[1].tone === 'warn');
});

test('金额格式化：万元/元/未知/非 CNY 标注', () => {
  assert.equal(fmtAmount(500_000_000, 'CNY'), '500 万元');
  assert.match(fmtAmount(80_000_000, 'CNY'), /80 万元/);
  assert.match(fmtAmount(25_000, 'CNY'), /250 元/);
  assert.equal(fmtAmount(undefined, 'CNY'), '未知');
  assert.match(fmtAmount(1_000_000, 'USD'), /USD/);
});

test('模式徽标：Live 与本地合成演示不混淆', () => {
  assert.equal(modeBadge('live').tone, 'live');
  assert.equal(modeBadge('reconnecting').tone, 'live');
  assert.equal(modeBadge('off').tone, 'local');
  assert.match(modeBadge('off').text, /未接真实后台/);
});

test('动作 requestId：会话+动作稳定，且不超过 128 上限', () => {
  const id = actionRequestId('ins-123', 'pause', 'n1');
  assert.ok(id.startsWith('ui-ins-123-pause-n1'));
  assert.ok(id.length <= 128);
});
