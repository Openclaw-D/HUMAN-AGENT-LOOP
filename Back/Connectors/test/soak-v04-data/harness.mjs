// soak-v04-data · 共享设施（本包独占）：配置、可复现随机、fixtures、本地可计数 A 替身、
// 不变量检查、事件/指标 JSONL（轮转）。真实外部出站=0：A 用本地替身；企微用 FakeWecomTransport。
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdirSync, appendFileSync, statSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256Hex } from '../../src/ids.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(__dirname, '../../../..');

export function soakConfig() {
  const runDir = process.env.SOAK04_RUN_DIR ?? join(REPO_ROOT, '.local', 'soak-v04-data');
  return {
    runDir,
    objectRoot: join(runDir, 'objects'),
    pg: {
      host: '127.0.0.1',
      port: Number(process.env.SOAK04_PG_PORT ?? 25511),
      user: process.env.SOAK04_PG_USER ?? 'soak04',
      password: process.env.SOAK04_PG_PASSWORD ?? 'soak04',
      database: process.env.SOAK04_PG_DATABASE ?? 'cnext',
    },
    tenantId: 'tenant_soak04',
    signingSecret: 'soak04_signing_secret',
    serviceToken: 'soak04_service_token',
    container: process.env.SOAK04_DOCKER_CONTAINER ?? 'jw-v04soak-data-pg',
    scale: Math.max(0.0005, Number(process.env.SOAK04_SCALE ?? 1)),
    aCredentials: { service: 'svc-soak04', registrar: 'reg-soak04', uploadFallback: 'upl-soak04' },
    // 材料元数据总量上限（04_DATA.md：长历史最多1000材料元数据）；全跑合计≤1000（含负例/重复）
    materialCap: 1000,
  };
}

// ---------- 可复现随机 ----------
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const pick = (rng, arr) => arr[Math.floor(rng() * arr.length) % arr.length];

// ---------- JSONL 事件/指标（5MB 轮转，保留3代） ----------
export function makeJsonlWriter(dir, base) {
  mkdirSync(dir, { recursive: true });
  let n = 0;
  const cur = () => join(dir, `${base}${n > 0 ? `-${n}` : ''}.jsonl`);
  function rotateIfNeeded() {
    const p = cur();
    try {
      if (existsSync(p) && statSync(p).size > 5 * 1024 * 1024) {
        const oldest = join(dir, `${base}-${(n + 2) % 3 === 0 ? 2 : (n + 2) % 3}.jsonl`);
        if (n >= 2) { try { rmSync(join(dir, `${base}-${(n + 1) % 3}.jsonl`)); } catch { /* 首代不存在 */ } }
        n += 1;
      }
    } catch { /* 统计失败不阻断写入 */ }
  }
  return {
    write(obj) {
      try { rotateIfNeeded(); appendFileSync(cur(), JSON.stringify(obj) + '\n'); } catch { /* 日志失败不阻断主流程 */ }
    },
  };
}

// ---------- fixtures（静态安全；恶意=结构敌意，无可执行载荷） ----------
export function bankCsvVariate(rng, { year = 2026 } = {}) {
  const rows = [];
  let bal = 80000 + Math.floor(rng() * 20000);
  const day = () => String(1 + Math.floor(rng() * 27)).padStart(2, '0');
  for (let i = 0; i < 6; i++) {
    const inflow = rng() < 0.5 ? String(1000 + Math.floor(rng() * 50000)) : '0';
    const outflow = inflow === '0' ? String(100 + Math.floor(rng() * 3000)) : '0';
    bal = bal + Number(inflow) - Number(outflow);
    rows.push([`${year}-0${1 + (i % 2)}-${day()}`, inflow, outflow, String(bal), `交易${i}-u${Math.floor(rng() * 1e9).toString(36)}`]);
  }
  return Buffer.from(['交易日期,收入,支出,余额,摘要', ...rows.map((r) => r.join(','))].join('\n'), 'utf8');
}
export function declCsvVariate(rng, fields) {
  const keys = fields ?? { monthly_operating_cash_flow: String(30000 + Math.floor(rng() * 40000)), monthly_debt_service: String(5000 + Math.floor(rng() * 20000)) };
  const lines = ['key,value,unit,caliber', `token,u${Math.floor(rng() * 1e9).toString(36)},, synthetic`];
  for (const [k, v] of Object.entries(keys)) lines.push(`${k},${v},元,权责发生`);
  return Buffer.from(lines.join('\n'), 'utf8');
}
export function declTxtVariate(rng) {
  return Buffer.from([
    `token = u${Math.floor(rng() * 1e9).toString(36)}`,
    `equipment_model = LX-${100 + Math.floor(rng() * 900)}`,
    'equipment_ownership_verified = yes',
  ].join('\n'), 'utf8');
}
export function emptyBytes() { return Buffer.alloc(0); }
export function fakePdfBytes() { return Buffer.from('%PDF-1.4\n%%EOF\n', 'utf8'); }
export function truncatedCsvBytes(rng) {
  const full = bankCsvVariate(rng).toString('utf8').split('\n');
  const cut = full.slice(0, 2 + Math.floor(rng() * 2)).join('\n'); // 截掉后半含部分行
  return Buffer.from(cut + `\n${cut.split(',')[0]},100`, 'utf8'); // 末行缺列
}
export function garbageBinaryBytes(rng) {
  const buf = Buffer.alloc(256 + Math.floor(rng() * 512));
  for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(rng() * 256);
  // 避免偶发文本/PDF/ZIP魔数：强写非法头
  buf[0] = 0xd8; buf[1] = 0x9d; buf[2] = 0x00; buf[3] = 0x7f;
  return buf;
}
/** 敌意 ZIP：静态构造，含 ../ 穿越条目名（zipguard 应拒绝）；内容均为无害文本。 */
export function hostileZipBytes() {
  const entries = [{ name: '../escape.txt', data: Buffer.from('harmless text, hostile path\n', 'utf8') }];
  const locals = []; const centrals = []; let offset = 0;
  const crcTable = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 8; t[n] = c; } return t; })();
  const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  for (const { name, data } of entries) {
    const nb = Buffer.from(name, 'utf8'); const crc = crc32(data);
    const l = Buffer.alloc(30); l.writeUInt32LE(0x04034b50, 0); l.writeUInt16LE(20, 4); l.writeUInt32LE(crc, 14); l.writeUInt32LE(data.length, 18); l.writeUInt32LE(data.length, 22); l.writeUInt16LE(nb.length, 26);
    locals.push(l, nb, data);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(nb.length, 28); c.writeUInt32LE(offset, 42);
    centrals.push(c, nb);
    offset += 30 + nb.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10); eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}
/** 受限大小：接近 1MB 的声明文本（上限内）；parse_results 文本截断口（maxStoredTextBytes=64KB）。 */
export function largeDeclBytes(rng) {
  const pad = 'x'.repeat(40);
  const lines = [`token = u${Math.floor(rng() * 1e9).toString(36)}`, 'equipment_model = LX-500'];
  while (Buffer.byteLength(lines.join('\n'), 'utf8') < 900 * 1024) lines.push(`note_${lines.length} = ${pad}`);
  return Buffer.from(lines.join('\n'), 'utf8');
}

// ---------- 本地可计数 A 替身（零真实出站） ----------
const A_PATHS_OK = ['/api/v2/receipts'];
export async function createAStandin({ tenantId, credentials, logWriter }) {
  const state = {
    mode: 'normal',              // normal|slow|down|err500
    receipts: new Map(),         // requestId → {principal, response}
    artifacts: new Map(),        // dedupeKey → {artifactId, requestId}
    counters: { requests: 0, executed: 0, replays: 0, errors: 0, byStatus: {}, registerDistinctReq: new Set(), registerArtifacts: new Set() },
    log: [],                     // 截断保留；全量进 logWriter
  };
  const credSet = new Set([credentials.service, credentials.registrar, credentials.uploadFallback]);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const h16 = (o) => createHash('sha256').update(JSON.stringify(o)).digest('hex').slice(0, 16);

  function record(entry) {
    state.counters.requests += 1;
    state.log.push(entry);
    if (state.log.length > 2000) state.log.splice(0, 1000);
    logWriter?.write({ t: new Date().toISOString(), kind: 'a-standin', ...entry });
  }
  function finish(res, status, body, entry) {
    state.counters.byStatus[status] = (state.counters.byStatus[status] ?? 0) + 1;
    if (status >= 500 || status === 401) state.counters.errors += 1;
    record({ ...entry, status, replay: body?._replay === true });
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  }
  /** 幂等执行：同 requestId 已有回执 → 原样回放（零二次业务效果，计 replay）。 */
  async function idempotent(req, res, credential, build, entry) {
    const requestId = req.headers['x-request-id'] ?? null;
    if (requestId && state.receipts.has(requestId)) {
      state.counters.replays += 1;
      const stored = state.receipts.get(requestId);
      const body = stored.principal === credential ? { ...stored.response, _replay: true } : { ok: false, error: 'RECEIPT_SCOPE_MISMATCH' };
      return finish(res, 200, body, { ...entry, requestId });
    }
    const body = await build();
    if (requestId) state.receipts.set(requestId, { principal: credential, response: body });
    state.counters.executed += 1;
    return finish(res, 200, body, { ...entry, requestId });
  }

  const server = createServer(async (req, res) => {
    const entry = { m: req.method, p: req.url, mode: state.mode, at: new Date().toISOString() };
    const credential = req.headers['x-principal-credential'] ?? '';
    if (state.mode === 'down') { req.destroy(); state.counters.errors += 1; record({ ...entry, status: 'destroyed' }); return; }
    if (state.mode === 'slow') await sleep(7000); // > coordinator aTimeoutMs(5000)：制造“已处理但响应未知”
    if (state.mode === 'err500') return finish(res, 500, { ok: false, error: 'STANDIN_500' }, entry);
    if (!credSet.has(credential)) return finish(res, 401, { ok: false, error: 'UNAUTHORIZED' }, entry);

    const url = new URL(req.url, 'http://127.0.0.1');
    const p = url.pathname;
    let m;
    if (req.method === 'GET' && (m = p.match(/^\/api\/v2\/receipts\/(.+)$/))) {
      const requestId = decodeURIComponent(m[1]);
      const rc = state.receipts.get(requestId);
      if (!rc || rc.principal !== credential) {
        record({ ...entry, status: 200, found: false });
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: true, found: false, requestId }));
      }
      record({ ...entry, status: 200, found: true });
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, found: true, requestId, receipt: { requestId, response: rc.response } }));
    }
    if (req.method === 'GET' && (m = p.match(/^\/api\/v2\/customers\/([^/]+)$/))) {
      return finish(res, 200, { ok: true, customer: { customerId: decodeURIComponent(m[1]), tenantId, legalEntityRef: null, displayName: 'soak04 standin' } }, entry);
    }
    if (req.method === 'POST' && (m = p.match(/^\/api\/v2\/customers\/([^/]+)\/artifacts$/))) {
      const cid = decodeURIComponent(m[1]);
      let b = ''; req.on('data', (c) => { b += c; }); req.on('end', async () => {
        try {
          const body = JSON.parse(b || '{}');
          const sha = body?.content?.sha256 ?? null;
          const ev = body?.content?.connectorRef?.evidenceId ?? null;
          const dedupeKey = `${cid}|${sha}|${ev}`;
          if (sha && state.artifacts.has(dedupeKey)) {
            const prev = state.artifacts.get(dedupeKey);
            return idempotent(req, res, credential, async () => ({ ok: true, artifactId: prev.artifactId, duplicateOf: prev.artifactId }), { ...entry, op: 'register', cid, dup: true });
          }
          return idempotent(req, res, credential, async () => {
            const artifactId = `aart-${h16({ cid, sha, ev, n: state.artifacts.size })}`;
            state.artifacts.set(dedupeKey, { artifactId, requestId: req.headers['x-request-id'] });
            state.counters.registerDistinctReq.add(req.headers['x-request-id']);
            state.counters.registerArtifacts.add(artifactId);
            return { ok: true, artifactId, duplicateOf: null };
          }, { ...entry, op: 'register', cid });
        } catch (e) { return finish(res, 400, { ok: false, error: 'BAD_JSON' }, { ...entry, err: String(e).slice(0, 80) }); }
      });
      return;
    }
    if (req.method === 'POST' && (m = p.match(/^\/api\/v2\/customers\/([^/]+)\/analysis-runs\/start$/))) {
      return idempotent(req, res, credential, async () => ({ ok: true, runId: `arun-${h16({ u: state.counters.executed, r: req.headers['x-request-id'] })}`, inputDigest: `dig-${h16({ t: Date.now() })}` }), { ...entry, op: 'run-start' });
    }
    if (req.method === 'POST' && /^\/api\/v2\/analysis-runs\/[^/]+\/finish$/.test(p)) {
      return idempotent(req, res, credential, async () => ({ ok: true, runId: decodeURIComponent(p.split('/')[3]), status: 'completed' }), { ...entry, op: 'run-finish' });
    }
    if (req.method === 'POST' && (m = p.match(/^\/api\/v2\/customers\/([^/]+)\/rule-gate-receipts$/))) {
      return idempotent(req, res, credential, async () => ({ ok: true, receiptId: `grcpt-${h16({ r: req.headers['x-request-id'] })}`, result: 'NEEDS_EVIDENCE', rulesetVersion: 'v' }), { ...entry, op: 'gate' });
    }
    if (req.method === 'POST' && (m = p.match(/^\/api\/v2\/customers\/([^/]+)\/findings$/))) {
      return idempotent(req, res, credential, async () => ({ ok: true, findingId: `afind-${h16({ r: req.headers['x-request-id'] })}` }), { ...entry, op: 'finding' });
    }
    if (req.method === 'POST' && /^\/api\/v2\/customers\/[^/]+\/artifacts\/[^/]+\/processing$/.test(p)) {
      return idempotent(req, res, credential, async () => ({ ok: true, current: null, recorded: 1 }), { ...entry, op: 'g3' });
    }
    if (req.method === 'GET' && /^\/api\/v2\/customers\/[^/]+\/decision-status$/.test(p)) {
      return finish(res, 200, { ok: true, basis: null }, entry);
    }
    return finish(res, 404, { ok: false, error: 'NOT_FOUND' }, entry);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  return {
    server, port, state, baseUrl: `http://127.0.0.1:${port}`,
    setMode(mode) { state.mode = mode; logWriter?.write({ t: new Date().toISOString(), kind: 'a-standin-mode', mode }); },
    summary() {
      return {
        mode: state.mode, counters: {
          ...state.counters,
          registerDistinctReq: state.counters.registerDistinctReq.size,
          registerArtifacts: state.counters.registerArtifacts.size,
          receipts: state.receipts.size,
        },
      };
    },
    close() {
      try { server.closeAllConnections(); } catch { /* Node<18.2 无此方法 */ }
      return new Promise((r) => server.close(r)).catch(() => {});
    },
  };
}

// ---------- 不变量检查（SQL + 磁盘核对） ----------
export function walkFiles(root) {
  const out = [];
  const rec = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      const s = statSync(p);
      if (s.isDirectory()) rec(p); else out.push({ rel: relative(root, p).split('\\').join('/'), size: s.size, mtimeMs: s.mtimeMs });
    }
  };
  if (existsSync(root)) rec(root);
  return out;
}

export async function checkIsolation(store, tenantId) {
  const facts = (await store.query(
    `SELECT count(*)::int AS n FROM fact_assertions f
     JOIN evidence_artifacts a ON a.tenant_id=f.tenant_id AND a.evidence_id=f.from_artifacts->>0
     WHERE f.tenant_id=$1 AND a.customer_id <> f.customer_id`, [tenantId])).rows[0].n;
  const obs = (await store.query(
    `SELECT count(*)::int AS n FROM a_links l
     JOIN evidence_artifacts a ON a.tenant_id=l.tenant_id AND a.evidence_id=l.local_id
     WHERE l.tenant_id=$1 AND l.entity_type IN ('material','supersede') AND a.customer_id <> l.customer_id`, [tenantId])).rows[0].n;
  const parse = (await store.query(
    `SELECT sha256, count(DISTINCT customer_id)::int AS custs, count(DISTINCT parse_key)::int AS keys
     FROM parse_results WHERE tenant_id=$1 GROUP BY sha256 HAVING count(DISTINCT customer_id)>1`, [tenantId])).rows;
  const parseCrossOk = parse.every((r) => r.keys >= r.custs); // 跨客户同字节各自键：键数≥客户数
  return { factCrossCustomer: facts, observationCrossTenant: obs, crossCustomerShas: parse.length, parseCrossOk };
}

export async function snapshotConfirmed(store, tenantId, limit = 120) {
  return (await store.query(
    `SELECT a.evidence_id, a.sha256, o.size_bytes, o.storage_path
     FROM evidence_artifacts a
     JOIN processing_tasks t ON t.tenant_id=a.tenant_id AND t.evidence_id=a.evidence_id AND t.status IN ('done','skipped_duplicate','needs_followup')
     JOIN objects o ON o.object_ref=a.object_ref
     WHERE a.tenant_id=$1 ORDER BY a.created_at DESC LIMIT $2`, [tenantId, limit])).rows;
}

export async function verifyPersisted(store, snap) {
  const issues = [];
  for (const row of snap) {
    const db = (await store.query(`SELECT sha256, size_bytes FROM objects WHERE object_ref IN (SELECT object_ref FROM evidence_artifacts WHERE evidence_id=$1)`, [row.evidence_id])).rows[0];
    if (!db) { issues.push({ kind: 'db_row_missing', evidenceId: row.evidence_id }); continue; }
    const buf = await readFile(row.storage_path).catch(() => null);
    if (!buf) { issues.push({ kind: 'file_missing', evidenceId: row.evidence_id }); continue; }
    const hash = sha256Hex(buf);
    if (hash !== row.sha256) issues.push({ kind: 'hash_mismatch', evidenceId: row.evidence_id });
    else if (buf.length !== Number(row.size_bytes)) issues.push({ kind: 'size_mismatch', evidenceId: row.evidence_id });
  }
  return { checked: snap.length, issues };
}

export async function checkOrphanObjects(objectRoot, store, { minAgeMs = 10 * 60 * 1000 } = {}) {
  const rows = await store.query(`SELECT object_ref FROM objects`);
  const known = new Set(rows.rows.map((r) => r.object_ref));
  const now = Date.now();
  const orphans = walkFiles(objectRoot).filter((f) => !known.has(f.rel) && now - f.mtimeMs > minAgeMs);
  const missing = [];
  for (const ref of known) {
    const p = join(objectRoot, ref);
    if (!existsSync(p)) missing.push(ref);
  }
  return { orphanFiles: orphans.map((o) => o.rel), missingObjects: missing.slice(0, 50), missingCount: missing.length };
}

export async function taskStatusCounts(store) {
  return (await store.query(`SELECT status, count(*)::int AS n FROM processing_tasks GROUP BY status ORDER BY status`)).rows;
}

export async function connectionCounts(pool) {
  const r = await pool.query(
    `SELECT state, count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() GROUP BY state`);
  const byState = Object.fromEntries(r.rows.map((x) => [x.state ?? 'null', x.n]));
  return { total: Object.values(byState).reduce((a, b) => a + b, 0), byState };
}

export async function oldestQueuedAgeSec(store, tenantId) {
  const r = await store.query(
    `SELECT coalesce(max(extract(epoch FROM (now()-created_at))),0)::int AS s FROM processing_tasks WHERE tenant_id=$1 AND status='queued'`, [tenantId]);
  return r.rows[0].s;
}

export function percentile(arr, q) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((q / 100) * s.length))];
}
