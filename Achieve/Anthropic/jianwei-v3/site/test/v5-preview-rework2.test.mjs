// V6 BATCH_2 rework-2 · F1/F2 请求归属一致性回归。
// 红证据 = 真实组件交互（evidence/repro/f1-both-channels-red.json，3399 生产页两通道失败）；
// 本文件提供纯逻辑真值表与接线断言，不替代真实交互验证（见 CHECKPOINTS/REPORT）。
// 运行：node --experimental-strip-types --test test/v5-preview-rework2.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const siteRoot = fileURLToPath(new URL('../', import.meta.url));
const dir = (p) => join(siteRoot, p);
const read = (p) => readFileSync(dir(p), 'utf8');

const logic = await import(pathToFileURL(dir('app/v5-preview/rows-logic.ts')).href);

// ---------------------------------------------------------------------------
// F1：清空资格属于"确定的请求 + 其发送时草稿修订"（requestId 绑定，非"最近一次点击"）
// ---------------------------------------------------------------------------

const ASSOC_A = { requestId: 'rid-A', revision: 0 };

test('F1 shouldClearDraftForRequest：确认 A 只能按 A 自己的关联与未变修订清空', () => {
  // 正常：确认 A、草稿仍是 A 发送时的修订 → 清。
  assert.equal(logic.shouldClearDraftForRequest(ASSOC_A, 'rid-A', 0), true);
  // 被阻断的 B 建立了更高修订（关联仍是 A）→ 确认 A 不得清 B（F1 主缺陷）。
  assert.equal(logic.shouldClearDraftForRequest(ASSOC_A, 'rid-A', 1), false);
  // A→B→A：字符串相同但修订前进 → 不清。
  assert.equal(logic.shouldClearDraftForRequest(ASSOC_A, 'rid-A', 2), false);
  // 确认的是别的请求（如恢复入口确认了已取代的请求）→ 不清。
  assert.equal(logic.shouldClearDraftForRequest(ASSOC_A, 'rid-B', 0), false);
  // 无关联（刷新恢复后未在本会话提交过）→ 不清（草稿本为空）。
  assert.equal(logic.shouldClearDraftForRequest(null, 'rid-A', 0), false);
  // 确认结果未携带 requestId → 不清。
  assert.equal(logic.shouldClearDraftForRequest(ASSOC_A, undefined, 0), false);
});

test('F2 SubmitOutcome 携带请求身份：ok/conflict 必带 requestId，阻断结果不带', () => {
  // 类型层由 tsc 保证；此处断言 page 接线：所有"真正发出"的路径返回 requestId，
  // 唯一无 requestId 的 error 出口是被阻断提交（PENDING_REQUEST_EXISTS）。
  const page = read('app/v5-preview/page.tsx');
  const okReturns = page.match(/return \{ outcome: 'ok'[^}]*\}/g) ?? [];
  assert.ok(okReturns.length >= 2, 'note/message 两条 ok 返回');
  for (const r of okReturns) assert.match(r, /requestId: body\.requestId/, `ok 必须携带 requestId：${r}`);
  const staleReturns = page.match(/return \{ outcome: 'error', code: 'STALE_REQUEST'[^}]*\}/g) ?? [];
  for (const r of staleReturns) assert.match(r, /requestId: body\.requestId/, `陈旧结果仍标识所属请求：${r}`);
  const blockedReturns = page.match(/return \{ outcome: 'error', code: 'PENDING_REQUEST_EXISTS'[^}]*\}/g) ?? [];
  assert.equal(blockedReturns.length, 2, 'note/message 两个阻断出口');
  for (const r of blockedReturns) assert.doesNotMatch(r, /requestId/, '阻断结果不得携带 requestId（不得改写草稿关联）');
});

// ---------------------------------------------------------------------------
// F2：回执副作用先判所有权；情景门比对当前上下文
// ---------------------------------------------------------------------------

test('F2 冲突横幅以所有权为前提；陈旧结果静默返回', () => {
  const page = read('app/v5-preview/page.tsx');
  // writeOutcome 的 onConflict 必须按 owner 选择（陈旧回执不得设置横幅）。
  assert.match(
    page,
    /writeOutcome\(error, body\.expectedVersion, owner \? \(banner, toVersion\) => setConflict\(\{ text: banner, toVersion \}\) : \(\) => \{\}\)/,
  );
  assert.ok(page.split('code: \'STALE_REQUEST\'').length - 1 >= 2, 'note/message 两条陈旧出口');
});

test('F2 情景上下文门比对页面当前情景（不是发送时快照）', () => {
  const page = read('app/v5-preview/page.tsx');
  assert.match(page, /shouldApplyWriteResponse\(next\.scenario, current\.scenario\)/, '必须与 overviewRef 的当前情景比较');
  assert.doesNotMatch(page, /shouldApplyWriteResponse\(next\.scenario, sentScenario\)/, '不得再比较发送时快照');
  assert.doesNotMatch(page, /shouldApplyWriteResponse\(next\.scenario, record\.scenario\)/, '确认路径同样比对当前上下文');
  // 纯语义不回归：同名情景放行、异名拒绝、首载放行。
  assert.equal(logic.shouldApplyWriteResponse('approval', 'approval'), true);
  assert.equal(logic.shouldApplyWriteResponse('approval', 'post-rental'), false);
  assert.equal(logic.shouldApplyWriteResponse('approval', null), true);
});

// ---------------------------------------------------------------------------
// 组件接线：阻断不改关联；确认成功清理过时内联反馈
// ---------------------------------------------------------------------------

test('接线：两组件的草稿关联按 requestId 建立，clearDraft/clearInput 同步清理旧反馈', () => {
  for (const [file, clearFn, inputRef] of [
    ['app/v5-preview/todo-card.tsx', 'clearDraft', 'draftRevisionRef'],
    ['app/v5-preview/chat-panel.tsx', 'clearInput', 'inputRevisionRef'],
  ]) {
    const src = read(file);
    assert.match(src, /draftAssocRef = useRef<DraftRequestAssociation \| null>\(null\)/, `${file} 必须持有草稿-请求关联`);
    assert.match(
      src,
      new RegExp(`if \\(result\\.requestId !== undefined\\) \\{\\s*\\n\\s*draftAssocRef\\.current = \\{ requestId: result\\.requestId, revision: revisionAtSubmit \\}`),
      `${file} 关联只在请求真正发出时建立`,
    );
    assert.match(src, /shouldClearDraftForRequest\(draftAssocRef\.current, result\.requestId/, `${file} 提交成功按关联判定`);
    assert.match(src, /shouldClearDraftForRequest\(draftAssocRef\.current, outcome\.requestId/, `${file} 恢复确认按关联判定`);
    assert.match(src, new RegExp(`${inputRef}\\.current \\+= 1`), `${file} 修订标识保留`);
    const clearBody = src.slice(src.indexOf(`function ${clearFn}()`), src.indexOf(`function ${clearFn}()`) + 260);
    assert.match(clearBody, /setError\(null\)/, `${file} ${clearFn} 必须清理旧内联错误`);
    assert.match(clearBody, /setConflictHint\(null\)/, `${file} ${clearFn} 必须清理旧冲突提示`);
  }
  // 确认结果的 stale 分支显式静默；failed 才提示。
  const chat = read('app/v5-preview/chat-panel.tsx');
  assert.match(chat, /} else \{\s*\/\/ stale：陈旧确认（请求已作废\/取代）静默/);
  const todoSrc = read('app/v5-preview/todo-card.tsx');
  assert.match(todoSrc, /} else \{\s*\/\/ stale：陈旧确认（请求已作废\/取代）静默/);
  const todo = read('app/v5-preview/todo-card.tsx');
  assert.match(todo, /onResolvePendingNote: \(\) => Promise<ResolveOutcome>/);
  assert.match(chat, /onResolvePendingMessage: \(\) => Promise<ResolveOutcome>/);
});
