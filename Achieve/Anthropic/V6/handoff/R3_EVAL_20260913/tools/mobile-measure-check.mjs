#!/usr/bin/env node
/**
 * mobile-measure-check.mjs — R3 手机量测检查器（零依赖）
 *
 * 输入：mobile-measurement@1（docs/MOBILE_MEASUREMENT_SCHEMA.md）——MAIN 产出的可执行 DOM 量测文件。
 * 原则：**没有原始量测文件不 PASS**；截图只能作佐证附件。无法精确尺寸 → BLOCKED（不拿缩放替代）。
 *
 * 用法：node tools/mobile-measure-check.mjs --measurement <file> [--json]
 * 退出码：0=PASS；3=FAIL/BLOCKED；2=用法/解析错误。
 */
import fs from 'node:fs';
import path from 'node:path';

const fail = (msg) => { console.error(`[用法/解析失败] ${msg}`); process.exit(2); };
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const args = process.argv.slice(2);
const mi = args.indexOf('--measurement');
if (mi === -1 || !args[mi + 1]) fail('用法：mobile-measure-check.mjs --measurement <file> [--json]');
let m;
try { m = JSON.parse(fs.readFileSync(path.resolve(args[mi + 1]), 'utf8')); } catch (e) { fail(`量测文件不可读或非法JSON: ${e.message}`); }

const checks = [];
const check = (name, status, detail) => checks.push({ name, status, detail });
const jsonOut = args.includes('--json');

// BLOCKED 条件：schema/结构缺失 = 没有原始量测
if (m.schema !== 'mobile-measurement@1' || !isObj(m.viewport) || !Array.isArray(m.pages)) {
  check('证据形态', 'BLOCKED', `缺少原始 DOM 量测（schema=${JSON.stringify(m.schema)}）——截图不能替代量测`);
  emit('BLOCKED');
}
if (m.meta?.zoomHint && /缩放|scale|zoom/i.test(m.meta.zoomHint) && /DPR3/.test(m.meta.zoomHint) === false) {
  check('缩放声明', 'FAIL', `zoomHint="${m.meta.zoomHint}"：不得以缩放/缩放仿真冒称精确尺寸（如需按 402 判定请提供真实 CSS viewport 量测）`);
}

// 1) viewport
const vp = m.viewport;
const widthOk = Math.abs((vp.cssWidth ?? -999) - 402) <= 2;
const heightOk = (vp.cssHeight ?? 0) >= 800;
check('viewport 402×874 基准', widthOk && heightOk ? 'PASS' : 'FAIL',
  `cssWidth=${vp.cssWidth} cssHeight=${vp.cssHeight} dpr=${vp.dpr} visualViewport=${JSON.stringify(vp.visualViewport ?? null)}${widthOk && heightOk ? '' : '（目标 |402|≤2 且高≥800；实际值如实记录，不缩放替代）'}`);
if (!widthOk || !heightOk) check('DPR 真实性提醒', 'FAIL', `dpr=${vp.dpr}：真机目标 DPR3；仿真环境必须标注 SIMULATED，不得冒称真机`);

// 2) 整页滚动（Codex P1：整页滚动条 = 一屏不成立）
for (const p of m.pages ?? []) {
  const sh = p.scroll?.scrollHeight, ch = p.scroll?.clientHeight;
  const ok = typeof sh === 'number' && typeof ch === 'number' && sh <= ch + 1;
  check(`页面无整页滚动：${p.name}`, ok ? 'PASS' : 'FAIL', `scrollHeight=${sh} clientHeight=${ch}${ok ? '' : '（整页可滚动=首屏不成立；聊天区内滚动不算页面滚动）'}`);
}

// 3) 关键控件在初始视口内
for (const el of m.elements ?? []) {
  const r = el.rect ?? {};
  const ok = el.inInitialViewport === true && typeof r.y === 'number' && r.y >= 0;
  check(`控件可达：${el.id}${el.text ? '（' + el.text + '）' : ''}`, ok ? 'PASS' : 'FAIL',
    `rect=${JSON.stringify(r)} inInitialViewport=${el.inInitialViewport}${ok ? '' : '（需整页滚动才可达 → FAIL）'}`);
}

// 4) 首屏三项
const fsr = m.firstScreen ?? {};
for (const [k, label] of [['chatInputVisible', '首屏聊天输入可见'], ['fiveRowsVisible', '五行总览可见'], ['hangupReachable', '挂断键免滚动可达']]) {
  check(label, fsr[k] === true ? 'PASS' : 'FAIL', `${k}=${JSON.stringify(fsr[k])}`);
}

const hasFail = checks.some((c) => c.status === 'FAIL');
const hasBlocked = checks.some((c) => c.status === 'BLOCKED');
emit(hasBlocked ? 'BLOCKED' : hasFail ? 'FAIL' : 'PASS');

function emit(overall) {
  const report = {
    schema: 'mobile-verdict@1',
    overall,
    checks,
    summary: `${checks.filter((c) => c.status === 'PASS').length} PASS / ${checks.filter((c) => c.status === 'FAIL').length} FAIL / ${checks.filter((c) => c.status === 'BLOCKED').length} BLOCKED`,
    declaration: '判定只依据原始 DOM 量测；截图仅为佐证。仿真环境量测标注 SIMULATED，真机 DPR3 另测（NOT TESTED 不冒称）。',
  };
  if (jsonOut) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`== 手机量测判定：${overall}（${report.summary}）`);
    for (const c of checks) console.log(`  [${c.status.padEnd(7)}] ${c.name} ｜ ${c.detail}`);
    console.log(`  ${report.declaration}`);
  }
  process.exit(overall === 'PASS' ? 0 : 3);
}
