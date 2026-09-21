// V0.4 01 路故障注入套件：上游异常失败关闭 + 输入校验。
// ① --faulty-verifier 真实内核注入：验证器异常 → 投影与写门同闭（403），凭据不外泄。
// ② 进程内替身池单测（本套件唯一替身项）：DB 查询异常 → 投影"拒绝上抛"，绝不伪装成 ok:false 无权限。
// 契约：docs/v0.4/results/01-upload/CONTRACT.md §1.2。
import test from 'node:test';
import assert from 'node:assert/strict';
import { startKernel, client, newId } from './utils.mjs';
import { buildUploadAuthorization } from '../src/domain/upload-authorization.ts';
import { tokenDirectoryVerifier } from '../src/domain/principal.ts';
import { createHash } from 'node:crypto';

const TOK = { admin: 'tok-admin', biz: 'tok-biz' };
const SPEC = `${TOK.admin}=alice:human:admin:all,${TOK.biz}=bob:human:business:all:t1`;
let k;

test.before(async () => {
  k = await startKernel({ principalSpec: SPEC, extraArgs: ['--faulty-verifier'] });
});

test.after(async () => { await k.stop(); });

test('验证器异常（真实内核注入）：投影 GET 与 registerArtifact 同闭 403，异常文本/凭据不外泄', async () => {
  const get = await client(k.base, TOK.admin)('GET', '/api/v2/customers/cust-x/upload-authorization?kind=invoice');
  assert.equal(get.status, 403);
  assert.equal(get.json.error, 'PRINCIPAL_UNTRUSTED');
  assert.ok(!JSON.stringify(get.json).includes(TOK.admin), '响应不得回显凭据');
  assert.ok(!JSON.stringify(get.json).includes('verifier exploded'), '验证器异常文本不得透传');
  const w = await client(k.base, TOK.admin)('POST', '/api/v2/customers/cust-x/artifacts', {
    tenantId: 't1', requestId: newId('req'), kind: 'invoice', content: {},
  });
  assert.equal(w.status, 403);
  assert.equal(w.json.error, 'PRINCIPAL_UNTRUSTED');
  // 无会话同闭
  const anonGet = await client(k.base, null)('GET', '/api/v2/customers/cust-x/upload-authorization');
  assert.equal(anonGet.status, 403);
});

test('输入校验：customerId 超长 → 400 INVALID_INPUT（与写门 reqString 同口径）', async () => {
  const longId = 'c'.repeat(65);
  const r = await client(k.base, TOK.admin)('GET', `/api/v2/customers/${longId}/upload-authorization`);
  assert.equal(r.status, 400);
  assert.equal(r.json.error, 'INVALID_INPUT');
});

// ---- 进程内替身池单测（唯一替身项；标注：DB 层故障无法在共享基础设施上真实注入，用显式替身池）----

function stubKernel({ verifier, dbError }) {
  return {
    verifierForV2: () => verifier,
    pool: {
      query: async () => { throw new Error(dbError); },
    },
  };
}

test('替身池：DB 查询异常 → authorizeUpload 拒绝上抛，绝不伪装成 ok:false 无权限', async () => {
  const verifier = tokenDirectoryVerifier([{
    credentialSha256: createHash('sha256').update('tok-x').digest('hex'),
    principal: { principalId: 'p1', displayName: 'p1', kind: 'human', roles: ['business'], projects: 'all', tenants: 'all', customers: 'all' },
  }]);
  const ua = buildUploadAuthorization(stubKernel({ verifier, dbError: '模拟数据库连接中断（替身池）' }));
  await assert.rejects(
    () => ua.authorizeUpload({ credential: 'tok-x', customerId: 'c1', kind: 'invoice' }),
    (e) => /(模拟数据库连接中断)/.test(e.message) && e.code !== 'PERMISSION_DENIED',
    'DB 故障必须上抛（HTTP 层 500），不得解析成结构化拒绝',
  );
});

test('替身验证器：验证器异常 → PRINCIPAL_UNTRUSTED 失败关闭且不回显凭据（与 HTTP 注入同语义）', async () => {
  const ua = buildUploadAuthorization(stubKernel({
    verifier: async () => { throw new Error(`verifier exploded; credential=SECRET-TOK`); },
    dbError: '不应触达',
  }));
  await assert.rejects(
    () => ua.authorizeUpload({ credential: 'SECRET-TOK', customerId: 'c1' }),
    (e) => e.code === 'PRINCIPAL_UNTRUSTED' && !e.message.includes('SECRET-TOK') && !e.message.includes('exploded'),
  );
});

test('替身验证器：无可信身份源（verifier=null）→ 有凭据与无凭据都失败关闭', async () => {
  const ua = buildUploadAuthorization(stubKernel({ verifier: null, dbError: '不应触达' }));
  await assert.rejects(
    () => ua.authorizeUpload({ credential: 'anything', customerId: 'c1' }),
    (e) => e.code === 'PRINCIPAL_UNTRUSTED',
  );
  await assert.rejects(
    () => ua.authorizeUpload({ credential: undefined, customerId: 'c1' }),
    (e) => e.code === 'PRINCIPAL_UNTRUSTED',
  );
});
