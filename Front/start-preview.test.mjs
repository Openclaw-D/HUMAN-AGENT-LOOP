import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';

const script=fileURLToPath(new URL('./start-preview.mjs',import.meta.url));
test('bundled frontend serves locally without Vite, isolates files, and respects occupied ports',async()=>{
 const child=spawn(process.execPath,[script,'--port=0','--no-open'],{stdio:['ignore','pipe','pipe'],windowsHide:true});
 try{
  const url=await new Promise((resolve,reject)=>{
   let output='';
   const timer=setTimeout(()=>reject(new Error('Preview startup timeout')),10000);
   child.on('error',e=>{clearTimeout(timer);reject(e);});
   child.on('exit',code=>{clearTimeout(timer);reject(new Error('Preview exited: '+code));});
   child.stdout.on('data',data=>{output+=data;const m=output.match(/http:\/\/127\.0\.0\.1:\d+\//);if(m){clearTimeout(timer);resolve(m[0]);}});
  });
  const home=await fetch(url);assert.equal(home.status,200);
  const html=await home.text();assert.match(html,/id="root"/);
  const assets=[...html.matchAll(/(?:src|href)="(\/assets\/[^" ]+)"/g)].map(m=>m[1]);
  assert.ok(assets.some(a=>a.endsWith('.js')));assert.ok(assets.some(a=>a.endsWith('.css')));
  for(const asset of assets){const r=await fetch(new URL(asset,url));assert.equal(r.status,200);assert.ok((await r.arrayBuffer()).byteLength>0);}
  const health=await (await fetch(new URL('/__jw_preview_health',url))).json();assert.equal(health.backendConnected,false);
  assert.equal((await fetch(new URL('/missing-file',url))).status,404);
  assert.equal((await fetch(new URL('/index.html',url),{method:'POST'})).status,405);
  assert.equal((await fetch(new URL('/..%2f..%2fDECISIONS.md',url))).status,403);
  assert.equal((await fetch(new URL('/%5c..%5cDECISIONS.md',url))).status,400);
  const head=await fetch(url,{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
  const conflicting=spawn(process.execPath,[script,'--port='+new URL(url).port,'--no-open'],{stdio:'ignore',windowsHide:true});
  const [exitCode]=await once(conflicting,'exit');assert.equal(exitCode,1);
  assert.equal((await fetch(url)).status,200);
 }finally{if(child.exitCode===null){child.kill();await once(child,'exit');}}
});
