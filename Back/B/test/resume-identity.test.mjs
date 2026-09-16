// D-9 可信恢复身份测试:失败关闭矩阵 + 边界盖章 + 命令有效性。

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateResumeAccess, validateResumeCommand, computeResumeEffects, isResumable, evidenceWaitingStepIds,
} from '../src/resume-core.mjs';
import { testVerifier } from './helpers.mjs';

const CTX = { runId: 'run1', projectId: 'p1', action: 'retry_step', stepId: 's1' };

test('失败关闭矩阵:未配置验证器/缺凭据/错凭据/非human/伪造actor 全拒绝', () => {
  // 未配置验证器
  let r = validateResumeAccess({ command: { principalCredential: 'x', action: 'abort' }, ctx: CTX });
  assert.equal(r.code, 'PRINCIPAL_UNTRUSTED');
  // 缺凭据
  r = validateResumeAccess({ principalVerifier: testVerifier(), command: { action: 'abort' }, ctx: CTX });
  assert.equal(r.code, 'PRINCIPAL_UNTRUSTED');
  // 错凭据
  r = validateResumeAccess({ principalVerifier: testVerifier(), command: { principalCredential: 'wrong', action: 'abort' }, ctx: CTX });
  assert.equal(r.code, 'PRINCIPAL_UNTRUSTED');
  // 机器身份(role != human)
  r = validateResumeAccess({
    principalVerifier: () => ({ ok: true, principalId: 'bot', role: 'agent' }),
    command: { principalCredential: 'cred:bot', action: 'abort' }, ctx: CTX,
  });
  assert.equal(r.code, 'PRINCIPAL_UNTRUSTED');
  // command.actor 自声明不构成授权
  r = validateResumeAccess({
    principalVerifier: testVerifier(),
    command: { principalCredential: 'wrong', actor: 'boss', action: 'abort' }, ctx: CTX,
  });
  assert.equal(r.code, 'PRINCIPAL_UNTRUSTED');
});

test('可信 human 通过;authorizer 可按项目/动作拒绝', () => {
  const ok = validateResumeAccess({
    principalVerifier: testVerifier(), command: { principalCredential: 'cred:boss', action: 'retry_step', stepId: 's1' }, ctx: CTX,
  });
  assert.deepEqual({ ok: ok.ok, principalId: ok.principalId, role: ok.role }, { ok: true, principalId: 'boss', role: 'human' });

  const denied = validateResumeAccess({
    principalVerifier: testVerifier(),
    authorizer: (v, ctx) => (ctx.projectId === 'p1' ? { ok: false, reasonZh: '无该项目授权' } : { ok: true }),
    command: { principalCredential: 'cred:boss', action: 'retry_step', stepId: 's1' }, ctx: CTX,
  });
  assert.equal(denied.code, 'AUTHORIZATION_DENIED');
});

test('命令校验:无盖章拒绝(防绕过边界);版本门;重试目标状态门;accept 须带 note', () => {
  // 无 trustedPrincipal
  let v = validateResumeCommand({ command: { action: 'abort' }, terminalKind: 'failed', currentVersions: { factVersion: '1' }, requiredVersions: { factVersion: '1' } });
  assert.equal(v.code, 'PRINCIPAL_UNTRUSTED');

  const stamp = { principalId: 'boss', role: 'human' };
  // completed 不可 resume
  v = validateResumeCommand({ command: { action: 'abort' }, terminalKind: 'completed', currentVersions: { factVersion: '1' }, requiredVersions: { factVersion: '1' }, trustedPrincipal: stamp });
  assert.equal(v.code, 'TERMINAL_STATE');
  // running 不可并发 resume
  v = validateResumeCommand({ command: { action: 'abort' }, terminalKind: null, currentVersions: { factVersion: '1' }, requiredVersions: { factVersion: '1' }, trustedPrincipal: stamp });
  assert.equal(v.code, 'RUN_NOT_RESUMABLE');
  // 版本变化+retry_step:显式人工授权即重锚(DEF-03 语义;完成前漂移仍由新鲜度核对拦截)
  v = validateResumeCommand({ command: { action: 'retry_step', stepId: 's1' }, terminalKind: 'unknown', currentVersions: { factVersion: '2' }, requiredVersions: { factVersion: '1' }, trustedPrincipal: stamp, steps: [{ id: 's1', state: 'unknown' }] });
  assert.equal(v.ok, true);
  // 版本变化+provide_evidence 无 newFactVersion → 必须显式重锚
  v = validateResumeCommand({ command: { action: 'provide_evidence', payload: { newEvidenceRefs: [{ id: 'e', version: '1', hash: 'h' }] } }, terminalKind: 'waiting_evidence', currentVersions: { factVersion: '2' }, requiredVersions: { factVersion: '1' }, trustedPrincipal: stamp });
  assert.equal(v.code, 'VERSION_CHANGED');
  // provide_evidence + newFactVersion 匹配 → 通过
  v = validateResumeCommand({ command: { action: 'provide_evidence', payload: { newEvidenceRefs: [{ id: 'e', version: '1', hash: 'h' }], newFactVersion: '2' } }, terminalKind: 'waiting_evidence', currentVersions: { factVersion: '2' }, requiredVersions: { factVersion: '1' }, trustedPrincipal: stamp });
  assert.equal(v.ok, true);
  // 重试目标状态不可重试
  v = validateResumeCommand({ command: { action: 'retry_step', stepId: 's2' }, terminalKind: 'failed', currentVersions: { factVersion: '1' }, requiredVersions: { factVersion: '1' }, trustedPrincipal: stamp, steps: [{ id: 's2', state: 'succeeded' }] });
  assert.equal(v.code, 'INVALID_RESUME');
  // accept_and_complete 必须带 note
  v = validateResumeCommand({ command: { action: 'accept_and_complete', payload: {} }, terminalKind: 'human_required', currentVersions: { factVersion: '1' }, requiredVersions: { factVersion: '1' }, trustedPrincipal: stamp });
  assert.equal(v.code, 'INVALID_RESUME');
  v = validateResumeCommand({ command: { action: 'accept_and_complete', payload: { note: '人工接受' } }, terminalKind: 'human_required', currentVersions: { factVersion: '1' }, requiredVersions: { factVersion: '1' }, trustedPrincipal: stamp });
  assert.equal(v.ok, true);
});

test('resume 效果计算:provide_evidence 重锚+代次推进;abort 终局', () => {
  const e1 = computeResumeEffects({ action: 'provide_evidence', payload: { newEvidenceRefs: [{ id: 'e2', version: '1', hash: 'x' }] }, currentVersions: { factVersion: '5', ruleVersion: '1' } });
  assert.equal(e1.generationBump, true);
  assert.deepEqual(e1.requiredVersions, { factVersion: '5', ruleVersion: '1' });
  const e2 = computeResumeEffects({ action: 'abort', payload: {}, currentVersions: { factVersion: '5' } });
  assert.equal(e2.terminal.humanAborted, true);
  assert.ok(isResumable('unknown') && isResumable('waiting_evidence') && !isResumable('completed'));
  assert.deepEqual(evidenceWaitingStepIds([{ id: 'a', state: 'waiting_evidence' }, { id: 'b', state: 'succeeded' }]), ['a']);
});
