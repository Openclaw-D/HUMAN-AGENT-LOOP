#!/usr/bin/env node
/**
 * export-trajectory-from-store.mjs — 从产品 remote-store.json 导出 product-trajectory@1（零依赖）
 *
 * 用途（MAIN→C 集成接口）：对隔离环境真实运行后的 .v5-preview-data/remote-store.json 执行本工具，
 * 产出可被 R3_EVAL tools/replay-cli.mjs 回放的轨迹文件（meta.source=product_export）。
 *
 * 用法：
 *   node tools/export-trajectory-from-store.mjs --store <remote-store.json> --session <sessionId> \
 *        [--timeline-from <store|session>] [--todos <todos.json>] --out <trajectory.json>
 *
 * 行为：
 *   - 按 sessionId 过滤 evidence/annotations/reviews/calculations/timeline（跨会话记录不带入——会话隔离由回放器 R-SESS 复核）。
 *   - timeline：优先取 session.timeline（若产品把 TimelineState 挂在会话上），否则取 store.timeline；都没有 → 空数组。
 *   - todos：可选外部 JSON（TodoState[]，MAIN 从产品待办态投影）；缺省空数组（R-HANG 记 N/A，如实不编造）。
 *   - 失败关闭：store 结构非法/sessionId 不存在 → exit 2；导出不改写 store。
 */
import fs from 'node:fs';
import path from 'node:path';

const fail = (msg) => { console.error(`[导出失败] ${msg}`); process.exit(2); };
const args = process.argv.slice(2);
const get = (k) => { const i = args.indexOf('--' + k); return i === -1 ? undefined : args[i + 1]; };

const storePath = get('store');
const sessionId = get('session');
if (!storePath || !sessionId) fail('用法：--store <remote-store.json> --session <sessionId> [--timeline-from store|session] [--todos todos.json] --out <file>');

let store;
try { store = JSON.parse(fs.readFileSync(path.resolve(storePath), 'utf8')); } catch (e) { fail(`store 不可读或非法JSON: ${e.message}`); }
if (!Array.isArray(store.sessions) || !Array.isArray(store.evidence) || !Array.isArray(store.annotations) || !Array.isArray(store.reviews) || !Array.isArray(store.calculations)) {
  fail('store 结构非法：sessions/evidence/annotations/reviews/calculations 必须为数组（v5-preview-remote-store@1）');
}
const session = store.sessions.find((s) => s.sessionId === sessionId);
if (!session) fail(`sessionId ${sessionId} 不存在于 store（现有：${store.sessions.map((s) => s.sessionId).join(', ') || '无'}）`);

const byS = (arr) => arr.filter((r) => r.sessionId === sessionId);
let timeline = [];
const tlFrom = get('timeline-from') ?? 'session';
if (tlFrom === 'session' && Array.isArray(session.timeline)) timeline = session.timeline;
else if (Array.isArray(store.timeline)) timeline = byS(store.timeline);

let todos = [];
if (get('todos')) {
  try { todos = JSON.parse(fs.readFileSync(path.resolve(get('todos')), 'utf8')); } catch (e) { fail(`todos 文件不可读: ${e.message}`); }
  if (!Array.isArray(todos)) fail('todos 必须为 TodoState 数组');
}

const trajectory = {
  schema: 'product-trajectory@1',
  meta: {
    trajectoryId: get('trajectory-id') ?? `trj-${sessionId}-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}`,
    source: 'product_export',
    exportedAt: new Date().toISOString(),
    exportTool: `export-trajectory-from-store.mjs（store版本=${store.version ?? 'unknown'}，时间线来源=${tlFrom}）`,
    note: '由 MAIN 隔离运行后的 remote-store 导出；时间线来自真实应用事件。',
  },
  session,
  evidence: byS(store.evidence),
  annotations: byS(store.annotations),
  reviews: byS(store.reviews),
  calculations: byS(store.calculations),
  timeline,
  todos,
  ruleConfig: store.ruleConfig ?? { version: 0, status: 'unconfigured', layers: { technicalQuality: null, evidenceSufficiency: null, businessRisk: null, economics: null } },
};

const out = get('out');
if (out) { fs.writeFileSync(path.resolve(out), JSON.stringify(trajectory, null, 2) + '\n', 'utf8'); console.log(`已导出 ${path.resolve(out)}（timeline=${timeline.length} 条，todos=${todos.length} 项）`); }
else console.log(JSON.stringify(trajectory, null, 2));
