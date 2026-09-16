#!/usr/bin/env node
// SE_REBUILD_20260913 · QA-C 交付物 2：/v5-preview HTTP 行为回归（node:test 风格，可独立 node 执行）。
// 运行方式（二选一）：
//   node behavior-regression.mjs [--base http://127.0.0.1:3467] [--out report.json]
//   node --experimental-strip-types --test --experimental-test-isolation=none qa/behavior-regression.mjs
// 覆盖（对应任务书）：
//   A. GET  /api/v5-preview/project     —— 结构关键字段（projectId/domains[4]/todo/overall/messages）
//   B. POST /api/v5-preview/messages    —— 同 requestId 幂等（第二次 replayed:true、不重复记账）；
//                                          附加：同 requestId 换载荷 → 409 REQUEST_MISMATCH
//   C. POST /api/v5-preview/messages    —— 错 expectedVersion → 409 VERSION_CONFLICT + serverVersion 校验
//   D. POST /api/v5-preview/notes       —— 无开放待办（settled）→ 409 NO_OPEN_TODO；
//                                          附加：成功路径（待补充→待复核、相关域待复核、+2 条消息）与
//                                          待复核后同 todoId 新 requestId → 404 NOT_FOUND
// 可重复运行：开头 POST demo/seed(approval) 复位；结尾再复位并做终态断言。requestId 前缀 qa-<timestamp>- 独立不污染。
// 输出：JSON 报告写入 --out（默认脚本目录 behavior-report.json，相对路径按脚本目录解析）；
//       任一步失败 → 进程 exit 1（node:test 失败语义一致）。
// 本脚本不修改任何产品文件；demo/seed 是产品自身提供的演示复位操作。

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const opts = { base: 'http://127.0.0.1:3467', out: join(SCRIPT_DIR, 'behavior-report.json') };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--base') opts.base = argv[++i];
    else if (a === '--out') opts.out = argv[++i];
    else {
      console.error(`未知参数：${a}（支持 --base/--out）`);
      process.exit(2);
    }
  }
  if (!isAbsolute(opts.out)) opts.out = join(process.cwd(), opts.out);
  opts.base = opts.base.replace(/\/+$/, '');
  return opts;
}

const OPTS = parseArgs(process.argv.slice(2));

const RUN_STAMP = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', 'T');
const RUN_SALT = randomBytes(3).toString('hex');
const REQUEST_PREFIX = `qa-${RUN_STAMP}-${RUN_SALT}`; // ≤64 字符约束内的唯一前缀
let idSeq = 0;
const newRequestId = (tag) => `${REQUEST_PREFIX}-${tag}-${(idSeq += 1)}`;

const REPORT = {
  script: 'behavior-regression.mjs',
  target: OPTS.base,
  requestPrefix: REQUEST_PREFIX,
  startedAt: new Date().toISOString(),
  finishedAt: null,
  steps: [],
  summary: null,
};

// ---------------------------------------------------------------------------
// HTTP 助手
// ---------------------------------------------------------------------------

async function call(method, path, body) {
  const started = Date.now();
  const res = await fetch(new URL(path, OPTS.base).toString(), {
    method,
    headers:
      body === undefined
        ? { accept: 'application/json' }
        : { 'content-type': 'application/json', accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, headers: res.headers, json, rawText: text.slice(0, 400), ms: Date.now() - started };
}

const getProject = () => call('GET', '/api/v5-preview/project');
const postMessage = (body) => call('POST', '/api/v5-preview/messages', body);
const postNote = (body) => call('POST', '/api/v5-preview/notes', body);
const postSeed = (scenario) => call('POST', '/api/v5-preview/demo/seed', { scenario });

// ---------------------------------------------------------------------------
// 步骤记录器：软断言（记录全部失败项，步骤末统一抛出），JSON 中逐步写清断言
// ---------------------------------------------------------------------------

function stringifySafe(v) {
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function beginStep(name) {
  const rec = { name, status: 'running', durationMs: null, assertions: [], detail: {}, error: null };
  REPORT.steps.push(rec);
  const check = (cond, label, actual) => {
    const pass = cond === true;
    rec.assertions.push(pass ? { label, pass } : { label, pass, actual: stringifySafe(actual) });
    return pass;
  };
  const checkEqual = (actual, expected, label) => check(actual === expected, `${label}（期望 ${stringifySafe(expected)}）`, actual);
  return { rec, check, checkEqual, failNow(label, actual) { check(false, label, actual); } };
}

function finishStep(s, t0) {
  const failed = s.rec.assertions.filter((a) => !a.pass);
  s.rec.durationMs = Date.now() - t0;
  if (failed.length > 0) {
    s.rec.status = 'fail';
    s.rec.error = failed.map((f) => f.label).join('；');
    assert.fail(`步骤「${s.rec.name}」${failed.length} 项断言失败：${s.rec.error}`);
  }
  s.rec.status = 'pass';
}

function step(name, fn) {
  test(name, { timeout: 60000 }, async () => {
    const s = beginStep(name);
    const t0 = Date.now();
    try {
      await fn(s);
      finishStep(s, t0);
    } catch (e) {
      s.rec.durationMs = Date.now() - t0;
      if (s.rec.status !== 'fail') {
        s.rec.status = 'fail';
        s.rec.error = String(e?.message ?? e);
        s.rec.assertions.push({ label: '步骤执行异常（未捕获）', pass: false, actual: s.rec.error });
      }
      throw e;
    }
  });
}

// ---------------------------------------------------------------------------
// 步骤 0（setup）：demo/seed approval 复位
// ---------------------------------------------------------------------------

before(async () => {
  const s = beginStep('setup: POST demo/seed approval 复位演示状态');
  const t0 = Date.now();
  try {
    const res = await postSeed('approval');
    s.checkEqual(res.status, 200, 'HTTP 200');
    s.check(res.json?.ok === true, '响应 ok:true', res.json);
    s.checkEqual(res.json?.overview?.scenario, 'approval', '复位后 scenario=approval');
    s.checkEqual(res.json?.overview?.todo?.id, 'todo-device-list', '复位后待办 id=todo-device-list');
    s.checkEqual(res.json?.overview?.todo?.status, '待补充', '复位后待办状态=待补充');
    s.rec.detail.versionAfterSeed = res.json?.overview?.version ?? null;
    finishStep(s, t0);
  } catch (e) {
    s.rec.durationMs = Date.now() - t0;
    s.rec.status = 'fail';
    s.rec.error = String(e?.message ?? e);
    if (s.rec.assertions.length === 0) s.rec.assertions.push({ label: 'setup 异常（实例不可达？）', pass: false, actual: s.rec.error });
    throw e;
  }
});

// ---------------------------------------------------------------------------
// A. GET /project 结构关键字段
// ---------------------------------------------------------------------------

step('A. GET /api/v5-preview/project 结构与关键字段', async (s) => {
  const res = await getProject();
  s.rec.detail.http = { status: res.status, ms: res.ms };
  s.checkEqual(res.status, 200, 'HTTP 200');
  const cacheControl = res.headers.get('cache-control') ?? '';
  s.check(cacheControl.includes('no-store'), '响应头 Cache-Control 含 no-store', cacheControl);

  const o = res.json;
  s.check(o !== null && typeof o === 'object', '响应为 JSON 对象', o);
  if (!s.rec.assertions.some((a) => !a.pass)) {
    s.checkEqual(o.projectId, 'JW-2026-018', 'projectId=JW-2026-018（合成种子契约）');
    s.check(typeof o.customerName === 'string' && o.customerName.length > 0, 'customerName 非空字符串', o.customerName);
    s.check(typeof o.projectCode === 'string' && o.projectCode.length > 0, 'projectCode 非空字符串', o.projectCode);
    s.check(['approval', 'post-rental', 'settled'].includes(o.scenario), 'scenario 属于三种演示情景', o.scenario);
    s.check(typeof o.version === 'number' && Number.isInteger(o.version) && o.version > 0, 'version 为正整数', o.version);
    s.check(typeof o.updatedAt === 'string' && !Number.isNaN(Date.parse(o.updatedAt)), 'updatedAt 为 ISO 时间', o.updatedAt);

    s.check(o.overall !== null && typeof o.overall === 'object', 'overall 存在', o.overall);
    s.check(typeof o.overall?.progressLabel === 'string' && o.overall.progressLabel.length > 0, 'overall.progressLabel 非空', o.overall?.progressLabel);
    s.check(typeof o.overall?.description === 'string' && o.overall.description.length > 0, 'overall.description 非空', o.overall?.description);

    s.check(Array.isArray(o.domains) && o.domains.length === 4, 'domains 恰好 4 条', o.domains?.length);
    const expectOrder = ['policy', 'credit', 'commerce', 'asset'];
    const actualOrder = (o.domains ?? []).map((d) => d?.domainId);
    s.checkEqual(actualOrder.join(','), expectOrder.join(','), 'domains 顺序=政策/信审/商务/资产');
    (o.domains ?? []).forEach((d, i) => {
      const tag = `domains[${i}](${d?.domainId})`;
      s.check(typeof d?.name === 'string' && d.name.length > 0, `${tag}.name 非空`, d?.name);
      s.check(Array.isArray(d?.segmentLabels) && d.segmentLabels.length === 4 && d.segmentLabels.every((x) => typeof x === 'string' && x.length > 0), `${tag}.segmentLabels 为 4 个非空字符串`, d?.segmentLabels);
      s.check(Array.isArray(d?.segments) && d.segments.length === 4 && d.segments.every((x) => ['done', 'current', 'pending'].includes(x)), `${tag}.segments 为 4 个合法段状态`, d?.segments);
      s.check(['green', 'yellow', 'red', 'gray'].includes(d?.judgmentStatus), `${tag}.judgmentStatus 合法`, d?.judgmentStatus);
      s.check(typeof d?.judgmentText === 'string' && d.judgmentText.length > 0, `${tag}.judgmentText 非空`, d?.judgmentText);
      s.check(typeof d?.summary === 'string' && d.summary.length > 0, `${tag}.summary 非空`, d?.summary);
    });

    s.check(o.todo === null || (typeof o.todo?.id === 'string' && typeof o.todo?.title === 'string' && typeof o.todo?.status === 'string'), 'todo 为 null 或含 id/title/status', o.todo);
    s.check(Array.isArray(o.messages) && o.messages.length >= 1, 'messages 为非空数组', o.messages?.length);
    (o.messages ?? []).forEach((m, i) => {
      const tag = `messages[${i}]`;
      s.check(typeof m?.id === 'string' && m.id.length > 0, `${tag}.id 非空`, m?.id);
      s.check(['business', 'domain', 'system'].includes(m?.fromKind), `${tag}.fromKind 合法`, m?.fromKind);
      s.check(typeof m?.text === 'string' && m.text.length > 0, `${tag}.text 非空`, m?.text?.slice?.(0, 40));
      s.check(typeof m?.at === 'string' && !Number.isNaN(Date.parse(m.at)), `${tag}.at 为 ISO 时间`, m?.at);
      s.check(Array.isArray(m?.marks) && m.marks.every((x) => typeof x === 'string'), `${tag}.marks 为字符串数组`, m?.marks);
    });
    s.rec.detail.snapshot = { scenario: o.scenario, version: o.version, todoId: o.todo?.id ?? null, todoStatus: o.todo?.status ?? null, messageCount: o.messages.length };
  }
});

// ---------------------------------------------------------------------------
// B. POST /messages 幂等 + REQUEST_MISMATCH
// ---------------------------------------------------------------------------

step('B. POST /api/v5-preview/messages 幂等（同 requestId 两次 + 换载荷 409）', async (s) => {
  const g0 = await getProject();
  s.checkEqual(g0.status, 200, '前置 GET 200');
  const baseVersion = g0.json?.version;
  const baseMsgCount = g0.json?.messages?.length;
  s.check(typeof baseVersion === 'number', '前置 GET 拿到 version', baseVersion);
  s.rec.detail.base = { version: baseVersion, messageCount: baseMsgCount };

  const rid = newRequestId('msg');
  const body1 = { requestId: rid, expectedVersion: baseVersion, text: 'qa-regression 幂等探测消息（合成演示，自动清理）', actorRole: 'business' };

  const r1 = await postMessage(body1);
  s.rec.detail.first = { status: r1.status, version: r1.json?.overview?.version, replayed: r1.json?.replayed ?? null };
  s.checkEqual(r1.status, 200, '第一次发送 HTTP 200');
  s.check(r1.json?.ok === true, '第一次发送 ok:true', r1.json);
  s.check(r1.json?.replayed !== true, '第一次发送非重放（replayed 不为 true）', r1.json?.replayed);
  s.checkEqual(r1.json?.overview?.version, baseVersion + 1, '第一次发送后 version=base+1');
  const afterFirstCount = r1.json?.overview?.messages?.length;
  s.checkEqual(afterFirstCount, baseMsgCount + 1, '消息数 +1');
  const bizMsgIds = (r1.json?.overview?.messages ?? []).filter((m) => m.id === `msg-biz-${rid}`);
  s.checkEqual(bizMsgIds.length, 1, `新消息 id=msg-biz-${rid} 恰好出现 1 次`);

  const r2 = await postMessage(body1);
  s.rec.detail.second = { status: r2.status, version: r2.json?.overview?.version, replayed: r2.json?.replayed ?? null };
  s.checkEqual(r2.status, 200, '同 requestId 重复发送 HTTP 200（幂等重放不报错）');
  s.check(r2.json?.ok === true, '重放响应 ok:true', r2.json);
  s.checkEqual(r2.json?.replayed, true, '重放响应 replayed:true');
  s.checkEqual(r2.json?.overview?.version, baseVersion + 1, '重放不重复记账：version 仍=base+1');
  s.checkEqual(r2.json?.overview?.messages?.length, afterFirstCount, '重放后消息数不增');

  const body3 = { ...body1, text: 'qa-regression 同 requestId 换载荷（应 409 REQUEST_MISMATCH）' };
  const r3 = await postMessage(body3);
  s.rec.detail.mismatch = { status: r3.status, error: r3.json?.error };
  s.checkEqual(r3.status, 409, '同 requestId 换载荷 HTTP 409');
  s.checkEqual(r3.json?.ok, false, '换载荷响应 ok:false', r3.json?.ok);
  s.checkEqual(r3.json?.error, 'REQUEST_MISMATCH', '错误码=REQUEST_MISMATCH');

  const g1 = await getProject();
  s.checkEqual(g1.json?.version, baseVersion + 1, '终态 GET：version=base+1（B 步无额外写入）');
  const finalCount = (g1.json?.messages ?? []).filter((m) => m.id === `msg-biz-${rid}`).length;
  s.checkEqual(finalCount, 1, '终态 GET：该 requestId 的消息仍只有 1 条');
  s.rec.detail.final = { version: g1.json?.version, messageCount: g1.json?.messages?.length };
});

// ---------------------------------------------------------------------------
// C. 错 expectedVersion → 409 VERSION_CONFLICT + serverVersion
// ---------------------------------------------------------------------------

step('C. POST /api/v5-preview/messages 错 expectedVersion → 409 VERSION_CONFLICT', async (s) => {
  const g0 = await getProject();
  s.checkEqual(g0.status, 200, '前置 GET 200');
  const currentVersion = g0.json?.version;
  const baseMsgCount = g0.json?.messages?.length;
  s.check(typeof currentVersion === 'number', '前置 GET 拿到 version', currentVersion);
  s.rec.detail.base = { version: currentVersion, messageCount: baseMsgCount };

  const rid = newRequestId('vc');
  const wrongVersion = currentVersion + 9;
  const r = await postMessage({ requestId: rid, expectedVersion: wrongVersion, text: 'qa-regression 版本冲突探测（不应入账）', actorRole: 'business' });
  s.rec.detail.conflict = { status: r.status, error: r.json?.error, serverVersion: r.json?.serverVersion, message: r.json?.message };
  s.checkEqual(r.status, 409, 'HTTP 409');
  s.checkEqual(r.json?.ok, false, 'ok:false', r.json?.ok);
  s.checkEqual(r.json?.error, 'VERSION_CONFLICT', '错误码=VERSION_CONFLICT');
  s.checkEqual(r.json?.serverVersion, currentVersion, `serverVersion=服务端当前版本(${currentVersion})`);
  s.check(typeof r.json?.message === 'string' && r.json.message.length > 0, 'message 为非空中文提示', r.json?.message);

  const g1 = await getProject();
  s.checkEqual(g1.json?.version, currentVersion, '冲突失败不写入：version 不变');
  s.checkEqual(g1.json?.messages?.length, baseMsgCount, '冲突失败不写入：消息数不变');
});

// ---------------------------------------------------------------------------
// D1. POST /notes 成功路径（待补充→待复核；相关域待复核不自动变绿）
// ---------------------------------------------------------------------------

step('D1. POST /api/v5-preview/notes 成功路径（approval，todo-device-list）', async (s) => {
  const g0 = await getProject();
  s.checkEqual(g0.status, 200, '前置 GET 200');
  const v = g0.json?.version;
  const beforeMsgCount = g0.json?.messages?.length;
  s.checkEqual(g0.json?.scenario, 'approval', '前置：scenario=approval');
  s.checkEqual(g0.json?.todo?.id, 'todo-device-list', '前置：待办 id=todo-device-list');
  s.checkEqual(g0.json?.todo?.status, '待补充', '前置：待办状态=待补充');
  s.rec.detail.base = { version: v, messageCount: beforeMsgCount, creditJudgmentText: g0.json?.domains?.[1]?.judgmentText };

  const rid = newRequestId('note');
  const r = await postNote({ requestId: rid, expectedVersion: v, todoId: 'todo-device-list', text: 'qa-regression 合成补充说明（演示；自动清理）。', actorRole: 'business' });
  s.rec.detail.write = { status: r.status, version: r.json?.overview?.version, replayed: r.json?.replayed ?? null };
  s.checkEqual(r.status, 200, 'HTTP 200');
  s.check(r.json?.ok === true, 'ok:true', r.json);
  s.check(r.json?.replayed !== true, '非重放', r.json?.replayed);
  const o = r.json?.overview;
  s.checkEqual(o?.version, v + 1, 'version=v+1');
  s.checkEqual(o?.todo?.status, '待复核', 'todo.status=待复核');
  const credit = (o?.domains ?? []).find((d) => d.domainId === 'credit');
  s.checkEqual(credit?.judgmentText, '待复核', '相关域（信审）judgmentText=待复核');
  s.checkEqual(credit?.judgmentStatus, 'yellow', '信审判断灯仍为 yellow（不自动变绿）');
  s.checkEqual(o?.messages?.length, beforeMsgCount + 2, '消息 +2（业务补充说明 + 系统记录）');
  s.check((o?.messages ?? []).some((m) => m.id === `msg-note-${rid}`), `存在 msg-note-${rid}`);
  s.check((o?.messages ?? []).some((m) => m.id === `msg-note-sys-${rid}`), `存在 msg-note-sys-${rid}`);
});

// ---------------------------------------------------------------------------
// D2. 待复核后同 todoId 新 requestId → 404 NOT_FOUND（待办不在可提交状态）
// ---------------------------------------------------------------------------

step('D2. POST /api/v5-preview/notes 待办已待复核（新 requestId）→ 404 NOT_FOUND', async (s) => {
  const g0 = await getProject();
  s.checkEqual(g0.status, 200, '前置 GET 200');
  const v = g0.json?.version;
  s.checkEqual(g0.json?.todo?.status, '待复核', '前置：待办状态=待复核（承接 D1）');
  s.rec.detail.base = { version: v, todoStatus: g0.json?.todo?.status };

  const r = await postNote({ requestId: newRequestId('note404'), expectedVersion: v, todoId: 'todo-device-list', text: 'qa-regression 待复核后再提交（应 404）。', actorRole: 'business' });
  s.rec.detail.write = { status: r.status, error: r.json?.error, message: r.json?.message };
  s.checkEqual(r.status, 404, 'HTTP 404');
  s.checkEqual(r.json?.ok, false, 'ok:false', r.json?.ok);
  s.checkEqual(r.json?.error, 'NOT_FOUND', '错误码=NOT_FOUND');
  s.check(typeof r.json?.message === 'string' && !r.json.message.includes('todo-device-list'), '提示语不含内部 todoId', r.json?.message);

  const g1 = await getProject();
  s.checkEqual(g1.json?.version, v, '失败不写入：version 不变');
});

// ---------------------------------------------------------------------------
// D3. settled（无开放待办）→ 409 NO_OPEN_TODO（任务书指定路径）
// ---------------------------------------------------------------------------

step('D3. POST /api/v5-preview/notes settled 无开放待办 → 409 NO_OPEN_TODO', async (s) => {
  const seed = await postSeed('settled');
  s.checkEqual(seed.status, 200, 'demo/seed settled HTTP 200');
  const g0 = await getProject();
  s.checkEqual(g0.status, 200, '前置 GET 200');
  const v = g0.json?.version;
  s.checkEqual(g0.json?.scenario, 'settled', '前置：scenario=settled');
  s.checkEqual(g0.json?.todo, null, '前置：todo=null（无开放待办）', g0.json?.todo);
  s.rec.detail.base = { version: v, scenario: g0.json?.scenario, todo: g0.json?.todo };

  const r = await postNote({ requestId: newRequestId('nosup'), expectedVersion: v, todoId: 'todo-device-list', text: 'qa-regression 已结清后提交补充说明（应 409 NO_OPEN_TODO）。', actorRole: 'business' });
  s.rec.detail.write = { status: r.status, error: r.json?.error, message: r.json?.message };
  s.checkEqual(r.status, 409, 'HTTP 409');
  s.checkEqual(r.json?.ok, false, 'ok:false', r.json?.ok);
  s.checkEqual(r.json?.error, 'NO_OPEN_TODO', '错误码=NO_OPEN_TODO');
  s.check(typeof r.json?.message === 'string' && r.json.message.length > 0, 'message 为非空中文提示', r.json?.message);
});

// ---------------------------------------------------------------------------
// cleanup：复位 approval + 终态断言 + 写报告
// ---------------------------------------------------------------------------

after(async () => {
  {
    const s = beginStep('cleanup: POST demo/seed approval 复位 + 终态校验');
    const t0 = Date.now();
    try {
      const seed = await postSeed('approval');
      s.checkEqual(seed.status, 200, '复位 seed HTTP 200');
      s.checkEqual(seed.json?.overview?.scenario, 'approval', '终态 scenario=approval');
      s.checkEqual(seed.json?.overview?.todo?.status, '待补充', '终态待办状态=待补充');
      const g = await getProject();
      s.checkEqual(g.status, 200, '终态 GET 200');
      s.checkEqual(g.json?.scenario, 'approval', '终态 GET scenario=approval');
      s.rec.detail.final = { version: g.json?.version, todoStatus: g.json?.todo?.status, messageCount: g.json?.messages?.length };
      finishStep(s, t0);
    } catch (e) {
      s.rec.durationMs = Date.now() - t0;
      s.rec.status = 'fail';
      s.rec.error = String(e?.message ?? e);
      if (s.rec.assertions.length === 0) s.rec.assertions.push({ label: 'cleanup 异常（实例不可达？）', pass: false, actual: s.rec.error });
      // cleanup 失败也继续写报告（不再向上抛，避免掩盖测试本体结果）。
      console.error(`[cleanup-fail] ${s.rec.error}`);
    }
  }

  REPORT.finishedAt = new Date().toISOString();
  const pass = REPORT.steps.filter((x) => x.status === 'pass').length;
  const fail = REPORT.steps.filter((x) => x.status === 'fail').length;
  REPORT.summary = { total: REPORT.steps.length, passed: pass, failed: fail, requestPrefix: REQUEST_PREFIX };
  try {
    await mkdir(dirname(OPTS.out), { recursive: true });
    await writeFile(OPTS.out, `${JSON.stringify(REPORT, null, 2)}\n`, 'utf8');
    console.error(`[behavior-regression] 报告已写入 ${OPTS.out}（pass ${pass} / fail ${fail}）`);
  } catch (e) {
    console.error(`[behavior-regression] 报告写入失败：${e?.message ?? e}`);
    process.exitCode = 1;
  }
  if (fail > 0) process.exitCode = 1;
});
