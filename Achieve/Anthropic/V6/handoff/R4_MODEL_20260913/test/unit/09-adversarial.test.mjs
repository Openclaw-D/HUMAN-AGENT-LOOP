// 对抗验证(R2 重写,INTERFACE_R2 §4/§7):测试必须能抓住刻意注入的坏实现,
// 不能全靠固定成功断言。
//
// R2 关键变化:
//  - 一切可变输出(mutant 文件、adversarial-results.json)只写运行时输出目录
//    testOutputDir()(R2_MODEL_TEST_OUT_DIR 优先,缺省 <交付根>/runtime/<时间戳>-pid<pid>/),
//    绝不写交付根 evidence/,复跑测试不改任何冻结文件与 MANIFEST.json。
//  - mutation 分母固定为 7:mutant-A/B/C/D + wrapper-E/F/G(禁止用测试总数代替分母)。
//  - mutant-C/D 依赖 src 内锚点注释(由 Agent-DEDUPE / Agent-LIFECYCLE 放置):
//      mutant-C → src/dedupe.mjs      `// MUTATION-ANCHOR:EVICTION-SELECT`
//      mutant-D → src/adapter.mjs     `// MUTATION-ANCHOR:CACHE-REVALIDATE`
//    锚点缺失或锚点下方无变异目标时,该缺陷记 anchorFound:false 并计为未捕获
//    (分母仍计入),绝不静默跳过;变异机制本身由"假目标文件烟测"独立验证。
//
// 注入方式两类:
//  1. 源码变异(mutant):把 src 的守门/淘汰/复核逻辑变异为缺陷版本,写入运行时
//     mutants 目录后动态 import —— 模拟"实现者悄悄删掉守卫"的真实缺陷形态。
//  2. 行为包装(wrapper):包住好实现的结果,模拟实现层偷懒(失败标成功/自动重试/
//     缺 usage 记 0 释放/过期冒充现行)。
//
// 通过标准:好实现 S1–S14 全部场景零违规(套件不误伤);7 个注入缺陷各自在预期
// 场景被抓:A→S3,B→S4,C→S11,D→S12,E→S9,F→S10,G→S12。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { createModelAdapter } from '../../src/adapter.mjs';
import { runProtocolSuite } from '../contract-assertions.mjs';
import { testOutputDir } from '../helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const deliverRoot = path.resolve(here, '..', '..');
const outDir = testOutputDir(); // 运行时输出目录:本进程所有可变输出只写这里
const mutantsDir = path.join(outDir, 'mutants');
mkdirSync(mutantsDir, { recursive: true });
// mutants 目录 → src 目录的相对引用(动态计算,兼容 R2_MODEL_TEST_OUT_DIR 指向任意位置)
const relSrc = path.relative(mutantsDir, path.join(deliverRoot, 'src')).split(path.sep).join('/');

const ANCHOR_EVICTION = '// MUTATION-ANCHOR:EVICTION-SELECT';
const ANCHOR_REVALIDATE = '// MUTATION-ANCHOR:CACHE-REVALIDATE';

/** 注入缺陷清单(分母 = 7,INTERFACE_R2 §7)。 */
const DEFECTS = [
  { id: 'mutant-A', target: 'src/validate-response.mjs 悬空引用检查', expectedScenario: 'S3' },
  { id: 'mutant-B', target: 'src/validate-response.mjs 越权批准拦截(四处)', expectedScenario: 'S4' },
  { id: 'mutant-C', target: 'src/dedupe.mjs EVICTION-SELECT 淘汰候选判定', expectedScenario: 'S11' },
  { id: 'mutant-D', target: 'src/adapter.mjs CACHE-REVALIDATE:短路锚点之后全部 stalenessOf 调用(实际同时中和返回时核对,影响面如实记录;抓捕场景 S8+S12)', expectedScenario: 'S12' },
  { id: 'wrapper-E', target: 'unknown 自动重试(至多5次)', expectedScenario: 'S9' },
  { id: 'wrapper-F', target: '缺 usage 记 0 并释放预留', expectedScenario: 'S10' },
  { id: 'wrapper-G', target: '缓存命中(deduped)的 stale 改标 succeeded', expectedScenario: 'S12' },
];

const defectResults = new Map(); // id -> { caught, caughtBy, anchorFound, note? }
let goodImplViolations = -1;

/** 锚点计数校验式替换(R1 沿用):出现次数不足 minCount 视为锚点漂移,直接失败。 */
function mutate(src, from, to, minCount) {
  const count = src.split(from).length - 1;
  assert.ok(count >= minCount, `mutant 锚点漂移:「${from}」出现 ${count} 次,预期 >= ${minCount};测试需随源码演进而更新`);
  return src.split(from).join(to);
}

/**
 * mutant-C 机制(INTERFACE_R2 §1):定位锚点下方第一个 if 判定并变异为恒真,
 * 即"无条件可选",使淘汰可能命中 in-flight 条目(复现 R1 容量淘汰缺陷)。
 * 锚点缺失 → anchorFound:false;锚点下方无 if → mutated:false;均不静默。
 */
function mutateFirstIfAlwaysTrue(src, anchor) {
  const anchorIdx = src.indexOf(anchor);
  if (anchorIdx === -1) {
    return { anchorFound: false, mutated: false, out: src, detail: `锚点缺失:${anchor}` };
  }
  const rest = src.slice(anchorIdx + anchor.length);
  const m = rest.match(/if\s*\(/);
  if (!m) {
    return { anchorFound: true, mutated: false, out: src, detail: '锚点下方未找到 if 判定(变异目标缺失)' };
  }
  const insertAt = anchorIdx + anchor.length + m.index + m[0].length;
  return {
    anchorFound: true,
    mutated: true,
    out: `${src.slice(0, insertAt)}true || ${src.slice(insertAt)}`,
    detail: '已把锚点下方第一个 if 判定变异为恒真(无条件可选)',
  };
}

/**
 * mutant-D 机制(INTERFACE_R2 §2):短路锚点之后的缓存复核调用
 * (stalenessOf → 恒返回 null 的空函数),使缓存命中不复核、旧结果直接呈现。
 * 锚点缺失或其后无 stalenessOf 调用 → 显式报告,不静默。
 */
function mutateSkipRevalidate(src, anchor) {
  const anchorIdx = src.indexOf(anchor);
  if (anchorIdx === -1) {
    return { anchorFound: false, mutated: false, out: src, detail: `锚点缺失:${anchor}` };
  }
  const head = src.slice(0, anchorIdx + anchor.length);
  const rest = src.slice(anchorIdx + anchor.length);
  if (!rest.includes('stalenessOf')) {
    return { anchorFound: true, mutated: false, out: src, detail: '锚点之后未找到 stalenessOf 复核调用(变异目标缺失)' };
  }
  const patched = rest.split('stalenessOf').join('MUTANT_D_NEUTRALIZED');
  return {
    anchorFound: true,
    mutated: true,
    out: `${head}${patched}\n\n// mutant-D 注入:缓存复核调用被短路,恒判定"未过期"(缺陷复现)\nfunction MUTANT_D_NEUTRALIZED() { return null; }\n`,
    detail: '已短路锚点之后的缓存复核调用',
  };
}

/** 把模块内相对导入('./x.mjs')改写到 mutants 目录可解析的位置;depOverrides 指定个别模块改用变异副本。 */
function rewireModuleImports(src, depOverrides = {}) {
  return src.replace(/(from\s+)['"]\.\/([^'"]+)['"]/g, (whole, fromKw, dep) => (
    Object.prototype.hasOwnProperty.call(depOverrides, dep)
      ? `${fromKw}'./${depOverrides[dep]}'`
      : `${fromKw}'${relSrc}/${dep}'`
  ));
}

/** mutant-A/B:变异 validate-response 副本 + 改写 adapter 导入,组装坏实现。 */
async function loadValidateMutantAdapter(name, validateResponseMutation) {
  const validateSrc = readFileSync(path.join(deliverRoot, 'src', 'validate-response.mjs'), 'utf8');
  const mutatedValidate = rewireModuleImports(validateResponseMutation(validateSrc));
  writeFileSync(path.join(mutantsDir, `validate-response.${name}.mjs`), mutatedValidate, 'utf8');

  const adapterSrc = rewireModuleImports(
    readFileSync(path.join(deliverRoot, 'src', 'adapter.mjs'), 'utf8'),
    { 'validate-response.mjs': `validate-response.${name}.mjs` },
  );
  const adapterPath = path.join(mutantsDir, `adapter.${name}.mjs`);
  writeFileSync(adapterPath, adapterSrc, 'utf8');
  const mod = await import(pathToFileURL(adapterPath).href);
  return mod.createModelAdapter;
}

/** mutant-C:变异 dedupe 淘汰候选判定 + 改写 adapter 导入指向变异副本。锚点缺失返回 { error }。 */
async function loadMutantCAdapter() {
  const dedupeSrc = readFileSync(path.join(deliverRoot, 'src', 'dedupe.mjs'), 'utf8');
  const m = mutateFirstIfAlwaysTrue(dedupeSrc, ANCHOR_EVICTION);
  if (!m.mutated) return { error: m.detail, anchorFound: m.anchorFound };
  // 变异副本自身的相对导入(codes.mjs 等)也要改写到 ../../src/,否则 mutants 目录内无法解析
  writeFileSync(path.join(mutantsDir, 'dedupe.mutant-C.mjs'), rewireModuleImports(m.out), 'utf8');
  const adapterSrc = rewireModuleImports(
    readFileSync(path.join(deliverRoot, 'src', 'adapter.mjs'), 'utf8'),
    { 'dedupe.mjs': 'dedupe.mutant-C.mjs' },
  );
  const adapterPath = path.join(mutantsDir, 'adapter.mutant-C.mjs');
  writeFileSync(adapterPath, adapterSrc, 'utf8');
  const mod = await import(pathToFileURL(adapterPath).href);
  return { createModelAdapter: mod.createModelAdapter };
}

/** mutant-D:短路 adapter 缓存复核调用。锚点缺失返回 { error }。 */
async function loadMutantDAdapter() {
  const adapterRaw = readFileSync(path.join(deliverRoot, 'src', 'adapter.mjs'), 'utf8');
  const m = mutateSkipRevalidate(adapterRaw, ANCHOR_REVALIDATE);
  if (!m.mutated) return { error: m.detail, anchorFound: m.anchorFound };
  const adapterSrc = rewireModuleImports(m.out);
  const adapterPath = path.join(mutantsDir, 'adapter.mutant-D.mjs');
  writeFileSync(adapterPath, adapterSrc, 'utf8');
  const mod = await import(pathToFileURL(adapterPath).href);
  return { createModelAdapter: mod.createModelAdapter };
}

/** 运行一个注入缺陷的完整协议套件,记录抓捕场景(含预期场景判定与锚点状态)。 */
async function runDefect(id, buildAdapter, { anchorFound = true, note } = {}) {
  const violations = await runProtocolSuite(buildAdapter);
  const caughtBy = [...new Set(violations.map((v) => v.scenario))];
  const expected = DEFECTS.find((d) => d.id === id).expectedScenario;
  const caught = caughtBy.includes(expected);
  defectResults.set(id, { caught, caughtBy, anchorFound, ...(note ? { note } : {}) });
  return { caught, caughtBy };
}

console.log(`[09] 运行时输出目录(可变输出只写这里,不碰 evidence/):${outDir}`);

test('好实现:协议套件 S1–S14 全部场景零违规(套件不得误伤正确行为)', async () => {
  const violations = await runProtocolSuite((deps) => createModelAdapter(deps));
  goodImplViolations = violations.length;
  assert.deepEqual(violations, [], `好实现不应有违规:${JSON.stringify(violations, null, 2)}`);
});

test('mutant-A 删除悬空引用检查 → 协议套件在 S3 抓住', async () => {
  const buildAdapter = await loadValidateMutantAdapter('mutant-A-skip-dangling', (src) =>
    mutate(src, 'if (!knownRefs.has(refKey)) {', 'if (false) { // MUTANT-A: deliberately skip dangling check', 1));
  const { caught, caughtBy } = await runDefect('mutant-A', buildAdapter);
  assert.equal(caught, true, `删除证据核查必须被 S3 抓住;实际抓捕场景:${JSON.stringify(caughtBy)}`);
});

test('mutant-B 删除越权批准拦截(四处)→ 协议套件在 S4 抓住', async () => {
  const buildAdapter = await loadValidateMutantAdapter('mutant-B-allow-approval', (src) => {
    let out = mutate(src, 'if (forbiddenKeyHit !== undefined) {', 'if (false) { // MUTANT-B: allow decision keys', 1);
    out = mutate(out, 'if (approvalTextHit) {', 'if (false) { // MUTANT-B: allow approval wording', 1);
    out = mutate(out, 'if (hit) {', 'if (false) { // MUTANT-B: allow approval in findings', 1);
    out = mutate(out, 'if (qHit) {', 'if (false) { // MUTANT-B: allow approval in questions', 1);
    return out;
  });
  const { caught, caughtBy } = await runDefect('mutant-B', buildAdapter);
  assert.equal(caught, true, `放行越权批准必须被 S4 抓住;实际抓捕场景:${JSON.stringify(caughtBy)}`);
});

test('mutant-C 淘汰候选判定恒真(可命中在途)→ 协议套件在 S11 抓住', async () => {
  const loaded = await loadMutantCAdapter();
  if (!loaded.createModelAdapter) {
    // 锚点缺失/变异目标缺失:计为未捕获(分母仍计入),绝不静默跳过
    defectResults.set('mutant-C', { caught: false, caughtBy: [], anchorFound: false, note: loaded.error });
    assert.fail(`mutant-C 未能注入:${loaded.error}(待 Agent-DEDUPE 在 src/dedupe.mjs 放置锚点后整合复验)`);
  }
  const { caught, caughtBy } = await runDefect('mutant-C', loaded.createModelAdapter);
  assert.equal(caught, true, `无条件淘汰(可命中在途)必须被 S11 抓住;实际抓捕场景:${JSON.stringify(caughtBy)}`);
});

test('mutant-D 短路缓存复核 → 协议套件在 S12 抓住', async () => {
  const loaded = await loadMutantDAdapter();
  if (!loaded.createModelAdapter) {
    defectResults.set('mutant-D', { caught: false, caughtBy: [], anchorFound: false, note: loaded.error });
    assert.fail(`mutant-D 未能注入:${loaded.error}(待 Agent-LIFECYCLE 在 src/adapter.mjs 放置锚点后整合复验)`);
  }
  const { caught, caughtBy } = await runDefect('mutant-D', loaded.createModelAdapter);
  assert.equal(caught, true, `跳过缓存复核必须被 S12 抓住;实际抓捕场景:${JSON.stringify(caughtBy)}`);
});

test('wrapper-E unknown 自动重试(至多5次)→ 在 S9 抓住(transport 调用被放大)', async () => {
  const buildAdapter = (deps) => {
    const adapter = createModelAdapter(deps);
    return {
      ...adapter,
      analyze: async (req, ctx) => {
        let r = await adapter.analyze(req, ctx);
        let tries = 0;
        while (r.status === 'unknown' && tries < 5) {
          tries += 1;
          r = await adapter.analyze(req, ctx); // 坏行为:未知状态自动重试
        }
        return r;
      },
    };
  };
  const { caught, caughtBy } = await runDefect('wrapper-E', buildAdapter);
  assert.equal(caught, true, `unknown 自动重试必须被 S9 抓住;实际抓捕场景:${JSON.stringify(caughtBy)}`);
});

test('wrapper-F 缺 usage 记 0 并释放预留 → 在 S10 抓住', async () => {
  const buildAdapter = (deps) => {
    const adapter = createModelAdapter(deps);
    const ledger = deps.ledger;
    return {
      ...adapter,
      analyze: async (req, ctx) => {
        const r = await adapter.analyze(req, ctx);
        if (r.usageUnknown === true) {
          const hold = ledger.entries().find((e) => e.state === 'unknown_hold' && e.requestId === req.requestId);
          if (hold) ledger.commit({ reservationId: hold.id, usageTokens: 0, note: 'DEFECT: 缺 usage 记 0' });
          return { ...r, usageUnknown: false, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, providerReported: false } };
        }
        return r;
      },
    };
  };
  const { caught, caughtBy } = await runDefect('wrapper-F', buildAdapter);
  assert.equal(caught, true, `缺 usage 记 0/释放必须被 S10 抓住;实际抓捕场景:${JSON.stringify(caughtBy)}`);
});

test('wrapper-G 缓存命中(deduped)的 stale 改标 succeeded → 在 S12 抓住', async () => {
  const buildAdapter = (deps) => {
    const adapter = createModelAdapter(deps);
    return {
      ...adapter,
      analyze: async (req, ctx) => {
        const r = await adapter.analyze(req, ctx);
        // 缺陷:缓存命中(deduped:true)的过期结果被改标 succeeded,旧结果冒充现行
        if (r.deduped === true && r.status === 'stale') return { ...r, status: 'succeeded', error: null };
        return r;
      },
    };
  };
  const { caught, caughtBy } = await runDefect('wrapper-G', buildAdapter);
  assert.equal(caught, true, `缓存过期结果冒充现行必须被 S12 抓住;实际抓捕场景:${JSON.stringify(caughtBy)}`);
});

test('变异机制烟测:对运行时目录中的假目标文件验证 锚点查找→变异→动态导入→行为改变', async () => {
  // 样本1:EVICTION 锚点下方第一个 if 变异为恒真后,候选判定行为必须改变
  const sampleEvictionSrc = [
    '// 冒烟样本(仅验证变异机制本身,不参与交付语义)。',
    'export function selectVictim(list) {',
    '  for (const item of list) {',
    '    // MUTATION-ANCHOR:EVICTION-SELECT',
    '    if (!item.usable) continue;',
    '    return item;',
    '  }',
    '  return null;',
    '}',
    '',
  ].join('\n');
  const m1 = mutateFirstIfAlwaysTrue(sampleEvictionSrc, ANCHOR_EVICTION);
  assert.equal(m1.anchorFound, true, '烟测样本锚点必须能找到');
  assert.equal(m1.mutated, true, '烟测样本锚点下方第一个 if 必须能被变异');
  assert.ok(m1.out.includes('if (true || !item.usable)'), `恒真变异结果不符:\n${m1.out}`);
  const p1 = path.join(mutantsDir, 'selfcheck-eviction-sample.mjs');
  writeFileSync(p1, m1.out, 'utf8');
  const mod1 = await import(pathToFileURL(p1).href);
  // 原语义:跳过不可用项选中可用项;变异语义:恒真 continue → 全部跳过返回 null
  assert.equal(mod1.selectVictim([{ usable: false }, { usable: true }]), null, '变异后 selectVictim 行为未改变,变异机制失效');

  // 锚点缺失必须显式报告(计为未捕获的前提),不得静默跳过
  const m2 = mutateFirstIfAlwaysTrue('export function noAnchor() { return 1; }\n', ANCHOR_EVICTION);
  assert.equal(m2.anchorFound, false, '锚点缺失必须显式报告');
  assert.equal(m2.mutated, false, '锚点缺失时不得产出变异文件');
  const m2b = mutateFirstIfAlwaysTrue(`${ANCHOR_EVICTION}\nconst x = 1;\n`, ANCHOR_EVICTION);
  assert.equal(m2b.anchorFound, true, '锚点存在时 anchorFound 必须为 true');
  assert.equal(m2b.mutated, false, '锚点下方无 if 判定时必须报告变异目标缺失');

  // 样本2:CACHE-REVALIDATE 锚点之后 stalenessOf 被短路后,复核必须恒返回 null
  // (定义在锚点之前,模拟 adapter.mjs 真实结构:变异只替换锚点之后的调用,不触碰定义)
  const sampleRevalidateSrc = [
    '// 冒烟样本(仅验证变异机制本身)。',
    'export function revalidate(req) {',
    '  function stalenessOf(r) { return r && r.stale ? { code: "GENERATION_CHANGED" } : null; }',
    '  // MUTATION-ANCHOR:CACHE-REVALIDATE',
    '  return stalenessOf(req);',
    '}',
    '',
  ].join('\n');
  const m3 = mutateSkipRevalidate(sampleRevalidateSrc, ANCHOR_REVALIDATE);
  assert.equal(m3.anchorFound, true, '烟测样本锚点必须能找到');
  assert.equal(m3.mutated, true, '烟测样本锚点之后的复核调用必须能被短路');
  assert.ok(m3.out.includes('MUTANT_D_NEUTRALIZED'), `复核短路变异结果不符:\n${m3.out}`);
  const p3 = path.join(mutantsDir, 'selfcheck-revalidate-sample.mjs');
  writeFileSync(p3, m3.out, 'utf8');
  const mod3 = await import(pathToFileURL(p3).href);
  assert.deepEqual(mod3.revalidate({ stale: true }), null, '变异后 revalidate 必须恒返回 null(不复核)');
  assert.deepEqual(mod3.revalidate({ stale: false }), null, '变异后 revalidate 必须恒返回 null(不复核)');

  // 样本3:锚点之后的 stalenessOf 才被短路;锚点之前的调用不得受影响(mutant-D 精确性)
  // (定义同样在锚点之前,避免"定义与注入桩重名"——那是变异面泄漏,不是变异语义)
  const sampleScopedSrc = [
    'function stalenessOf(req) { return req && req.stale ? { code: "GENERATION_CHANGED" } : null; }',
    'export function earlyCheck(req) { return stalenessOf(req); }',
    `  ${ANCHOR_REVALIDATE}`,
    'export function lateCheck(req) { return stalenessOf(req); }',
    '',
  ].join('\n');
  const m4 = mutateSkipRevalidate(sampleScopedSrc, ANCHOR_REVALIDATE);
  assert.ok(!m4.out.slice(0, m4.out.indexOf(ANCHOR_REVALIDATE)).includes('MUTANT_D_NEUTRALIZED'), '锚点之前的调用不得被变异');
  const p4 = path.join(mutantsDir, 'selfcheck-revalidate-scoped.mjs');
  writeFileSync(p4, m4.out, 'utf8');
  const mod4 = await import(pathToFileURL(p4).href);
  assert.deepEqual(mod4.earlyCheck({ stale: true }), { code: 'GENERATION_CHANGED' }, '锚点之前的复核行为必须保持原样');
  assert.deepEqual(mod4.lateCheck({ stale: true }), null, '锚点之后的复核必须被短路');
});

test('对抗汇总:分母=7 全部在预期场景被抓且好实现零违规;报告写入 <运行时输出目录>/adversarial-results.json', async () => {
  const defects = {};
  let caught = 0;
  for (const d of DEFECTS) {
    const r = defectResults.get(d.id) || { caught: false, caughtBy: [], anchorFound: false, note: '该缺陷未执行(测试框架内部错误)' };
    defects[d.id] = {
      target: d.target,
      expectedScenario: d.expectedScenario,
      caught: r.caught,
      anchorFound: r.anchorFound !== false,
      caughtBy: r.caughtBy,
      ...(r.note ? { note: r.note } : {}),
    };
    if (r.caught) caught += 1;
  }
  const report = {
    generatedAt: new Date().toISOString(),
    summary: {
      injected: DEFECTS.length,
      caught,
      ratio: `${caught}/${DEFECTS.length}`,
      goodImplViolations,
    },
    defects,
  };
  const reportPath = path.join(outDir, 'adversarial-results.json');
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`[09] 对抗结果报告:${reportPath}`);
  assert.equal(goodImplViolations, 0, `好实现必须 S1–S14 零违规,实际 ${goodImplViolations} 项(若为整合期,见各场景违规说明)`);
  assert.equal(
    caught,
    DEFECTS.length,
    `全部 ${DEFECTS.length} 个注入缺陷必须各自在预期场景被抓,实际 ${caught}/${DEFECTS.length}:\n${JSON.stringify(defects, null, 2)}`,
  );
});
