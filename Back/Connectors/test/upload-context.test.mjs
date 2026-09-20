import test from 'node:test';
import assert from 'node:assert/strict';
import { makeUploadContextService, delegatedUploadPrincipal } from '../src/intake/upload-context.mjs';

test('only explicit tenant-limited delegation can supply a JW principal', () => {
  const input = { callerBindings:[{token:'test-only',mayDelegateActor:true,tenantIds:['t']}], serviceToken:'test-only',tenantId:'t',actorPrincipal:'p' };
  assert.equal(delegatedUploadPrincipal(input),'p');
  for (const patch of [{callerBindings:null}, {serviceToken:'ordinary'}, {tenantId:'other'}, {actorPrincipal:''},
    {callerBindings:[{token:'test-only',mayDelegateActor:false,tenantIds:['t']}]}, {callerBindings:[{token:'test-only',mayDelegateActor:true}]}])
    assert.throws(() => delegatedUploadPrincipal({...input,...patch}));
});

function fixture() {
  const record = { tenant: 't', customer: 'c', provider: 'jw_principal', principal: 'p', binding_id: 'opaque-b',
    binding_status: 'active', invitation_id: 'opaque-i', invitation_status: 'accepted',
    allowed_evidence_kinds: ['invoice'], object_refs: ['equipment'], expires_at: '2030-01-01T00:00:00Z' };
  const state = { rows: [record], queries: [], writes: 0 };
  const store = { async query(sql, args) {
    assert.match(sql.trim(), /^SELECT/); state.queries.push(sql);
    return { rows: state.rows.filter(r => [r.tenant,r.customer,r.provider,r.principal].every((v,i) => v === args[i])) };
  }, async tx(fn) { return fn(store); } };
  const input = { tenantId: 't', customerId: 'c', principalId: 'p' };
  return { state, record, store, input, service: makeUploadContextService(store, { now: () => Date.parse('2026-09-21') }) };
}
test('refresh/reopen restores only proven owner; read is SELECT-only and excludes secrets', async () => {
  const f = fixture(); const first = await f.service.read(f.input);
  assert.equal(first.available, true);
  assert.deepEqual(await f.service.read(f.input), first);
  assert.deepEqual(await makeUploadContextService(f.store).read(f.input), first);
  for (const field of ['provider', 'providerUserId', 'principal', 'token', 'tenant']) assert.equal(field in first, false);
});
test('different tenant, customer, principal, missing identity and external bindings cannot recover', async () => {
  const f = fixture();
  for (const key of ['tenantId', 'customerId', 'principalId']) {
    for (const value of ['other', null]) assert.equal((await f.service.read({ ...f.input, [key]: value })).available, false);
  }
  f.record.provider = 'wecom'; assert.equal((await f.service.read(f.input)).available, false);
});
test('revoked/candidate/expired/multiple invitations and invalid scope fail closed without renewal', async () => {
  const f = fixture();
  for (const [key, value] of [['binding_status','revoked'],['binding_status','candidate'],['invitation_status','revoked'],['expires_at','2020-01-01'],['expires_at','invalid'],['allowed_evidence_kinds',[]],['object_refs',null]]) {
    const original = f.record[key]; f.record[key] = value;
    assert.equal((await f.service.read(f.input)).available, false); f.record[key] = original;
  }
  f.state.rows.push({ ...f.record, invitation_id: 'second' });
  assert.equal((await f.service.read(f.input)).reason, 'AMBIGUOUS_UPLOAD_BINDING');
});
test('upload rechecks current owner, invitation, binding, kind and every object in locked transaction', async () => {
  const f = fixture(); const input = { ...f.input, invitationId:'opaque-i', bindingRef:'opaque-b', kind:'invoice', objectRefs:['equipment'] };
  await f.service.withAuthorizedUpload(input, async (tx, context) => { assert.equal(tx, f.store); assert.equal(context.available,true); f.state.writes++; });
  assert.match(f.state.queries.at(-1), /FOR SHARE OF b, i/);
  for (const patch of [{invitationId:'other'}, {bindingRef:'other'}, {kind:'other'}, {objectRefs:[]}, {objectRefs:['equipment','other']}, {principalId:'other'}])
    await assert.rejects(f.service.withAuthorizedUpload({...input,...patch}, () => f.state.writes++));
  await f.service.read(f.input); f.record.binding_status = 'revoked';
  await assert.rejects(f.service.withAuthorizedUpload(input, () => f.state.writes++));
  assert.equal(f.state.writes,1);
});
