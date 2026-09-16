import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.V5_PREVIEW_DATA_DIR = mkdtempSync(join(tmpdir(), 'codex-v6-review-'));
const svc = await import('../../jianwei-v3/site/lib/v5-preview/service.ts');
const store = await import('../../jianwei-v3/site/lib/v5-preview/store.ts');
const initial = svc.getProjectOverview();
assert.throws(() => svc.postMessage({requestId:'stale',expectedVersion:0,text:'合成验收',actorRole:'business'}), e => e.code === 'VERSION_CONFLICT');
assert.equal(svc.getProjectOverview().version, initial.version);
const body = {requestId:'lost',expectedVersion:initial.version,text:'合成验收',actorRole:'business'};
const first = svc.postMessage(body);
svc.postMessage({...body,requestId:'newer',expectedVersion:first.overview.version,text:'后续合成消息'});
assert.equal(svc.postMessage(body).replayed, true);
assert.equal(svc.getProjectOverview().version, initial.version + 2);
svc.seedScenario({scenario:'post-rental'});
svc.seedScenario({scenario:'approval'});
assert.throws(() => svc.postMessage({...body,requestId:'old-batch'}), e => e.code === 'VERSION_CONFLICT');
const file = store.getV5PreviewStoreFilePath();
const valid = readFileSync(file, 'utf8');
for (const corrupt of [s => {s.overview.domains = [null,null,null,null];}, s => {s.idempotency=[{requestId:'bad',hash:'x',response:{ok:true}}];}]) {
  const data=JSON.parse(valid); corrupt(data); const raw=JSON.stringify(data); writeFileSync(file,raw);
  assert.throws(() => svc.getProjectOverview(),e=>e.code==='STORE_CORRUPT');
  assert.equal(readFileSync(file,'utf8'),raw);
}
console.log(JSON.stringify({passed:true,checks:['stale message rejected without write','original payload replay after newer write','scenario version isolation','null domains rejected unchanged','bad replay response rejected unchanged'],dataDir:process.env.V5_PREVIEW_DATA_DIR},null,2));
