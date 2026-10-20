import assert from 'node:assert/strict';
const base = `http://127.0.0.1:${Number(process.env.DECISION_PORT ?? 48431)}`;
const health = await fetch(base + '/healthz').then(r => r.json());
assert.equal(health.ok,true); assert.equal(health.assistantMode,'simulated');
assert.equal((await fetch(base+'/api/cases')).status,401);
const session = await fetch(base+'/api/session',{method:'POST',headers:{Origin:base,'content-type':'application/json'},body:JSON.stringify({role:'observer',displayName:'就绪检查'})});
assert.equal(session.status,200);
const cookie = session.headers.get('set-cookie').split(';')[0];
const list = await fetch(base+'/api/cases',{headers:{Cookie:cookie}}).then(r=>r.json());
assert.equal(list.cases.length,3);
for(const c of list.cases){
  const res = await fetch(base+'/api/cases/'+c.id,{headers:{Cookie:cookie}});
  assert.equal(res.status,200); const state=(await res.json()).case;
  assert.equal(state.sourceMode,'synthetic'); assert.equal(state.candidates.length,4);
}
const page = await fetch(base); assert.equal(page.status,200); const html=await page.text();
assert.match(html,/id="root"/);
for(const src of [...html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)].map(m=>m[1])) assert.equal((await fetch(base+src)).status,200);
const notices = await fetch(base+'/THIRD_PARTY_NOTICES.txt'); assert.equal(notices.status,200); assert.match(await notices.text(),/MIT License/);
console.log('Readiness verified: three synthetic scenarios, four alternatives each, session authorization, built assets and third-party notices.');
