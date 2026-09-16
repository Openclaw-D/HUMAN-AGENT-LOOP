// 凭据卫生(redaction)测试:结构化脱敏、形状脱敏、异常出口、日志包装、D-10 场景。

import test from 'node:test';
import assert from 'node:assert/strict';
import { redactText, redactValue, safeError, createSafeLogger } from '../src/redact.mjs';
import { validateResumeAccess } from '../src/resume-core.mjs';

test('redactText:Bearer/sk-/JWT/长hex/key=value 形状全替换,幂等', () => {
  const input = 'Authorization: Bearer abc123def456 + sk-abcdef12345678 + eyJa.b2xl.cA00 + deadbeefdeadbeefdeadbeefdeadbeef01 + api_key=bbbbbbbbbbbbbb';
  const out = redactText(input);
  assert.ok(!out.includes('abc123def456'));
  assert.ok(!out.includes('sk-abcdef12345678'));
  assert.ok(!out.includes('deadbeef'));
  assert.ok(!out.includes('bbbbbbbbbbbbbb'));
  assert.equal(redactText(out), out); // 幂等
  // 普通文本不受影响
  assert.equal(redactText('正常业务文本 project-1 v2'), '正常业务文本 project-1 v2');
});

test('redactValue:敏感键整值抹除(不看值内容),递归+循环引用安全', () => {
  const v = {
    apiKey: 'whatever-value',
    nested: { principalCredential: 'cred:boss', keep: 'visible' },
    list: [{ password: 'pw', ok: 1 }],
    note: 'contains sk-xyz123456789 inside text',
  };
  const out = redactValue(v);
  assert.equal(out.apiKey, '<redacted>');
  assert.equal(out.nested.principalCredential, '<redacted>');
  assert.equal(out.nested.keep, 'visible');
  assert.equal(out.list[0].password, '<redacted>');
  assert.equal(out.list[0].ok, 1);
  assert.ok(!out.note.includes('sk-xyz'));
  const circ = {}; circ.self = circ;
  assert.equal(redactValue(circ).self, '[circular]');
  // 输入不改
  assert.equal(v.apiKey, 'whatever-value');
});

test('safeError:Error 的 message 脱敏,code 保留', () => {
  const e = new Error('调用失败 key=sk-verysecret123');
  e.code = 'X001';
  const s = safeError(e);
  assert.equal(s.code, 'X001');
  assert.ok(!s.message.includes('sk-verysecret123'));
});

test('createSafeLogger:对象与文本日志均脱敏', () => {
  const lines = [];
  const log = createSafeLogger((l) => lines.push(l));
  log({ msg: 'auth', authorization: 'Bearer tok12345678' });
  log('text with apikey=abcdefgh12345');
  const all = lines.join('\n');
  assert.ok(!all.includes('tok12345678'));
  assert.ok(!all.includes('abcdefgh12345'));
});

test('D-10 场景:verifier 抛异常且异常文本内嵌凭据 → 错误文本脱敏,失败关闭', () => {
  const evilVerifier = (credential) => {
    throw new Error(`redis connect failed using password ${credential} and sk-backend123456`);
  };
  const r = validateResumeAccess({
    principalVerifier: evilVerifier,
    command: { principalCredential: 'super-secret-cred-99', action: 'retry_step', stepId: 's1' },
    ctx: { runId: 'r', projectId: 'p', action: 'retry_step', stepId: 's1' },
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'PRINCIPAL_UNTRUSTED');
  assert.ok(!r.messageZh.includes('super-secret-cred-99'), `泄漏:${r.messageZh}`);
  assert.ok(!r.messageZh.includes('sk-backend123456'));
});

test('D-10 场景:authorizer 抛异常 → 错误文本脱敏,授权拒绝', () => {
  const r = validateResumeAccess({
    principalVerifier: () => ({ ok: true, principalId: 'u1', role: 'human' }),
    authorizer: (verdict, ctx) => { throw new Error(`policy db dsn mysql://root:p@ssw0rd@db/ audit for ${ctx.projectId}`); },
    command: { principalCredential: 'cred:u1', action: 'abort' },
    ctx: { runId: 'r', projectId: 'p', action: 'abort', stepId: null },
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'AUTHORIZATION_DENIED');
  assert.ok(!r.messageZh.includes('p@ssw0rd'));
});
