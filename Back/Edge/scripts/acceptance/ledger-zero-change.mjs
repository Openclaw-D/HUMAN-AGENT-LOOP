// 账本零变化断言工具（TAKEOFF-FA-1.0.0 路04 · T09/T10 验收）。
//
// 用途：证明“正面预评估人工确认”前后 credit_facilities / financing_requests / exposure_entries
// 三张正式授信业务表零新增、零变化（04_BACKEND_ADAPTATION §5 的机器可断言不变量）。
//
// 只读保证：本工具对数据库执行的 SQL 全部是本文件内硬编码的 SELECT，且包在
// `BEGIN TRANSACTION READ ONLY … ROLLBACK` 中——事务级强制只读，无任何写入/DDL 路径，
// 不存在“SQL 补业务结果”的可能。容器/库名来自参数，仅用于 docker exec 定位实例。
//
// 用法：
//   node scripts/acceptance/ledger-zero-change.mjs snapshot --container jw-takeoff-pg --user jw --db jw --out <baseline.json>
//   node scripts/acceptance/ledger-zero-change.mjs verify   --baseline <baseline.json> [--container … --user … --db …]
// verify 退出码：0=三表逐行一致；1=存在差异（打印差异明细）；2=执行失败。
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const TABLES = [
  { name: 'credit_facilities', pk: 'facility_id' },
  { name: 'financing_requests', pk: 'fr_id' },
  { name: 'exposure_entries', pk: 'entry_id' },
];

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : fallback;
}

function dockerArgs(opts) {
  const container = arg('container', opts.container);
  if (!container) throw new Error('缺少 --container（如 jw-takeoff-pg）');
  return { container, user: arg('user', 'jw'), db: arg('db', 'jw') };
}

// 唯一被执行的 SQL：三表逐行 (pk, 行JSON的md5)。READ ONLY 事务 + ROLLBACK，绝不落任何写。
function readOnlySql() {
  const parts = ['BEGIN TRANSACTION READ ONLY;'];
  for (const t of TABLES) {
    parts.push(
      `SELECT '${t.name}' AS tbl, (${t.pk})::text AS pk, md5(row_to_json(x)::text) AS rowhash ` +
      `FROM (SELECT * FROM ${t.name}) x;`,
    );
  }
  parts.push('ROLLBACK;');
  return parts.join('\n');
}

function queryRows({ container, user, db }) {
  const r = spawnSync('docker', [
    'exec', container, 'psql', '-U', user, '-d', db,
    '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A', '-F', '\t', '-c', readOnlySql(),
  ], { encoding: 'utf8', timeout: 30000 });
  if (r.error || r.status !== 0) {
    throw new Error(`只读查询失败（docker exec psql exit=${r.status}）：${(r.stderr || r.error?.message || '').slice(0, 500)}`);
  }
  const tables = {};
  for (const t of TABLES) tables[t.name] = {};
  for (const line of (r.stdout || '').split('\n')) {
    if (!line.trim()) continue;
    const [tbl, pk, rowhash] = line.split('\t');
    if (!tables[tbl]) continue; // 防 psql 额外输出
    if (!pk || !rowhash) throw new Error(`查询输出异常：${line.slice(0, 120)}`);
    tables[tbl][pk] = rowhash;
  }
  return tables;
}

function diffTables(before, after) {
  const diffs = [];
  for (const t of TABLES) {
    const b = before[t.name] || {}, a = after[t.name] || {};
    for (const pk of Object.keys(b)) {
      if (!(pk in a)) diffs.push(`${t.name}: 行消失 pk=${pk}`);
      else if (b[pk] !== a[pk]) diffs.push(`${t.name}: 行变化 pk=${pk}`);
    }
    for (const pk of Object.keys(a)) if (!(pk in b)) diffs.push(`${t.name}: 新增行 pk=${pk}`);
  }
  return diffs;
}

const mode = process.argv[2];
try {
  const conn = dockerArgs({});
  if (mode === 'snapshot') {
    const out = arg('out');
    if (!out) throw new Error('snapshot 需要 --out <baseline.json>');
    const tables = queryRows(conn);
    writeFileSync(out, JSON.stringify({
      kind: 'takeoff-lane04-ledger-baseline',
      container: conn.container, db: conn.db,
      takenAt: new Date().toISOString(),
      counts: Object.fromEntries(TABLES.map((t) => [t.name, Object.keys(tables[t.name]).length])),
      rows: tables,
    }, null, 2) + '\n');
    console.log(`baseline -> ${out}（counts=${JSON.stringify(Object.fromEntries(TABLES.map((t) => [t.name, Object.keys(tables[t.name]).length])))}）`);
  } else if (mode === 'verify') {
    const baselinePath = arg('baseline');
    if (!baselinePath) throw new Error('verify 需要 --baseline <baseline.json>');
    const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
    if (baseline.container !== conn.container || baseline.db !== conn.db) throw new Error('基线与验收目标库不同，拒绝跨库比较');
    const after = queryRows(conn);
    const diffs = diffTables(baseline.rows, after);
    if (diffs.length === 0) {
      const counts = Object.fromEntries(TABLES.map((t) => [t.name, Object.keys(after[t.name]).length]));
      console.log(`ZERO_CHANGE_PASS counts=${JSON.stringify(counts)}`);
      process.exit(0);
    }
    console.log('ZERO_CHANGE_FAIL 账本发生业务行变化：');
    for (const d of diffs) console.log(`  - ${d}`);
    process.exit(1);
  } else {
    throw new Error('用法：snapshot|verify（见文件头注释）');
  }
} catch (e) {
  console.error(`ledger-zero-change: ${e.message}`);
  process.exit(2);
}
