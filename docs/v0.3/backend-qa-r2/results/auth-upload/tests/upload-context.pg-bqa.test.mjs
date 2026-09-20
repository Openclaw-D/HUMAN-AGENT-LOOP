// BQA-R2 包01 · 上传授权与撤权隔离 · 真实PG测试
// 只读消费产品模块；唯一写入为本次创建并清理的 cnext_test_* 专用库（BQA_PG_*/CONNECTORS_TEST_PG_* 指定实例）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
// tests → auth-upload → results → backend-qa-r2 → v0.3 → docs → JW
const JW_ROOT = join(HERE, '..', '..', '..', '..', '..', '..');
const CONN = (p) => `file:///${join(JW_ROOT, 'Back/Connectors', p).replace(/\\/g, '/')}`;

const { makeUploadContextService } = await import(CONN('src/intake/upload-context.mjs'));
const { makeIntakeService } = await import(CONN('src/intake/service.mjs'));
const { makeBindingService } = await import(CONN('src/wecom/binding.mjs'));
const { createTestDatabase, dropTestDatabase, makeStore, migrate } = await import(CONN('src/store/pg.mjs'));
const { ConnError } = await import(CONN('src/errors.mjs'));

const BASE_PG = {
  host: '127.0.0.1',
  port: Number(process.env.CONNECTORS_TEST_PG_PORT ?? process.env.BQA_PG_PORT ?? 25443),
  user: process.env.CONNECTORS_TEST_PG_USER ?? process.env.BQA_PG_USER ?? 'cnext',
  password: process.env.CONNECTORS_TEST_PG_PASSWORD ?? process.env.BQA_PG_PASSWORD ?? 'cnext',
  database: process.env.CONNECTORS_TEST_PG_DATABASE ?? process.env.BQA_PG_DATABASE ?? 'cnext',
};

test('BQA setup: dedicated PostgreSQL reachable (blocked_env otherwise)', async t => {
  const probe = makeStore({ ...BASE_PG, connectionTimeoutMillis: 3000, max: 1 });
  try { await probe.query('SELECT 1'); }
  catch { t.skip('blocked_env: 专用测试PostgreSQL不可达；真实SQL与事务未验证'); return; }
  finally { await probe.close(); }
  assert.ok(true);
});

test('BQA real PG: exact join restores only proven owner; response carries no secrets', async t => {
  const cfg = await createTestDatabase(BASE_PG);
  assert.match(cfg.dbName, /^cnext_test_[a-z0-9]+_[a-z0-9]+$/);
  const store = makeStore(cfg);
  t.after(async () => { await store.close(); await dropTestDatabase(BASE_PG, cfg.dbName); });
  await migrate(store);
  const { bindings, intake } = harness(store);
  const seeded = await seedActive({ intake, bindings, tenant: 't-read', customer: 'c-read', principal: 'p-read' });
  const service = makeUploadContextService(store);
  const ctx = await service.read({ tenantId: 't-read', customerId: 'c-read', principalId: 'p-read' });
  assert.equal(ctx.available, true);
  assert.equal(ctx.bindingRef, seeded.bindingId);
  assert.equal(ctx.invitationId, seeded.invitationId);
  assert.deepEqual(ctx.allowedKinds, ['invoice', 'license']);
  assert.deepEqual(ctx.allowedObjects, ['equipment']);
  assert.equal(typeof ctx.expiresAt, 'string');
  for (const secret of ['provider', 'providerUserId', 'token', 'tokenHash', 'principal'])
    assert.equal(secret in ctx, false, `响应不得暴露 ${secret}`);
});

test('BQA real PG: cross tenant/customer/principal and external-provider binding never recover', async t => {
  const cfg = await createTestDatabase(BASE_PG);
  const store = makeStore(cfg);
  t.after(async () => { await store.close(); await dropTestDatabase(BASE_PG, cfg.dbName); });
  await migrate(store);
  const { bindings, intake } = harness(store);
  await seedActive({ intake, bindings, tenant: 't-x', customer: 'c-x', principal: 'p-x' });
  const service = makeUploadContextService(store);
  for (const patch of [{ tenantId: 't-other' }, { customerId: 'c-other' }, { principalId: 'p-other' },
    { tenantId: null }, { customerId: '' }, { principalId: undefined }])
    assert.equal((await service.read({ tenantId: 't-x', customerId: 'c-x', principalId: 'p-x', ...patch })).available, false);
  // 外部provider绑定（如wecom联系人）不是JW principal，单独存在时也不得恢复上传授权。
  const ext = await bindings.bind({ tenantId: 't-x2', provider: 'wecom', providerUserId: 'p-x', customerId: 'c-ext', verifiedBy: 'bqa-operator' });
  await bindings.setStatus({ tenantId: 't-x2', bindingId: ext.bindingId, status: 'active', actor: 'bqa-operator' });
  assert.equal((await service.read({ tenantId: 't-x2', customerId: 'c-ext', principalId: 'p-x' })).available, false);
});

test('BQA real PG: expired invitation, revoked binding and revoked invitation fail closed without renewal', async t => {
  const cfg = await createTestDatabase(BASE_PG);
  const store = makeStore(cfg);
  t.after(async () => { await store.close(); await dropTestDatabase(BASE_PG, cfg.dbName); });
  await migrate(store);
  const { bindings, intake } = harness(store);
  const service = makeUploadContextService(store);
  const read = (tenant) => service.read({ tenantId: tenant, customerId: 'c-life', principalId: 'p-life' });

  const a = await seedActive({ intake, bindings, tenant: 't-exp', customer: 'c-life', principal: 'p-life' });
  await store.query(`UPDATE intake_invitations SET expires_at = now() - interval '1 hour' WHERE invitation_id=$1`, [a.invitationId]);
  assert.equal((await read('t-exp')).reason, 'NO_ACTIVE_UPLOAD_BINDING');

  const b = await seedActive({ intake, bindings, tenant: 't-revb', customer: 'c-life', principal: 'p-life' });
  await bindings.setStatus({ tenantId: 't-revb', bindingId: b.bindingId, status: 'revoked', actor: 'bqa-operator' });
  assert.equal((await read('t-revb')).reason, 'NO_ACTIVE_UPLOAD_BINDING');
  // 撤销后不自动恢复：再读仍失败，且不产生任何新邀请/绑定。
  assert.equal((await read('t-revb')).reason, 'NO_ACTIVE_UPLOAD_BINDING');

  const c = await seedActive({ intake, bindings, tenant: 't-revi', customer: 'c-life', principal: 'p-life' });
  await intake.revokeInvitation({ tenantId: 't-revi', invitationId: c.invitationId, actor: 'bqa-operator' });
  assert.equal((await read('t-revi')).reason, 'NO_ACTIVE_UPLOAD_BINDING');
});

test('BQA real PG: multiple accepted invitations stay ambiguous — never guesses the newest', async t => {
  const cfg = await createTestDatabase(BASE_PG);
  const store = makeStore(cfg);
  t.after(async () => { await store.close(); await dropTestDatabase(BASE_PG, cfg.dbName); });
  await migrate(store);
  const { bindings, intake } = harness(store);
  await seedActive({ intake, bindings, tenant: 't-multi', customer: 'c-multi', principal: 'p-multi' });
  const issued2 = await intake.issueInvitation({ tenantId: 't-multi', customerId: 'c-multi', role: 'customer_contact',
    allowedEvidenceKinds: ['statement'], ttlSec: 600, createdBy: 'bqa-operator' });
  const accepted2 = await intake.acceptInvitation({ tenantId: 't-multi', token: issued2.token, provider: 'jw_principal', providerUserId: 'p-multi' });
  assert.equal(accepted2.existed, true, '第二个邀请应幂等挂接既有绑定');
  const service = makeUploadContextService(store);
  const ctx = await service.read({ tenantId: 't-multi', customerId: 'c-multi', principalId: 'p-multi' });
  assert.equal(ctx.available, false);
  assert.equal(ctx.reason, 'AMBIGUOUS_UPLOAD_BINDING');
  assert.equal(ctx.invitationId, null, '歧义时不得替身份挑选任一邀请');
});

test('BQA real PG: context reads are GET-only — tables byte-identical before/after the full read matrix', async t => {
  const cfg = await createTestDatabase(BASE_PG);
  const store = makeStore(cfg);
  t.after(async () => { await store.close(); await dropTestDatabase(BASE_PG, cfg.dbName); });
  await migrate(store);
  const { bindings, intake } = harness(store);
  const service = makeUploadContextService(store);
  await seedActive({ intake, bindings, tenant: 't-zero', customer: 'c-zero', principal: 'p-zero' });
  await seedActive({ intake, bindings, tenant: 't-zero2', customer: 'c-zero', principal: 'p-zero' });
  await store.query(`UPDATE intake_invitations SET expires_at = now() - interval '2 hour' WHERE tenant_id='t-zero2'`);

  const before = await snapshot(store);
  const scope = { tenantId: 't-zero', customerId: 'c-zero', principalId: 'p-zero' };
  assert.equal((await service.read(scope)).available, true);
  for (const patch of [{ tenantId: 'other' }, { customerId: 'other' }, { principalId: 'other' }])
    assert.equal((await service.read({ ...scope, ...patch })).available, false);
  assert.equal((await service.read({ tenantId: 't-zero2', customerId: 'c-zero', principalId: 'p-zero' })).available, false);
  await service.assertUpload({ ...scope, invitationId: 'no-such', kind: 'invoice' }).then(
    () => assert.fail('未知邀请必须拒绝'),
    e => { assert.ok(e instanceof ConnError); assert.equal(e.key, 'CUSTOMER_SCOPE_MISMATCH'); });
  const after = await snapshot(store);
  assert.equal(after, before, 'GET零写：读取前后 participant_bindings/intake_invitations/audit_log 完全一致');
});

test('BQA real PG: withAuthorizedUpload commits callback writes via tx and rolls back on callback failure', async t => {
  const cfg = await createTestDatabase(BASE_PG);
  const store = makeStore(cfg);
  t.after(async () => { await store.close(); await dropTestDatabase(BASE_PG, cfg.dbName); });
  await migrate(store);
  const { bindings, intake } = harness(store);
  const seeded = await seedActive({ intake, bindings, tenant: 't-tx', customer: 'c-tx', principal: 'p-tx',
    kinds: ['invoice'], objects: [] });
  const service = makeUploadContextService(store);
  const scope = { tenantId: 't-tx', customerId: 'c-tx', principalId: 'p-tx' };
  const input = { ...scope, invitationId: seeded.invitationId, kind: 'invoice', objectRefs: ['any-ref'] };

  // 正例：回调通过传入tx写探针行，提交后可见；回调收到可用上下文。
  const committed = await service.withAuthorizedUpload(input, async (tx, ctx) => {
    assert.equal(ctx.available, true);
    assert.equal(ctx.invitationId, seeded.invitationId);
    await tx.query(`INSERT INTO participant_bindings (binding_id, tenant_id, provider, provider_user_id, customer_id, status, verified_by)
      VALUES ('bqa-probe-commit', 't-tx', 'jw_principal', 'probe', 'c-tx', 'active', 'bqa')`);
    return ctx.invitationId;
  });
  assert.equal(committed, seeded.invitationId);
  assert.equal(((await store.query(`SELECT 1 FROM participant_bindings WHERE binding_id='bqa-probe-commit'`))).rows.length, 1);

  // 反例：回调先写后抛错 → 整个事务回滚，探针行不得残留。
  await assert.rejects(service.withAuthorizedUpload(input, async tx => {
    await tx.query(`INSERT INTO participant_bindings (binding_id, tenant_id, provider, provider_user_id, customer_id, status, verified_by)
      VALUES ('bqa-probe-rollback', 't-tx', 'jw_principal', 'probe-rollback', 'c-tx', 'active', 'bqa')`);
    throw new Error('bqa-intentional-callback-failure');
  }), /bqa-intentional-callback-failure/);
  assert.equal(((await store.query(`SELECT 1 FROM participant_bindings WHERE binding_id='bqa-probe-rollback'`))).rows.length, 0,
    '回滚后不得残留回调写入');
  assert.equal(((await store.query(`SELECT 1 FROM participant_bindings WHERE binding_id='bqa-probe-commit'`))).rows.length, 1,
    '已提交的合法写入不受后续回滚影响');
});

test('BQA real PG: revocation lock race — FOR SHARE serializes revoke behind commit; no retroactive cancel', async t => {
  const cfg = await createTestDatabase(BASE_PG);
  const store = makeStore(cfg);
  const store2 = makeStore(cfg); // 独立连接池=独立会话，用于并发撤销
  t.after(async () => { await store.close(); await store2.close(); await dropTestDatabase(BASE_PG, cfg.dbName); });
  await migrate(store);
  const { bindings, intake } = harness(store);
  const issued = await seedActive({ intake, bindings, tenant: 't-race', customer: 'c-race', principal: 'p-race',
    kinds: ['invoice'], objects: [] });
  const service = makeUploadContextService(store);
  const scope = { tenantId: 't-race', customerId: 'c-race', principalId: 'p-race' };
  const input = { ...scope, invitationId: issued.invitationId, kind: 'invoice', objectRefs: ['probe-obj'] };

  // 上传事务在回调中挂起，FOR SHARE 持锁；并发撤销必须被阻塞（55P03 lock_timeout）。
  let callbackStarted = false;
  let release;
  const gate = new Promise(r => { release = r; });
  const upload = service.withAuthorizedUpload(input, async tx => {
    await tx.query(`INSERT INTO participant_bindings (binding_id, tenant_id, provider, provider_user_id, customer_id, status, verified_by)
      VALUES ('bqa-probe-race', 't-race', 'jw_principal', 'probe', 'c-race', 'active', 'bqa')`);
    callbackStarted = true;
    await gate;
    return 'linearized-before-revocation';
  });
  for (let i = 0; i < 200 && !callbackStarted; i++) await new Promise(r => setTimeout(r, 25));
  assert.ok(callbackStarted, '回调应在撤销尝试前已持锁运行');
  await assert.rejects(store2.tx(async tx => {
    await tx.query(`SET LOCAL lock_timeout = '100ms'`);
    await tx.query(`UPDATE participant_bindings SET status='revoked' WHERE binding_id=$1`, [issued.bindingId]);
  }), e => e.code === '55P03', '上传持FOR SHARE期间撤销必须等待而非抢跑');

  release();
  assert.equal(await upload, 'linearized-before-revocation');

  // 线性化次序：上传先提交 → 合法写入保留，不被追溯撤销；撤销随后生效且只影响其后的请求。
  assert.equal(((await store.query(`SELECT 1 FROM participant_bindings WHERE binding_id='bqa-probe-race'`))).rows.length, 1,
    '先于撤销合法提交的写入不被追溯撤销');
  await bindings.setStatus({ tenantId: 't-race', bindingId: issued.bindingId, status: 'revoked', actor: 'bqa-operator' });
  assert.equal((await service.read(scope)).reason, 'NO_ACTIVE_UPLOAD_BINDING');
  let callbackRan = false;
  await assert.rejects(service.withAuthorizedUpload(input, () => { callbackRan = true; }),
    e => e instanceof ConnError && e.key === 'CUSTOMER_SCOPE_MISMATCH');
  assert.equal(callbackRan, false, '撤销后的上传回调不得运行');

  // 反向次序：先撤销后上传 → fail-closed，回调不运行。
  const second = await seedActive({ intake, bindings, tenant: 't-race2', customer: 'c-race', principal: 'p-race2',
    kinds: ['invoice'], objects: [] });
  await bindings.setStatus({ tenantId: 't-race2', bindingId: second.bindingId, status: 'revoked', actor: 'bqa-operator' });
  let ran2 = false;
  await assert.rejects(
    service.withAuthorizedUpload({ tenantId: 't-race2', customerId: 'c-race', principalId: 'p-race2',
      invitationId: second.invitationId, kind: 'invoice', objectRefs: [] }, () => { ran2 = true; }),
    e => e instanceof ConnError && e.key === 'CUSTOMER_SCOPE_MISMATCH');
  assert.equal(ran2, false);
});

test('BQA real PG: assertUpload enforces kind and object anchor on real SQL', async t => {
  const cfg = await createTestDatabase(BASE_PG);
  const store = makeStore(cfg);
  t.after(async () => { await store.close(); await dropTestDatabase(BASE_PG, cfg.dbName); });
  await migrate(store);
  const { bindings, intake } = harness(store);
  const issued = await seedActive({ intake, bindings, tenant: 't-scope', customer: 'c-scope', principal: 'p-scope',
    kinds: ['invoice'], objects: ['equipment'] });
  const service = makeUploadContextService(store);
  const base = { tenantId: 't-scope', customerId: 'c-scope', principalId: 'p-scope', invitationId: issued.invitationId };
  for (const patch of [{ kind: 'statement' }, { objectRefs: ['equipment', 'outside'] }, { objectRefs: [] },
    { invitationId: 'forged' }, { principalId: 'other' }])
    await assert.rejects(service.assertUpload({ ...base, kind: 'invoice', objectRefs: ['equipment'], ...patch }),
      e => e instanceof ConnError && e.key === 'CUSTOMER_SCOPE_MISMATCH');
  const ctx = await service.assertUpload({ ...base, kind: 'invoice', objectRefs: ['equipment'] });
  assert.equal(ctx.available, true);
});

// ---- 夹具与快照 ----

function harness(store) {
  const bindings = makeBindingService(store);
  return { bindings, intake: makeIntakeService(store, { bindings }) };
}

async function seedActive({ intake, bindings, tenant, customer, principal, kinds = ['invoice', 'license'], objects = ['equipment'] }) {
  const issued = await intake.issueInvitation({ tenantId: tenant, customerId: customer, role: 'customer_contact',
    allowedEvidenceKinds: kinds, objectRefs: objects, ttlSec: 600, createdBy: 'bqa-operator' });
  const accepted = await intake.acceptInvitation({ tenantId: tenant, token: issued.token, provider: 'jw_principal', providerUserId: principal });
  await intake.verifyBinding({ tenantId: tenant, bindingId: accepted.bindingId, verifiedBy: 'bqa-operator', evidenceRefs: ['synthetic-proof'] });
  return { invitationId: issued.invitationId, bindingId: accepted.bindingId };
}

async function snapshot(store) {
  const b = (await store.query(`SELECT * FROM participant_bindings ORDER BY binding_id`)).rows;
  const i = (await store.query(`SELECT * FROM intake_invitations ORDER BY invitation_id`)).rows;
  const a = (await store.query(`SELECT * FROM audit_log ORDER BY 1`)).rows;
  return JSON.stringify([b, i, a]);
}
