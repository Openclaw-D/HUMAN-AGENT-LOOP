// 缺字段/类型错 + 非法角色/用途:全部在送出前拒绝,零外部调用、零预留
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createModelAdapter } from '../../src/adapter.mjs';
import { createMemoryLedger } from '../../src/ledger.mjs';
import { makeEvidence, makeRequest, recordingTransport } from '../helpers.mjs';

function rejectCase(name, overrides) {
  test(`请求校验拒绝:${name}`, async () => {
    const { transport, calls } = recordingTransport(async () => ({ ok: true, output: { findings: [], questions: [], evidenceRefs: [] } }));
    const ledger = createMemoryLedger({});
    const adapter = createModelAdapter({ transport, ledger, timeoutMs: 5000 });
    const r = await adapter.analyze(makeRequest(overrides), {});
    assert.equal(r.status, 'failed', `${name} 必须 failed`);
    assert.equal(r.error.code, 'REQUEST_INVALID');
    assert.ok(hasChinese(r.error.message), '错误信息必须中文');
    assert.equal(calls.length, 0, `${name} 不得发起外部调用`);
    assert.equal(ledger.totals().occupiedTokens, 0, `${name} 不得占用预算`);
  });
}

function hasChinese(s) {
  return /[\u4e00-\u9fff]/.test(s);
}

rejectCase('缺 requestId', { requestId: undefined });
rejectCase('空 requestId', { requestId: '' });
rejectCase('缺 projectId', { projectId: '' });
rejectCase('缺 sessionId', { sessionId: '' });
rejectCase('缺 purpose', { purpose: '' });
rejectCase('generation 非整数', { generation: 1.5 });
rejectCase('generation 为 0', { generation: 0 });
rejectCase('generation 为负', { generation: -2 });
rejectCase('contextVersion 缺失', { contextVersion: undefined });
rejectCase('contextVersion 空串', { contextVersion: '' });
rejectCase('text 不是字符串', { text: 123 });
rejectCase('evidenceRefs 不是数组', { evidenceRefs: 'EV-001' });
rejectCase('evidenceRefs 项缺 hash', { evidenceRefs: [{ id: 'EV-001', version: 'v1' }] });
rejectCase('evidenceRefs 项空 id', { evidenceRefs: [{ id: '', version: 'v1', hash: 'aa' }] });
rejectCase('缺少 role', { role: undefined });

test('非法角色:UNKNOWN_ROLE,未配置角色不得调用', async () => {
  const { transport, calls } = recordingTransport(async () => ({ ok: true, output: { findings: [], questions: [], evidenceRefs: [] } }));
  const adapter = createModelAdapter({ transport, ledger: createMemoryLedger({}), timeoutMs: 5000 });
  const r = await adapter.analyze(makeRequest({ role: 'boss' }), {});
  assert.equal(r.status, 'failed');
  assert.equal(r.error.code, 'UNKNOWN_ROLE');
  assert.equal(calls.length, 0);
});

test('角色名大小写敏感:Credit ≠ credit(协议标识英文小写)', async () => {
  const adapter = createModelAdapter({ transport: async () => ({}), ledger: createMemoryLedger({}), timeoutMs: 5000 });
  const r = await adapter.analyze(makeRequest({ role: 'Credit' }), {});
  assert.equal(r.error.code, 'UNKNOWN_ROLE');
});

test('用途越权:角色配置不允许该 purpose 时拒绝', async () => {
  const adapter = createModelAdapter({ transport: async () => ({}), ledger: createMemoryLedger({}), timeoutMs: 5000 });
  const r = await adapter.analyze(makeRequest({ role: 'policy', purpose: 'credit_review' }), {});
  assert.equal(r.status, 'failed');
  assert.equal(r.error.code, 'PURPOSE_NOT_ALLOWED');
  assert.ok(r.error.message.includes('policy'));
});

test('自定义 roles 配置生效:可配置角色集合与允许用途', async () => {
  const adapter = createModelAdapter({
    transport: async () => ({ ok: true, output: { findings: [], questions: [], evidenceRefs: [] } }),
    ledger: createMemoryLedger({}),
    timeoutMs: 5000,
    roles: { auditor: { label: '审计', allowedPurposes: '*' } },
  });
  const ok = await adapter.analyze(makeRequest({ role: 'auditor', purpose: 'anything' }), {});
  assert.equal(ok.status, 'failed'); // 空输出被拒,但角色/用途校验已通过 → 错误码不是 UNKNOWN_ROLE
  assert.notEqual(ok.error.code, 'UNKNOWN_ROLE');
  assert.notEqual(ok.error.code, 'PURPOSE_NOT_ALLOWED');
});

test('未知字段被忽略并记入 warnings(前向兼容)', async () => {
  const adapter = createModelAdapter({
    transport: async (call) => ({
      ok: true,
      output: { findings: [], questions: [{ id: 'Q1', text: '占位' }], evidenceRefs: [] },
    }),
    ledger: createMemoryLedger({}),
    timeoutMs: 5000,
  });
  const r = await adapter.analyze(makeRequest({ clientHint: 'extra-field' }), {});
  assert.deepEqual(r.warnings, ['忽略未知字段:clientHint']);
});
