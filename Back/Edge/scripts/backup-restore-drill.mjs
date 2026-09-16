// S5 备份/恢复真实演练（任务04 §7）：在 D 路同款自有隔离 PG 容器（v7d- 前缀、15434 端口、
// Edge/.run 数据目录）上执行完整周期：
//   建库 → 应用 001 迁移 → 灌合成数据 → 行内容指纹 → pg_dump -Fc 备份 →
//   DROP DATABASE（模拟损毁/误删）→ pg_restore 恢复 → 指纹比对 → 容器销毁。
// 判据：恢复后每表行数与全行指纹与备份前逐表一致；数据在容器卷内，与 Git 无关（代码回滚≠数据库回滚）。
// 证据写 docs/customer-next/acceptance/evidence/s5-drill-<stamp>/drill-result.json。
// 退出码：0=演练通过；1=指纹不一致/步骤失败；2=执行错误。
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EDGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BACK_ROOT = path.resolve(EDGE_ROOT, '..');
const REPO_ROOT = path.resolve(BACK_ROOT, '..');
const RUN_DIR = path.join(EDGE_ROOT, '.run', 'drill-pg');
const MIGRATION_001 = path.join(BACK_ROOT, 'A', 'migrations', '001_init.sql');
const PG_USER = 'v7next', PG_PASS = 'v7next', DB = 'v7d_drill', PORT = 15434;

const pgctl = await import('../../D/harness/pgctl.mjs');

const steps = [];
const step = async (name, fn) => {
  const t0 = Date.now();
  try {
    const detail = await fn();
    steps.push({ name, ok: true, detail: detail || null, ms: Date.now() - t0 });
    console.log(`[drill] ✓ ${name} (${Date.now() - t0}ms)`);
    return detail;
  } catch (e) {
    steps.push({ name, ok: false, detail: String(e.message).slice(0, 500), ms: Date.now() - t0 });
    console.error(`[drill] ✗ ${name}: ${String(e.message).slice(0, 300)}`);
    throw e;
  }
};

function run(cmd, args, { input } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true });
    let out = '', err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve({ out, err }) : reject(new Error(`${cmd} ${args.join(' ')} exit=${code}: ${err.slice(0, 300)}`))));
    if (input !== undefined) { child.stdin.write(input); child.stdin.end(); } else child.stdin.end();
  });
}

// 逐表全行指纹：行转 JSON 文本按主键排序后聚合 md5（同一服务器内对相同数据确定）。
const FINGERPRINTS = {
  goal_templates: `SELECT coalesce(md5(string_agg(row_to_json(t)::text, E'\n' ORDER BY t.template_id)), 'EMPTY') FROM goal_templates t`,
  projects: `SELECT coalesce(md5(string_agg(row_to_json(t)::text, E'\n' ORDER BY t.project_id)), 'EMPTY') FROM projects t`,
  goals: `SELECT coalesce(md5(string_agg(row_to_json(t)::text, E'\n' ORDER BY t.goal_id)), 'EMPTY') FROM goals t`,
  evidence: `SELECT coalesce(md5(string_agg(row_to_json(t)::text, E'\n' ORDER BY t.evidence_id)), 'EMPTY') FROM evidence t`,
  task_assignments: `SELECT coalesce(md5(string_agg(row_to_json(t)::text, E'\n' ORDER BY t.goal_id)), 'EMPTY') FROM task_assignments t`,
  human_requests: `SELECT coalesce(md5(string_agg(row_to_json(t)::text, E'\n' ORDER BY t.hrequest_id)), 'EMPTY') FROM human_requests t`,
  execution_receipts: `SELECT coalesce(md5(string_agg(row_to_json(t)::text, E'\n' ORDER BY t.receipt_id)), 'EMPTY') FROM execution_receipts t`,
  audit_events: `SELECT coalesce(md5(string_agg(row_to_json(t)::text, E'\n' ORDER BY t.seq)), 'EMPTY') FROM audit_events t`,
  outbox_events: `SELECT coalesce(md5(string_agg(row_to_json(t)::text, E'\n' ORDER BY t.seq)), 'EMPTY') FROM outbox_events t`,
  subscriptions: `SELECT coalesce(md5(string_agg(row_to_json(t)::text, E'\n' ORDER BY t.sub_id)), 'EMPTY') FROM subscriptions t`,
  outbox_deliveries: `SELECT coalesce(md5(string_agg(row_to_json(t)::text, E'\n' ORDER BY t.sub_id, t.seq)), 'EMPTY') FROM outbox_deliveries t`,
  idempotency: `SELECT coalesce(md5(string_agg(row_to_json(t)::text, E'\n' ORDER BY t.request_id)), 'EMPTY') FROM idempotency t`,
};

const SEED_SQL = `
INSERT INTO goal_templates (template_id, version, name, industry, roles, goals, created_by) VALUES
('tpl-drill', 1, '演练模板', 'synthetic', '[{"roleKey":"business","title":"业务","isHumanRole":true}]',
 '[{"goalKey":"intake","title":"受理","description":"","responsibleRole":"business","executorKind":"human","acceptanceRole":"business","decisionRole":"business","inputEvidenceKinds":[],"dependsOn":[],"params":{}}]', 'drill');
INSERT INTO projects (project_id, template_id, template_version, name, created_by) VALUES ('proj-drill', 'tpl-drill', 1, '演练项目', 'drill');
INSERT INTO evidence (evidence_id, project_id, kind, content, sha256, input_version) VALUES
('ev-drill-1', 'proj-drill', 'invoice', '{"amount":123}', 'abc123', 1);
INSERT INTO goals (goal_id, project_id, goal_key, title, responsible_role, executor_kind, acceptance_role, decision_role, status)
VALUES ('goal-drill-1', 'proj-drill', 'intake', '受理', 'business', 'human', 'business', 'business', 'candidate_ready');
INSERT INTO task_assignments (goal_id, assignee, kind, lease_until, fencing_token) VALUES
('goal-drill-1', 'drill-worker', 'lease', now() + interval '10 minutes', 1);
INSERT INTO human_requests (hrequest_id, project_id, goal_id, kind, question, requested_role, created_by) VALUES
('hr-drill-1', 'proj-drill', 'goal-drill-1', 'missing_evidence', '请补充发票原件', 'business', 'drill');
INSERT INTO execution_receipts (receipt_id, goal_id, kind, actor_principal_id, fencing_token, output, note) VALUES
('rc-drill-1', 'goal-drill-1', 'claimed', 'drill-worker', 1, '{"ok":true}', '演练回执');
INSERT INTO audit_events (actor_principal_id, action, target_type, target_id, project_id, summary, payload_sha256) VALUES
('drill', 'DRILL_SEED', 'project', 'proj-drill', 'proj-drill', '备份恢复演练种子', 'seed');
INSERT INTO outbox_events (event_type, project_id, goal_id, payload) VALUES
('DRILL_EVENT', 'proj-drill', 'goal-drill-1', '{"n":1}');
INSERT INTO subscriptions (sub_id, name, url) VALUES ('sub-drill', '演练订阅', 'http://127.0.0.1:1/hook');
INSERT INTO outbox_deliveries (sub_id, seq, state) SELECT 'sub-drill', seq, 'pending' FROM outbox_events;
INSERT INTO idempotency (request_id, payload_sha256, response) VALUES ('req-drill-1', 'hash', '{"replayed":false}');
`;

async function fingerprint(pg) {
  const result = {};
  for (const [table, sql] of Object.entries(FINGERPRINTS)) {
    const cnt = await pgctl.psql(pg.name, DB, `SELECT count(*) FROM ${table}`, PG_USER);
    const fp = await pgctl.psql(pg.name, DB, sql, PG_USER);
    if (cnt.err || fp.err || !/^[0-9a-f]{32}$/.test(fp.out)) throw new Error(`指纹失败 ${table}: ${cnt.err || fp.err || fp.out}`);
    result[table] = { rows: Number(cnt.out), md5: fp.out };
  }
  return result;
}

async function main() {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  const evidenceDir = path.join(REPO_ROOT, 'docs', 'customer-next', 'acceptance', 'evidence', `s5-drill-${stamp}`);
  const dumpPath = path.join(RUN_DIR, `drill-backup-${stamp}.dump`);
  let pg = null;
  let exitCode = 2;

  try {
    mkdirSync(RUN_DIR, { recursive: true });
    pg = await step('1 建自有隔离PG容器(v7d-前缀,15434)', () => pgctl.ensurePg({ runDir: RUN_DIR, port: PORT, user: PG_USER, password: PG_PASS, db: 'v7d_boot' }));
    await step('2 建演练库（幂等：先丢弃上次残留）', async () => {
      // pgdata 是 bind-mount 持久目录：上次演练的容器销毁后库文件仍在。先 DROP 再建，保证演练从零开始。
      await pgctl.psql(pg.name, 'postgres', `DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`, PG_USER).then((r) => {
        if (r.err) throw new Error(r.err);
      });
      await pgctl.createDb(pg.name, DB);
      return { db: DB };
    });

    // 任务三扩展：应用全部迁移（001..00N 按 A 路迁移目录顺序；演练=真实 schema 全量）。
    // 合成数据仍灌 12 张 v1 业务表；新增表（002/003/004）随 schema 建立并纳入指纹比对。
    const migDir = path.join(BACK_ROOT, 'A', 'migrations');
    const migFiles = readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort();
    const applied = [];
    await step('3 应用全部迁移(docker cp+psql -f，按序)', async () => {
      for (const f of migFiles) {
        const local = path.join(migDir, f);
        const containerSql = `/tmp/${f}`;
        await run('docker', ['cp', local, `${pg.name}:${containerSql}`]);
        await run('docker', ['exec', pg.name, 'psql', '-U', PG_USER, '-d', DB, '-v', 'ON_ERROR_STOP=1', '-f', containerSql]);
        applied.push(f);
      }
      return { migrations: applied };
    });

    await step('4 灌合成数据(12表)', () => pgctl.psql(pg.name, DB, SEED_SQL, PG_USER).then((r) => {
      if (r.err) throw new Error(r.err);
      return { seeded: '12 tables' };
    }));

    const before = await step('5 备份前逐表行数+全行指纹', () => fingerprint(pg));

    await step('6 pg_dump -Fc 备份', () => new Promise((resolve, reject) => {
      const out = createWriteStream(dumpPath);
      const child = spawn('docker', ['exec', pg.name, 'pg_dump', '-U', PG_USER, '-Fc', DB], { windowsHide: true });
      child.stdout.pipe(out);
      let err = '';
      child.stderr.on('data', (d) => (err += d));
      child.on('close', (code) => (code === 0 ? resolve({ dump: path.relative(REPO_ROOT, dumpPath) }) : reject(new Error(`pg_dump exit=${code}: ${err.slice(0, 200)}`))));
      child.on('error', reject);
    }));

    const dumpSha = createHash('sha256').update(readFileSync(dumpPath)).digest('hex');

    await step('7 模拟损毁：DROP DATABASE', () => pgctl.psql(pg.name, 'postgres', `DROP DATABASE ${DB} WITH (FORCE)`, PG_USER).then((r) => {
      if (r.err) throw new Error(r.err);
    }));
    const emptyCheck = await pgctl.psql(pg.name, 'postgres', `SELECT 1 FROM pg_database WHERE datname='${DB}'`, PG_USER);
    if (emptyCheck.out.includes('1')) throw new Error('库删除失败，演练无效');
    await step('8 重建空库', () => pgctl.psql(pg.name, 'postgres', `CREATE DATABASE ${DB}`, PG_USER).then((r) => {
      if (r.err) throw new Error(r.err);
    }));

    await step('9 pg_restore 恢复', () => new Promise((resolve, reject) => {
      const child = spawn('docker', ['exec', '-i', pg.name, 'pg_restore', '-U', PG_USER, '-d', DB, '--no-owner'], { windowsHide: true });
      createReadStream(dumpPath).pipe(child.stdin);
      let err = '';
      child.stderr.on('data', (d) => (err += d));
      child.on('close', (code) => (code === 0 ? resolve({ restored: true }) : reject(new Error(`pg_restore exit=${code}: ${err.slice(0, 300)}`))));
      child.on('error', reject);
    }));

    const after = await step('10 恢复后逐表行数+全行指纹', () => fingerprint(pg));

    await step('11 指纹比对', () => {
      const mismatches = Object.keys(before).filter((t) => before[t].md5 !== after[t].md5 || before[t].rows !== after[t].rows);
      if (mismatches.length) throw new Error(`不一致表: ${mismatches.join(',')}`);
      return { tables: Object.keys(before).length, verdict: 'ALL_MATCH' };
    });

    exitCode = 0;
  } catch {
    exitCode = steps.every((s) => s.ok) ? 2 : 1;
  } finally {
    if (pg) {
      try { await pgctl.destroyPg(pg.name); steps.push({ name: '12 销毁自有容器', ok: true, detail: pg.name, ms: 0 }); } catch (e) {
        steps.push({ name: '12 销毁自有容器', ok: false, detail: String(e.message).slice(0, 200), ms: 0 });
      }
    }
    const report = {
      schemaVersion: 'jw.s5-drill.v1',
      drilledAt: new Date().toISOString(),
      isolation: { containerPrefix: 'v7d-', port: PORT, dataDir: 'Back/Edge/.run/drill-pg', note: '不触碰 v7next-a-pg / jw-v01-pg / Dify 等其他容器；仅销毁本演练容器' },
      database: { name: DB, migrationApplied: '全部迁移（001..00N，见 report.steps[2].detail）', dataScope: '全部合成数据（drill-* 命名）' },
      steps,
      verdict: exitCode === 0 ? 'PASS' : 'FAIL',
      notes: [
        '代码回滚不等于数据库回滚：本演练证明的是"库损毁/误删后可从备份还原"；不可逆迁移需另备向前修复方案（任务01迁移策略落定时复核）',
        '数据在容器卷与备份文件中，不随 Git reset 消失；备份文件 .dump 留存于 Back/Edge/.run（Git 排除），不入公开仓库',
        '真实客户数据/正式环境的备份演练需获准环境与授权，另行执行（E2/E3 门）',
      ],
    };
    mkdirSync(evidenceDir, { recursive: true });
    writeFileSync(path.join(evidenceDir, 'drill-result.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`[drill] verdict=${report.verdict} 证据: ${path.relative(REPO_ROOT, path.join(evidenceDir, 'drill-result.json'))}`);
    process.exit(exitCode);
  }
}

main();
