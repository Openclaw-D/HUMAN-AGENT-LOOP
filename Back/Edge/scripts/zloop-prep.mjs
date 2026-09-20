// V0.3 zcode-real-loop · 隔离真实栈运行配置准备（2026-09-20）。
// 职责：在 Back/Edge/.run/zloop/（Git 排除）生成——
//   1) assistant-config.json：模型运行配置。transport/budget 段逐字节取自 Back/B/config/b-config.json
//      （单密钥源：密钥只在文件与内存之间流转，本脚本不读取、不回显、不落入任何交付物），
//      并附加 evidencePolicy.allowedHashes = 获准合成材料（三案例 originals/ + eval-v03 冲突与更正夹具）的 SHA-256。
//   2) model-profiles.json：统一 profile registry（active=glm52-real@1；后续内网 V4 Flash/Qwen3.8
//      量化版按同结构追加 profile，不改动业务代码——MODEL_PORTABILITY_CONTRACT 的保留要求）。
//   3) zloop-runtime.json：装配运行时（源自 takeoff-runtime.json 合成值；库/对象根/模型配置指向本路）。
//   4) model-cost-ledger.jsonl：若不存在则从共享栈账本整体复制（既有累计预算延续，不重新清零；
//      复制时点之后共享栈新增条目不自动同步，跨进程连续性为近似——在交付物中如实声明）。
// 边界：不打印任何密钥/令牌值；不发起网络调用；不启动服务。
import { createHash } from 'node:crypto';
import { existsSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EDGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BACK_ROOT = path.resolve(EDGE_ROOT, '..');
const REPO_ROOT = path.resolve(BACK_ROOT, '..');
const MATERIALS = path.join(REPO_ROOT, 'docs', 'materials', 'kashgar-demo-v1');
const ZLOOP_DIR = path.join(EDGE_ROOT, '.run', 'zloop');
const B_CONFIG = path.join(BACK_ROOT, 'B', 'config', 'b-config.json');
const TAKEOFF_RUNTIME = path.join(EDGE_ROOT, 'config', 'takeoff-runtime.json');
const SHARED_LEDGER = path.join(EDGE_ROOT, '.run', 'takeoff', 'model-cost-ledger.jsonl');

const fail = (m) => { console.error(`[zloop-prep] ✗ ${m}`); process.exit(2); };
const ok = (m) => console.log(`[zloop-prep] ✓ ${m}`);

if (!existsSync(B_CONFIG)) fail(`缺少 ${B_CONFIG}（模型 transport/budget 单密钥源）`);
if (!existsSync(TAKEOFF_RUNTIME)) fail(`缺少 ${TAKEOFF_RUNTIME}（合成身份/种子来源）`);
mkdirSync(ZLOOP_DIR, { recursive: true });

// ---- 1) 模型运行配置（密钥不回显） ----
const bcfg = JSON.parse(readFileSync(B_CONFIG, 'utf8'));
if (bcfg.transport?.mode !== 'real') fail('b-config transport.mode 必须为 real（本切片验证真实模型闭环）');
const originals = ['KS-LASER-500', 'KS-TEXTILE-200', 'KS-INJECTION-1000'].flatMap((c) =>
  readFileSync(path.join(MATERIALS, 'SHA256SUMS.txt'), 'utf8').split(/\r?\n/)
    .filter((l) => l.includes(`${c}/originals/`))
    .map((l) => l.trim().split(/\s+/)[0]));
const fixtureHashes = ['eval-v03/KS-INJECTION-1000/C01-equipment-conflict.csv', 'eval-v03/KS-INJECTION-1000/S02-equipment-correction.txt',
  'eval-v03/KS-LASER-500/C01-equipment-conflict.csv', 'eval-v03/KS-LASER-500/S02-equipment-correction.txt',
  'eval-v03/KS-TEXTILE-200/C01-equipment-conflict.csv', 'eval-v03/KS-TEXTILE-200/S02-equipment-correction.txt']
  .filter((rel) => existsSync(path.join(MATERIALS, rel)))
  .map((rel) => createHash('sha256').update(readFileSync(path.join(MATERIALS, rel))).digest('hex'));
const allowedHashes = [...new Set([...originals, ...fixtureHashes])];
if (allowedHashes.length < 100) fail(`获准材料哈希过少（${allowedHashes.length}）：SHA256SUMS 覆盖异常`);
const assistantConfig = {
  _note: 'zcode-real-loop 隔离真实栈模型配置：transport 取自 b-config.json（单密钥源，本文件 Git 排除）；allowedHashes=获准合成材料白名单（TEC-CTX-1：仅批准 manifest 内合成材料可出站）。budget 钉回用户 2026-09-20 授权包络（累计 196 元 / maxCalls 200 / 会话 50，按账本累计，不因共享配置放宽而放大本路权限）。',
  transport: bcfg.transport,
  budget: {
    maxTotalCost: 196, perCallEstimate: 0.35, currency: 'CNY',
    maxCalls: 200, maxCallsPerSession: 50,
  },
  evidencePolicy: { allowedHashes },
};
writeFileSync(path.join(ZLOOP_DIR, 'assistant-config.json'), JSON.stringify(assistantConfig, null, 1));
ok(`assistant-config.json 已生成（allowedHashes=${allowedHashes.length} 条获准合成材料；密钥未回显）`);

// ---- 2) 统一 profile registry（内网模型后续按同结构追加，不新增付费调用） ----
const registry = {
  _note: 'zcode-real-loop 统一 profile registry：切换用 POST /api/jw/v2/admin/model-profile/activate；内网 V4 Flash / Qwen3.8 量化版接入时按同结构新增 profile（configPath 指向对应服务端配置），GLM 测试通过不记为内网验收通过。',
  active: { id: 'glm52-real', revision: 1 },
  profiles: [
    { id: 'glm52-real', revision: 1, configPath: 'assistant-config.json' },
  ],
};
writeFileSync(path.join(ZLOOP_DIR, 'model-profiles.json'), JSON.stringify(registry, null, 1));
ok('model-profiles.json 已生成（active=glm52-real@1）');

// ---- 3) 装配运行时（合成值沿用 takeoff-runtime；库/对象/模型指向本路） ----
const base = JSON.parse(readFileSync(TAKEOFF_RUNTIME, 'utf8'));
const runtime = {
  ...base,
  dbName: 'jw_zloop_a',
  connectors: { ...base.connectors, pg: { ...(base.connectors?.pg ?? {}), database: 'cnext_zloop' } },
  assistantModel: { configPath: 'assistant-config.json', registryPath: 'model-profiles.json' },
};
runtime.connectors.objectRoot = path.join(BACK_ROOT, 'Connectors', '.run', 'objects-zloop');
runtime._note = 'zcode-real-loop 隔离真实栈装配运行时（合成值；Git 排除）：端口段 48304/48284/48324/15474，容器 jw-zloop-pg，run-dir .run/zloop。';
writeFileSync(path.join(ZLOOP_DIR, 'zloop-runtime.json'), JSON.stringify(runtime, null, 1));
ok('zloop-runtime.json 已生成（A库 jw_zloop_a / Connectors库 cnext_zloop）');

// ---- 4) 账本延续（并集合并，不重新清零） ----
// 共享栈可能有并行真实调用：每次 prep 把共享账本与本路账本按 (type,requestId,at,amount) 求并集，
// 按时间排序重写本路账本——两个方向的条目都不丢，预算累计按并集口径（跨进程为近似连续；
// 真实计费以智谱控制台账单为准，交付物如实声明）。
const ledgerPath = path.join(ZLOOP_DIR, 'model-cost-ledger.jsonl');
const readLedger = (p) => existsSync(p)
  ? readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l))
  : [];
const shared = readLedger(SHARED_LEDGER);
const local = readLedger(ledgerPath);
const key = (e) => JSON.stringify([e.type, e.requestId ?? null, e.at ?? null, e.amount ?? null]);
const union = new Map();
for (const e of [...shared, ...local]) if (!union.has(key(e))) union.set(key(e), e);
const merged = [...union.values()].sort((a, b) => String(a.at ?? '').localeCompare(String(b.at ?? '')));
writeFileSync(ledgerPath, merged.map((e) => JSON.stringify(e)).join('\n') + '\n');
ok(`账本并集合并：共享 ${shared.length} 条 ⊕ 本路 ${local.length} 条 → ${merged.length} 条（既有累计预算延续，未清零）`);

console.log('[zloop-prep] 完成。下一步：node Back/Edge/scripts/zloop-up.mjs');
