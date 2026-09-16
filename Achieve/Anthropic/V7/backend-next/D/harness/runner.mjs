// D路测试runner：超时、断言计数、异常非零退出、SKIP/BLOCKED留门。零依赖。
// 语义：任一FAIL→退出1；runner级异常→退出2；总断言=0→退出3；全过→0。
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { makeAssert } from './assert.mjs';
import { makeHttp, verbs } from './http.mjs';
import * as procM from './proc.mjs';
import { marker } from './leakscan.mjs';

const EXIT = { OK: 0, HAS_FAIL: 1, RUNNER_ERROR: 2, ZERO_ASSERT: 3 };

export function defineSuite(name, tests) { return { name, tests }; }

export async function runSuite(suite, importMetaUrl) {
  const runDir = process.env.D_RUN_DIR || path.join(path.dirname(importMetaUrl ? new URL(importMetaUrl).pathname.replace(/^\/([A-Za-z]:)/, '$1') : '.'), '..', 'evidence', 'adhoc');
  mkdirSync(runDir, { recursive: true });
  const only = (process.env.D_ONLY || '').split(',').map(s => s.trim()).filter(Boolean);
  const logPath = path.join(runDir, `${suite.name}.log`);
  const log = (line) => { const l = `[${new Date().toISOString()}] ${line}`; console.log(l); appendFileSync(logPath, l + '\n'); };

  procM.installExitCleanup();
  const results = [];
  const ctxShared = { cfg: loadCfg(), runDir, log };
  let totalAssertions = 0;
  let runnerError = null;

  const selected = only.length ? suite.tests.filter(t => only.includes(t.id)) : suite.tests;
  if (only.length && !selected.length) { log(`[filter] D_ONLY=${process.env.D_ONLY} 不匹配任何测试ID（套件${suite.name}），跳过本套件`); }

  for (const t of selected) {
    const rec = { id: t.id, title: t.title, severity: t.severity || 'P1', owner: t.owner || '?', state: 'fail', assertions: 0, failures: [], ms: 0, note: '' };
    const t0 = Date.now();
    if (t.skipIf && t.skipIf(ctxShared)) { rec.state = 'skip'; rec.note = t.skipReason || 'precondition missing'; results.push(rec); log(`[SKIP] ${t.id} ${rec.note}`); continue; }
    const a = makeAssert(t.id);
    const ctx = {
      ...ctxShared,
      assert: a,
      marker: (p) => marker(p || 'DLEAK'),
      http: (base, o) => verbs(makeHttp(base, o)),
      proc: procM,
      sleep: (ms) => new Promise(r => setTimeout(r, ms)),
      store: (ctxShared.store ||= {}),
      blocked: (reason) => { throw new Error(`BLOCKED: ${reason}`); },
    };
    try {
      await Promise.race([
        Promise.resolve().then(() => t.fn(ctx)),
        new Promise((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT after ${t.timeoutMs || 120000}ms`)), t.timeoutMs || 120000)),
      ]);
      rec.assertions = a.count();
      rec.failures = a.failures;
      if (rec.assertions === 0) { rec.state = 'fail'; rec.note = '0 assertions executed（不允许零断言PASS）'; }
      else if (a.failures.length) { rec.state = 'fail'; }
      else { rec.state = 'pass'; }
    } catch (e) {
      rec.assertions = a.count();
      const msg = String((e && e.message) || e);
      if (/^BLOCKED:/.test(msg)) {
        rec.state = 'blocked'; rec.note = msg.slice(0, 300);
        rec.failures = a.failures;
      } else {
        rec.failures = [...a.failures, { msg: msg === `TIMEOUT after ${t.timeoutMs || 120000}ms` ? 'timeout' : 'exception', detail: String((e && (e.stack || e.message)) || e).slice(0, 1500) }];
        rec.state = 'fail';
        rec.note = /TIMEOUT/.test(msg) ? 'timeout' : 'exception';
      }
    } finally {
      rec.ms = Date.now() - t0;
      totalAssertions += rec.assertions;
    }
    results.push(rec);
    log(`[${rec.state.toUpperCase()}] ${t.id} ${t.title} assertions=${rec.assertions} ms=${rec.ms}${rec.note ? ' note=' + rec.note : ''}`);
    for (const f of rec.failures) log(`    └ ${f.msg}${f.detail ? ' :: ' + f.detail : ''}`);
  }

  // 汇总
  const summary = {
    suite: suite.name, results,
    pass: results.filter(r => r.state === 'pass').length,
    fail: results.filter(r => r.state === 'fail').length,
    skip: results.filter(r => r.state === 'skip').length,
    blocked: results.filter(r => r.state === 'blocked').length,
    totalAssertions, runnerError,
  };
  writeFileSync(path.join(runDir, `${suite.name}.result.json`), JSON.stringify(summary, null, 2));
  const fails = results.filter(r => r.state === 'fail');
  log(`[SUITE-END] ${suite.name} pass=${summary.pass} fail=${summary.fail} skip=${summary.skip} assertions=${totalAssertions}`);
  try { await procM.stopAllOwn(); } catch { }
  if (runnerError) process.exit(EXIT.RUNNER_ERROR);
  if (fails.length) process.exit(EXIT.HAS_FAIL);
  if (totalAssertions === 0 && selected.length > 0) process.exit(EXIT.ZERO_ASSERT);
  process.exit(EXIT.OK);
}

export function loadCfg() {
  // D/config/sut.json — A发布后填写；缺失时套件用 skipIf 判定
  try {
    const p = new URL('../config/sut.json', import.meta.url);
    // eslint-disable-next-line no-undef
    return JSON.parse(readFileSyncSync(p));
  } catch { return null; }
}
import { readFileSync } from 'node:fs';
function readFileSyncSync(p) { return readFileSync(p, 'utf8'); }
