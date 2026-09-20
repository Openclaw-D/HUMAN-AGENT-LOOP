import test from 'node:test';
import assert from 'node:assert/strict';
import { BASE_PG, pgAvailable } from './helpers.mjs';
import { createTestDatabase, dropTestDatabase, makeStore, migrate } from '../src/store/pg.mjs';
import { makeBindingService } from '../src/wecom/binding.mjs';
import { makeIntakeService } from '../src/intake/service.mjs';
import { makeUploadContextService } from '../src/intake/upload-context.mjs';

test('isolated PostgreSQL: exact join and upload lock serialize revocation', async t => {
  if (!await pgAvailable()) { t.skip('blocked_env: dedicated test PostgreSQL unavailable; transaction race NOT verified'); return; }
  const config = await createTestDatabase(BASE_PG);
  assert.match(config.dbName, /^cnext_test_[a-z0-9]+_[a-z0-9]+$/);
  const store = makeStore(config);
  t.after(async () => { await store.close(); await dropTestDatabase(BASE_PG, config.dbName); });
  await migrate(store);
  const bindings = makeBindingService(store), intake = makeIntakeService(store, { bindings });
  const issued = await intake.issueInvitation({ tenantId:'t',customerId:'c',role:'customer_contact',allowedEvidenceKinds:['invoice'],ttlSec:600,createdBy:'operator' });
  const accepted = await intake.acceptInvitation({tenantId:'t',token:issued.token,provider:'jw_principal',providerUserId:'p'});
  await intake.verifyBinding({tenantId:'t',bindingId:accepted.bindingId,verifiedBy:'operator',evidenceRefs:['synthetic-proof']});
  const service = makeUploadContextService(store), scope = {tenantId:'t',customerId:'c',principalId:'p'};
  assert.equal((await service.read(scope)).available,true);
  const input = {...scope,invitationId:issued.invitationId,kind:'invoice'};
  await service.withAuthorizedUpload(input, async () => {
    await assert.rejects(store.tx(async tx => {
      await tx.query("SET LOCAL lock_timeout = '100ms'");
      await tx.query("UPDATE participant_bindings SET status='revoked' WHERE binding_id=$1",[accepted.bindingId]);
    }), error => error.code === '55P03');
  });
  await bindings.setStatus({tenantId:'t',bindingId:accepted.bindingId,status:'revoked',actor:'operator'});
  await assert.rejects(service.withAuthorizedUpload(input, () => assert.fail('revoked upload callback must not run')));
});
