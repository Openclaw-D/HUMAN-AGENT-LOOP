// 对抗验证:测试必须能抓住刻意注入的坏实现,不能全靠固定成功断言。
//
// 注入方式两类:
//  1. 源码变异(mutant):把 src/validate-response.mjs 的守门分支替换为直通,
//     与 src/adapter.mjs 组装成"坏实现"写入 evidence/mutants/ 后动态 import。
//     —— 模拟"实现者悄悄删掉校验"这一真实缺陷形态,验证协议套件抓得住。
//  2. 行为包装(wrapper):包住好实现的结果,模拟"失败标成功/无限重试/
//     缺 usage 记 0 释放"等实现层偷懒。
//
// 通过标准:好实现必须零违规(套件不误伤);每个注入缺陷至少被一个场景抓到。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { createModelAdapter } from '../../src/adapter.mjs';
import { runProtocolSuite } from '../contract-assertions.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const deliverRoot = path.resolve(here, '..', '..');
const mutantsDir = path.join(deliverRoot, 'evidence', 'mutants');
mkdirSync(mutantsDir, { recursive: true });

function mutate(src, from, to, minCount) {
  const count = src.split(from).length - 1;
  assert.ok(count >= minCount, `mutant 锚点漂移:「${from}」出现 ${count} 次,预期 >= ${minCount};测试需随源码演进而更新`);
  return src.split(from).join(to);
}

/** 组装 mutant 版 adapter 模块文件并返回其 createModelAdapter。 */
async function loadMutantAdapter(name, validateResponseMutation) {
  const validateSrc = readFileSync(path.join(deliverRoot, 'src', 'validate-response.mjs'), 'utf8');
  let mutatedValidate = validateResponseMutation(validateSrc);
  mutatedValidate = mutate(mutatedValidate, "from './codes.mjs'", "from '../../src/codes.mjs'", 1);
  writeFileSync(path.join(mutantsDir, `validate-response.${name}.mjs`), mutatedValidate, 'utf8');

  let adapterSrc = readFileSync(path.join(deliverRoot, 'src', 'adapter.mjs'), 'utf8');
  for (const dep of ['validate-request.mjs', 'ledger.mjs', 'dedupe.mjs', 'clock.mjs', 'codes.mjs']) {
    adapterSrc = mutate(adapterSrc, `from './${dep}'`, `from '../../src/${dep}'`, 1);
  }
  adapterSrc = mutate(adapterSrc, `from './validate-response.mjs'`, `from './validate-response.${name}.mjs'`, 1);
  const adapterPath = path.join(mutantsDir, `adapter.${name}.mjs`);
  writeFileSync(adapterPath, adapterSrc, 'utf8');

  const mod = await import(pathToFileURL(adapterPath).href);
  return mod.createModelAdapter;
}

function violationsInclude(violations, scenario) {
  return violations.some((v) => v.scenario === scenario);
}

test('好实现:协议套件零违规(套件不得误伤正确行为)', async () => {
  const violations = await runProtocolSuite((deps) => createModelAdapter(deps));
  assert.deepEqual(violations, [], `好实现不应有违规:${JSON.stringify(violations, null, 2)}`);
});

test('mutant-A 删除悬空引用检查 → 协议套件在 S3 抓住', async () => {
  const buildAdapter = await loadMutantAdapter('mutant-A-skip-dangling', (src) =>
    mutate(src, 'if (!knownRefs.has(refKey)) {', 'if (false) { // MUTANT-A: deliberately skip dangling check', 1));
  const violations = await runProtocolSuite(buildAdapter);
  const caught = violationsInclude(violations, 'S3');
  assert.equal(caught, true, `删除证据核查必须被 S3 抓住;实际违规:${JSON.stringify(violations)}`);
});

test('mutant-B 删除越权批准拦截 → 协议套件在 S4 抓住', async () => {
  const buildAdapter = await loadMutantAdapter('mutant-B-allow-approval', (src) => {
    let out = mutate(src, 'if (forbiddenKeyHit !== undefined) {', 'if (false) { // MUTANT-B: allow decision keys', 1);
    out = mutate(out, 'if (approvalTextHit) {', 'if (false) { // MUTANT-B: allow approval wording', 1);
    out = mutate(out, 'if (hit) {', 'if (false) { // MUTANT-B: allow approval in findings', 1);
    out = mutate(out, 'if (qHit) {', 'if (false) { // MUTANT-B: allow approval in questions', 1);
    return out;
  });
  const violations = await runProtocolSuite(buildAdapter);
  const caught = violationsInclude(violations, 'S4');
  assert.equal(caught, true, `放行越权批准必须被 S4 抓住;实际违规:${JSON.stringify(violations)}`);
});

test('wrapper-C 把 failed 改标 succeeded(失败伪装成功)→ 在 S2 抓住', async () => {
  const buildAdapter = (deps) => {
    const adapter = createModelAdapter(deps);
    return {
      ...adapter,
      analyze: async (req, ctx) => {
        const r = await adapter.analyze(req, ctx);
        if (r.status === 'failed') {
          return { ...r, status: 'succeeded', error: null };
        }
        return r;
      },
    };
  };
  const violations = await runProtocolSuite(buildAdapter);
  assert.equal(violationsInclude(violations, 'S2'), true, `失败伪装成功必须被 S2 抓住;实际:${JSON.stringify(violations)}`);
});

test('wrapper-D 把 stale 改标 succeeded(过期冒充现行)→ 在 S8 抓住', async () => {
  const buildAdapter = (deps) => {
    const adapter = createModelAdapter(deps);
    return {
      ...adapter,
      analyze: async (req, ctx) => {
        const r = await adapter.analyze(req, ctx);
        if (r.status === 'stale') return { ...r, status: 'succeeded', error: null };
        return r;
      },
    };
  };
  const violations = await runProtocolSuite(buildAdapter);
  assert.equal(violationsInclude(violations, 'S8'), true, `过期冒充现行必须被 S8 抓住;实际:${JSON.stringify(violations)}`);
});

test('wrapper-E unknown 自动重试 → 在 S9 抓住(transport 调用被放大)', async () => {
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
  const violations = await runProtocolSuite(buildAdapter);
  assert.equal(violationsInclude(violations, 'S9'), true, `unknown 自动重试必须被 S9 抓住;实际:${JSON.stringify(violations)}`);
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
  const violations = await runProtocolSuite(buildAdapter);
  assert.equal(violationsInclude(violations, 'S10'), true, `缺 usage 记 0/释放必须被 S10 抓住;实际:${JSON.stringify(violations)}`);
});

test('对抗汇总:每个注入缺陷至少被抓一次,结果写入 evidence/adversarial-results.json', async () => {
  const defects = {};

  async function check(name, buildAdapter, expectScenarios) {
    const violations = await runProtocolSuite(buildAdapter);
    const caughtScenarios = expectScenarios.filter((s) => violationsInclude(violations, s));
    defects[name] = {
      expectedScenarios: expectScenarios,
      caughtScenarios,
      caught: caughtScenarios.length > 0,
      allViolations: violations,
    };
    return caughtScenarios.length > 0;
  }

  const results = [];
  results.push(await check('good-implementation', (deps) => createModelAdapter(deps), []));
  assert.equal(results[0] === false || true, true); // 好实现:记录即可,零违规在上一用例断言

  const mutantA = await loadMutantAdapter('mutant-A-skip-dangling', (src) =>
    mutate(src, 'if (!knownRefs.has(refKey)) {', 'if (false) { // MUTANT-A: deliberately skip dangling check', 1));
  await check('mutant-A-skip-dangling-check', mutantA, ['S3']);

  const mutantB = await loadMutantAdapter('mutant-B-allow-approval', (src) => {
    let out = mutate(src, 'if (forbiddenKeyHit !== undefined) {', 'if (false) { // MUTANT-B: allow decision keys', 1);
    out = mutate(out, 'if (approvalTextHit) {', 'if (false) { // MUTANT-B: allow approval wording', 1);
    out = mutate(out, 'if (hit) {', 'if (false) { // MUTANT-B: allow approval in findings', 1);
    out = mutate(out, 'if (qHit) {', 'if (false) { // MUTANT-B: allow approval in questions', 1);
    return out;
  });
  await check('mutant-B-allow-approval', mutantB, ['S4']);

  const wrapperC = (deps) => {
    const a = createModelAdapter(deps);
    return { ...a, analyze: async (r, c) => { const o = await a.analyze(r, c); return o.status === 'failed' ? { ...o, status: 'succeeded', error: null } : o; } };
  };
  await check('wrapper-C-failed-as-succeeded', wrapperC, ['S2', 'S3', 'S4']);

  const wrapperD = (deps) => {
    const a = createModelAdapter(deps);
    return { ...a, analyze: async (r, c) => { const o = await a.analyze(r, c); return o.status === 'stale' ? { ...o, status: 'succeeded', error: null } : o; } };
  };
  await check('wrapper-D-stale-as-succeeded', wrapperD, ['S8']);

  const wrapperE = (deps) => {
    const a = createModelAdapter(deps);
    return {
      ...a,
      analyze: async (r, c) => {
        let o = await a.analyze(r, c);
        let tries = 0;
        while (o.status === 'unknown' && tries < 5) { tries += 1; o = await a.analyze(r, c); }
        return o;
      },
    };
  };
  await check('wrapper-E-auto-retry-unknown', wrapperE, ['S9']);

  const wrapperF = (deps) => {
    const a = createModelAdapter(deps);
    const ledger = deps.ledger;
    return {
      ...a,
      analyze: async (req, ctx) => {
        const o = await a.analyze(req, ctx);
        if (o.usageUnknown === true) {
          const hold = ledger.entries().find((e) => e.state === 'unknown_hold' && e.requestId === req.requestId);
          if (hold) ledger.commit({ reservationId: hold.id, usageTokens: 0, note: 'DEFECT: zero' });
          return { ...o, usageUnknown: false, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, providerReported: false } };
        }
        return o;
      },
    };
  };
  await check('wrapper-F-zero-usage-release', wrapperF, ['S10']);

  const injected = Object.entries(defects).filter(([k]) => k !== 'good-implementation');
  const allCaught = injected.every(([, v]) => v.caught);
  const report = {
    generatedAt: new Date().toISOString(),
    summary: {
      injectedDefects: injected.length,
      allCaught,
      goodImplementationViolations: defects['good-implementation'].allViolations.length,
    },
    defects,
  };
  writeFileSync(path.join(deliverRoot, 'evidence', 'adversarial-results.json'), JSON.stringify(report, null, 2), 'utf8');
  assert.equal(report.summary.goodImplementationViolations, 0);
  assert.equal(allCaught, true, `每个注入缺陷必须被抓:${JSON.stringify(injected.map(([k, v]) => ({ k, caught: v.caught })))}`);
});
