import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const data = fileURLToPath(new URL('./probe-data/', import.meta.url));
process.env.V5_PREVIEW_DATA_DIR = data;
mkdirSync(data, { recursive: true });
const svc = await import('../../../../jianwei-v3/site/lib/v5-preview/service.ts');
const store = await import('../../../../jianwei-v3/site/lib/v5-preview/store.ts');
const results = [];
function fresh() { store.writeV5StoreState({overview:svc.createSeedOverview('approval'),idempotency:new store.V5IdempotencyTable()}); }
fresh();
const note={requestId:'review-note',expectedVersion:7,todoId:'todo-device-list',text:'独立验收合成说明',actorRole:'business'};
const n=svc.submitNote(note);
results.push({check:'补充说明保存及黄灯待复核',version:n.overview.version,status:n.overview.todo.status,lamp:n.overview.domains[1].judgmentStatus});
results.push({check:'重复提交不重复写入',replayed:svc.submitNote(note).replayed,version:svc.getProjectOverview().version});
try {svc.submitNote({...note,requestId:'stale-note'}); results.push({check:'旧版本补充说明',accepted:true});}catch(e){results.push({check:'旧版本补充说明',error:e.code});}
try {const r=svc.postMessage({requestId:'stale-message',expectedVersion:0,text:'旧版本沟通',actorRole:'business'});results.push({check:'旧版本沟通应拒绝',accepted:true,version:r.overview.version});}catch(e){results.push({check:'旧版本沟通应拒绝',error:e.code});}
fresh();
const original=svc.getProjectOverview();
svc.postMessage({requestId:'lost-response',expectedVersion:7,text:'丢失响应后重试',actorRole:'business'});
try {svc.postMessage({requestId:'lost-response',expectedVersion:8,text:'丢失响应后重试',actorRole:'business'});results.push({check:'模拟前端轮询后重试',accepted:true});}catch(e){results.push({check:'模拟前端轮询后重试',error:e.code});}
const f=store.getV5PreviewStoreFilePath();
writeFileSync(f,JSON.stringify({schema:store.V5_STORE_SCHEMA,overview:{projectId:'JW-2026-018',version:7,domains:[null,null,null,null]},idempotency:[]}));
try{results.push({check:'结构损坏应拒绝',accepted:true,value:svc.getProjectOverview()});}catch(e){results.push({check:'结构损坏应拒绝',error:e.code});}
fresh();
svc.seedScenario({scenario:'post-rental'});
svc.seedScenario({scenario:'approval'});
try{const r=svc.submitNote({...note,requestId:'before-reset',expectedVersion:original.version});results.push({check:'情景重置后旧版本请求',accepted:true,version:r.overview.version});}catch(e){results.push({check:'情景重置后旧版本请求',error:e.code});}
writeFileSync(fileURLToPath(new URL('./probe-results.json',import.meta.url)),JSON.stringify(results,null,2));
console.log(JSON.stringify(results,null,2));
