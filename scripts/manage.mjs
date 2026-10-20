import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, openSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), runDir = resolve(root, '.run');
const recordPath = resolve(runDir, 'server.json'), entry = resolve(root, 'Back/src/server.mjs');
const port = Number(process.env.DECISION_PORT ?? 48431), op = process.argv[2] ?? 'start';
const pause = ms => new Promise(r => setTimeout(r, ms));
const busy = p => new Promise(r => { const s = net.connect({ host:'127.0.0.1', port:p }); const done = n => { s.destroy(); r(n); }; s.once('connect',()=>done(true)); s.once('error',()=>done(false)); s.setTimeout(500,()=>done(false)); });
async function health(p) { const r = await fetch(`http://127.0.0.1:${p}/healthz`, { signal:AbortSignal.timeout(1500) }); const j = await r.json(); if (!r.ok || j.service !== 'human-decision-simulator' || !j.ok) throw new Error('Service identity mismatch'); return j; }
function record() { return existsSync(recordPath) ? JSON.parse(readFileSync(recordPath, 'utf8')) : null; }
function matches(rec) { try { const args = readFileSync(`/proc/${rec.pid}/cmdline`, 'utf8').split('\0'); return Number.isInteger(rec.pid) && args.includes(entry) && args.includes(rec.marker); } catch { return false; } }
mkdirSync(runDir, { recursive:true });
if (op === 'stop') {
  const rec = record();
  if (rec && matches(rec)) {
    process.kill(rec.pid, 'SIGTERM');
    for (let i=0;i<50 && await busy(rec.port);i++) await pause(100);
    if (await busy(rec.port)) throw new Error('Owned service did not stop; no force kill attempted');
    rmSync(recordPath, { force:true }); console.log('Owned service stopped; discussion and decision records preserved.');
  } else if (rec && !await busy(rec.port)) { rmSync(recordPath, { force:true }); console.log('Only stale process record removed.'); }
  else if (rec) throw new Error('Process identity cannot be verified; preserving it');
  else console.log('No owned service record.');
} else if (op === 'status') console.log(JSON.stringify(await health(port),null,2));
else if (op === 'start') {
  if (await busy(port)) {
    const rec = record(); if (!rec || rec.port !== port || !matches(rec)) throw new Error('Port occupied by an unverified listener; preserving it');
    await health(port); console.log('Reusing owned healthy decision simulator.');
  } else {
    const marker = randomUUID(), fd = openSync(resolve(runDir,'server.log'),'a');
    const child = spawn(process.execPath,[entry,'--marker',marker],{cwd:root,env:{...process.env,DECISION_PORT:String(port)},detached:true,stdio:['ignore',fd,fd]}); child.unref();
    let ready=false;
    for (let i=0;i<60;i++) { try { await health(port); ready=true; break; } catch {} await pause(200); }
    if (!ready) { try { child.kill('SIGTERM'); } catch {} throw new Error('Started child failed readiness; inspect .run/server.log'); }
    writeFileSync(recordPath,JSON.stringify({pid:child.pid,port,marker,service:'human-decision-simulator'},null,2));
    console.log(`Decision simulator ready on internal port ${port}.`);
  }
} else throw new Error('Use start, status, or stop');
