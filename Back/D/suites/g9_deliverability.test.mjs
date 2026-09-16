// G9 交付性：D-28 依赖manifest覆盖传递源+lockfile（旧D-11教训程序化核对） / D-29 干净目录启动
import { defineSuite, runSuite } from '../harness/runner.mjs';
import * as sutctl from '../harness/sutctl.mjs';
import { existsSync, readdirSync, readFileSync, statSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { makeApi, ok, pick, PRINCIPALS, PRINCIPAL_TOKEN_SPEC } from '../harness/adapter.mjs';
import { makeHttp, verbs } from '../harness/http.mjs';

const D_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const NEXT_ROOT = path.dirname(D_ROOT);
const A_ROOT = path.join(NEXT_ROOT, 'A');
const SKIP_DIRS = new Set(['node_modules', '.run', 'dist', '.next', 'coverage', '.git']);

function listFiles(dir, base = '', out = []) {
  let entries; try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const abs = path.join(dir, e.name);
    const rel = (base ? base + '/' : '') + e.name;
    let st; try { st = statSync(abs); } catch { continue; }
    if (st.isDirectory()) listFiles(abs, rel, out);
    else out.push(rel);
  }
  return out;
}
// 轻量import图遍历：dist/*.js 的相对 import/export-from/require 解析（两跳依赖核对，旧D-11教训）
function walkDeps(entryFile, root, seen = new Set()) {
  const abs = path.resolve(root, entryFile);
  const key = path.relative(root, abs).replace(/\\/g, '/');
  if (seen.has(key) || !existsSync(abs)) return seen;
  seen.add(key);
  let src = ''; try { src = readFileSync(abs, 'utf8'); } catch { return seen; }
  const specs = [];
  for (const m of src.matchAll(/(?:import|export)\s+[^'"]*from\s+['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|require\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    specs.push(m[1] || m[2] || m[3]);
  }
  for (const spec of specs) {
    if (!spec.startsWith('.')) continue; // 外部包由lockfile覆盖
    const resolved = path.relative(root, path.resolve(path.dirname(abs), spec)).replace(/\\/g, '/');
    for (const cand of [resolved, resolved + '.ts', resolved + '.js', resolved + '.mjs', path.posix.join(resolved, 'index.ts'), path.posix.join(resolved, 'index.js')]) {
      if (existsSync(path.join(root, cand))) { walkDeps(cand, root, seen); break; }
    }
  }
  return seen;
}

const suite = defineSuite('g9_deliverability', [
  {
    id: 'D-28', title: '依赖manifest：assembly/manifest.json覆盖入口传递源图+package.json+lockfile', severity: 'P0', owner: 'A', timeoutMs: 120000,
    async fn(ctx) {
      const a = ctx.assert;
      const manifestPath = path.join(A_ROOT, 'assembly', 'manifest.json');
      if (!existsSync(manifestPath)) {
        ctx.log('[D-28] assembly/manifest.json 未发布（契约§6要求A落盘）——留门');
        ctx.blocked('A尚未发布 assembly/manifest.json');
      }
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      // manifest形状自适应：找文件列表字段
      const listed = new Set();
      const collect = (v) => {
        if (typeof v === 'string') listed.add(v.replace(/\\/g, '/'));
        else if (Array.isArray(v)) v.forEach(collect);
        else if (v && typeof v === 'object') {
          if (typeof v.path === 'string') listed.add(v.path.replace(/\\/g, '/'));
          else Object.values(v).forEach(collect);
        }
      };
      collect(manifest.files ?? manifest);
      a.ok(listed.size >= 5, 'manifest含文件列表', { count: listed.size });
      // 独立枚举A源（不信任manifest）
      const actual = listFiles(A_ROOT);
      // lockfile与package.json必须在
      for (const must of ['package.json', 'package-lock.json']) {
        a.ok(actual.includes(must), `${must}存在于源树`);
        a.ok([...listed].some(l => l === must || l.endsWith('/' + must)), `manifest含${must}（旧D-11教训）`, { inManifest: [...listed].filter(l => l.includes('package')).slice(0, 5) });
      }
      // 传递源图：从dist入口走import图，每一跳必须在manifest
      const entries = actual.filter(f => /^(src\/(index\.ts|db\/migrate-cli\.ts)|dist\/(index\.js|db\/migrate\.js))$/.test(f));
      a.ok(entries.length >= 1, 'dist入口存在', { entries });
      const missing = [];
      for (const e of entries) {
        const deps = walkDeps(e, A_ROOT);
        for (const d of deps) if (!listed.has(d) && !listed.has('./' + d) && !listed.has('/' + d)) missing.push(d);
      }
      a.eq(missing.length, 0, '传递源图全部在manifest（含两跳依赖）', { missingSample: missing.slice(0, 15), missingCount: missing.length });
    },
  },
  {
    id: 'D-29', title: '干净目录启动：manifest文件复制到D自有干净目录→安装→迁移→启动→健康', severity: 'P0', owner: 'A', timeoutMs: 600000,
    async fn(ctx) {
      const a = ctx.assert;
      const manifestPath = path.join(A_ROOT, 'assembly', 'manifest.json');
      if (!existsSync(manifestPath)) {
        ctx.log('[D-29] manifest未发布——干净启动以完整源树副本替代（记录：非最终manifest路径），仍验证"干净目录可恢复启动"能力');
      }
      // 干净目录：run内唯一名（避免跨run句柄锁）+ 重试删除旧目录（尽力清理）
      const clean = path.join(D_ROOT, '.run', `clean-a-${Date.now().toString(36)}`);
      try { rmSync(path.join(D_ROOT, '.run', 'clean-a'), { recursive: true, force: true, maxRetries: 3, retryDelay: 800 }); } catch { }
      mkdirSync(clean, { recursive: true });
      if (existsSync(manifestPath)) {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
        const listed = new Set();
        const collect = (v) => {
          if (typeof v === 'string') listed.add(v.replace(/\\/g, '/'));
          else if (Array.isArray(v)) v.forEach(collect);
          else if (v && typeof v === 'object') { if (typeof v.path === 'string') listed.add(v.path.replace(/\\/g, '/')); else Object.values(v).forEach(collect); }
        };
        collect(manifest.files ?? manifest);
        let copied = 0;
        for (const rel of listed) {
          const src = path.join(A_ROOT, rel);
          if (existsSync(src) && statSync(src).isFile()) {
            const dst = path.join(clean, rel);
            mkdirSync(path.dirname(dst), { recursive: true });
            cpSync(src, dst); copied++;
          }
        }
        a.ok(copied >= 5, 'manifest文件复制到干净目录', { copied });
      } else {
        // 无manifest：整树复制（node_modules除外）作为恢复能力验证
        cpSync(A_ROOT, clean, { recursive: true, filter: (s) => !/(node_modules|\.run|\.git)/.test(s) });
        a.ok(existsSync(path.join(clean, 'package.json')), '源树副本含package.json');
      }
      // 安装（锁版）
      const install = spawnSync('npm', ['ci', '--no-audit', '--no-fund'], { cwd: clean, encoding: 'utf8', timeout: 180000, windowsHide: true, shell: true });
      if (install.status !== 0) {
        const retry = spawnSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: clean, encoding: 'utf8', timeout: 240000, windowsHide: true, shell: true });
        a.eq(retry.status, 0, '干净目录依赖安装成功（npm ci失败后install重试）', { ciErr: (install.stderr || '').slice(-200), installErr: (retry.stderr || '').slice(-200) });
      } else {
        a.ok(true, 'npm ci成功（锁版安装）');
      }
      // A实际入口为src直跑，无需构建；仅当干净目录连src都没有时才要求构建（tsc结果如实记录）
      if (!existsSync(path.join(clean, 'src', 'index.ts')) && !existsSync(path.join(clean, 'dist', 'index.js'))) {
        const build = spawnSync('npm', ['run', 'build'], { cwd: clean, encoding: 'utf8', timeout: 180000, windowsHide: true, shell: true });
        a.eq(build.status, 0, '干净目录构建成功', { err: (build.stderr || '').slice(-300) });
      } else {
        ctx.log('[D-29] src直跑模式：构建为可选产物，不作为判定项');
      }
      // 干净库+迁移+启动
      const pg = await sutctl.pgctl.ensurePg({ runDir: path.join(D_ROOT, '.run', 'pg-d'), port: 15433, user: 'v7next', password: 'v7next', db: 'v7d_boot' });
      const dbname = 'v7d_g9_clean';
      await sutctl.pgctl.createDb(pg.name, dbname);
      const dsn = `postgres://v7next:v7next@127.0.0.1:15433/${dbname}`;
      // A实际入口：node直跑 src/*.ts（Node22类型剥离）；dist仅作为可选回退
      const entrySrc = existsSync(path.join(clean, 'src', 'index.ts'));
      const migTs = path.join(clean, 'src', 'db', 'migrate-cli.ts');
      if (existsSync(migTs)) {
        const m = spawnSync(process.execPath, [migTs, '--db', dsn], { cwd: clean, env: { ...process.env }, encoding: 'utf8', timeout: 180000, windowsHide: true });
        a.eq(m.status, 0, '干净目录迁移成功（src直跑）', { err: (m.stderr || '').slice(-300) });
      }
      const principalSpec = process.env.D_PRINCIPAL_SPEC || PRINCIPAL_TOKEN_SPEC;
      const entry = entrySrc ? path.join(clean, 'src', 'index.ts') : path.join(clean, 'dist', 'index.js');
      const api = await ctx.proc.spawnOwn('d-g9-clean-api', process.execPath, [
        entry, '--port', '17921', '--db', dsn, '--principal-tokens', principalSpec,
      ], {
        cwd: clean, env: { ...process.env },
        stdoutPath: path.join(ctx.runDir, 'g9-clean-api.log'),
        readyProbe: async () => {
          const h = makeHttp('http://127.0.0.1:17921', { defaultTimeoutMs: 3000 });
          const r = await h('GET', '/api/v1/health');
          return r.status === 200;
        },
        readyTimeoutMs: 45000,
      });
      a.ok(api.pid, '干净目录API启动（pid可得）');
      const cli = makeApi('http://127.0.0.1:17921').as(PRINCIPALS.admin);
      const h = ok(a, await cli.get('/api/v1/health'), '干净实例health');
      a.eq(pick(h, 'db'), 'up', '干净实例DB连接up');
      a.eq(pick(h, 'model'), 'not_configured', '干净实例model如实not_configured');
      // 端到端小写：模板→项目→目标（模板含验收角色）
      const t = ok(a, await cli.post('/api/v1/templates', {
        requestId: 'v7d-g9-t', name: 'G9干净启动模板',
        roles: [{ roleKey: 'business', title: '业务', isHumanRole: true }, { roleKey: 'approver', title: '验收决定', isHumanRole: true }],
        goals: [{ goalKey: 'g', title: 'g', description: '', responsibleRole: 'business', executorKind: 'agent', acceptanceRole: 'approver', decisionRole: 'approver', inputEvidenceKinds: [], dependsOn: [], params: {} }],
      }), '干净实例建模板');
      a.ok(pick(t, 'templateId'), '干净实例端到端写成功');
      ctx.log('[D-29] 注意：本验证为本机干净目录；第二机器/跨OS未测（结论分级保留）');
    },
  },
]);

runSuite(suite, import.meta.url);
