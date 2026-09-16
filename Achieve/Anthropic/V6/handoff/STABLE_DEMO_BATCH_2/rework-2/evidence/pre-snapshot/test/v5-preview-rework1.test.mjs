// V6 BATCH_2 rework-1 · R1/R2/R3 交互恢复行为回归（纯逻辑真执行 + 接线断言）。
// 先于实现编写：修复前运行必须失败（新函数不存在/行为缺失），修复后全部通过。
// 运行：node --experimental-strip-types --test test/v5-preview-rework1.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const siteRoot = fileURLToPath(new URL('../', import.meta.url));
const dir = (p) => join(siteRoot, p);
const read = (p) => readFileSync(dir(p), 'utf8');

const logic = await import(pathToFileURL(dir('app/v5-preview/rows-logic.ts')).href);

const NOTE_RECORD = {
  kind: 'note',
  requestId: 'rid-note-1',
  expectedVersion: 29,
  todoId: 'todo-device-list',
  text: 'R1复现：说明响应丢失后刷新确认（合成）',
  scenario: 'approval',
  savedAt: 1789210015073,
};

const MESSAGE_RECORD = {
  kind: 'message',
  requestId: 'rid-msg-1',
  expectedVersion: 31,
  text: 'R2复现：消息响应丢失（合成）',
  scenario: 'approval',
  savedAt: 1789210025073,
};

// ---------------------------------------------------------------------------
// R1：完整请求恢复——恢复记录结构校验（非布尔标记）
// ---------------------------------------------------------------------------

test('R1 parseStoredNoteRequest：合法记录原样恢复；破损/变形/缺字段失败关闭', () => {
  const ok = logic.parseStoredNoteRequest(JSON.stringify(NOTE_RECORD));
  assert.equal(ok.status, 'valid');
  assert.deepEqual(ok.value, NOTE_RECORD, '合法记录必须逐字段恢复（完整原载荷，不是布尔标记）');

  const badJson = logic.parseStoredNoteRequest('{not-json');
  assert.equal(badJson.status, 'invalid');
  assert.equal(badJson.reason, 'not-json');

  const notObject = logic.parseStoredNoteRequest(JSON.stringify([NOTE_RECORD]));
  assert.equal(notObject.status, 'invalid');
  assert.equal(notObject.reason, 'bad-shape');

  // 旧版哨兵 '1' 不是完整请求，绝不能当作恢复成功。
  const legacy = logic.parseStoredNoteRequest('1');
  assert.equal(legacy.status, 'invalid');
  assert.ok(legacy.reason === 'not-json' || legacy.reason === 'bad-shape', `哨兵必须被判无效，实际 ${legacy.reason}`);

  // message 记录放进 note 槽位 → 类型变形拒绝。
  const wrongKind = logic.parseStoredNoteRequest(JSON.stringify(MESSAGE_RECORD));
  assert.equal(wrongKind.status, 'invalid');
  assert.equal(wrongKind.reason, 'bad-shape');

  const fieldCases = [
    ['requestId 缺失', { ...NOTE_RECORD, requestId: '' }],
    ['requestId 超长', { ...NOTE_RECORD, requestId: 'r'.repeat(65) }],
    ['expectedVersion 非整数', { ...NOTE_RECORD, expectedVersion: 1.5 }],
    ['expectedVersion 负数', { ...NOTE_RECORD, expectedVersion: -1 }],
    ['todoId 缺失', { ...NOTE_RECORD, todoId: '' }],
    ['text 空', { ...NOTE_RECORD, text: '  ' }],
    ['text 超长', { ...NOTE_RECORD, text: 'x'.repeat(2001) }],
    ['scenario 非法', { ...NOTE_RECORD, scenario: 'unknown' }],
    ['savedAt 缺失', { ...NOTE_RECORD, savedAt: undefined }],
    ['expectedVersion 类型错', { ...NOTE_RECORD, expectedVersion: '29' }],
  ];
  for (const [name, record] of fieldCases) {
    const parsed = logic.parseStoredNoteRequest(JSON.stringify(record));
    assert.equal(parsed.status, 'invalid', `${name} 必须判无效`);
    assert.equal(parsed.reason, 'bad-fields', `${name} 应为 bad-fields，实际 ${parsed.reason}`);
  }
});

test('R1 parseStoredMessageRequest：消息记录独立解析，与说明互不混用', () => {
  const ok = logic.parseStoredMessageRequest(JSON.stringify(MESSAGE_RECORD));
  assert.equal(ok.status, 'valid');
  assert.deepEqual(ok.value, MESSAGE_RECORD);
  const wrongKind = logic.parseStoredMessageRequest(JSON.stringify(NOTE_RECORD));
  assert.equal(wrongKind.status, 'invalid');
  assert.equal(wrongKind.reason, 'bad-shape');
});

test('R1 重放体逐字来自恢复记录：requestId/expectedVersion/todoId/text 不被当前版本重建', () => {
  const body = logic.noteBodyFromRecord(NOTE_RECORD);
  assert.deepEqual(body, {
    requestId: 'rid-note-1',
    expectedVersion: 29,
    todoId: 'todo-device-list',
    text: 'R1复现：说明响应丢失后刷新确认（合成）',
    actorRole: 'business',
  });
  const msgBody = logic.messageBodyFromRecord(MESSAGE_RECORD);
  assert.deepEqual(msgBody, {
    requestId: 'rid-msg-1',
    expectedVersion: 31,
    text: 'R2复现：消息响应丢失（合成）',
    actorRole: 'business',
  });
  // 关键：expectedVersion 保持首次发送值（29/31），不得被"当前版本"覆盖。
  assert.equal(body.expectedVersion, NOTE_RECORD.expectedVersion);
  assert.equal(msgBody.expectedVersion, MESSAGE_RECORD.expectedVersion);
});

// ---------------------------------------------------------------------------
// R2：说明与消息分别恢复、互不误清；同类第二次提交不静默覆盖
// ---------------------------------------------------------------------------

test('R2 decideRepeatSubmit：同内容重放原请求；内容不同阻断；空通道放行新请求', () => {
  assert.equal(
    logic.decideRepeatSubmit(NOTE_RECORD, { kind: 'note', todoId: 'todo-device-list', text: NOTE_RECORD.text }),
    'replay',
    '同 todoId 同文本 → 重放完整原请求',
  );
  assert.equal(
    logic.decideRepeatSubmit(NOTE_RECORD, { kind: 'note', todoId: 'todo-device-list', text: '不同的新内容（合成）' }),
    'block',
    '同类型内容不同 → 阻断（不得静默覆盖旧恢复记录）',
  );
  assert.equal(
    logic.decideRepeatSubmit(NOTE_RECORD, { kind: 'note', todoId: 'todo-other', text: NOTE_RECORD.text }),
    'block',
    '同类型 todoId 不同 → 阻断',
  );
  assert.equal(
    logic.decideRepeatSubmit(null, { kind: 'note', todoId: 'todo-device-list', text: '任意' }),
    'new',
    '无未知记录 → 正常新请求',
  );
  assert.equal(logic.decideRepeatSubmit(MESSAGE_RECORD, { kind: 'message', text: MESSAGE_RECORD.text }), 'replay');
  assert.equal(logic.decideRepeatSubmit(MESSAGE_RECORD, { kind: 'message', text: '新的沟通内容' }), 'block');
  assert.equal(logic.decideRepeatSubmit(null, { kind: 'message', text: '任意' }), 'new');
});

test('R2 恢复入口文案按类型区分；阻断提示明确且不泄露内部码', () => {
  const noteBlock = logic.pendingRequestBlockMessage('note');
  const msgBlock = logic.pendingRequestBlockMessage('message');
  assert.match(noteBlock, /补充说明/);
  assert.match(noteBlock, /确认说明结果/);
  assert.match(noteBlock, /草稿已保留/);
  assert.match(msgBlock, /项目沟通消息/);
  assert.match(msgBlock, /确认消息结果/);
  assert.notEqual(noteBlock, msgBlock, '两类阻断提示必须可区分');
  for (const text of [noteBlock, msgBlock]) {
    assert.doesNotMatch(text, /[A-Z_]{6,}/, '阻断提示不得出现内部错误码形态');
  }
  // 恢复行文案按类型区分。
  assert.match(logic.pendingRequestRowText('note'), /补充说明尚未确认结果/);
  assert.match(logic.pendingRequestRowText('message'), /项目沟通消息尚未确认结果/);
  assert.equal(logic.recoveryResolveLabel('note'), '确认说明结果');
  assert.equal(logic.recoveryResolveLabel('message'), '确认消息结果');
});

test('R2 旧成功回执不能清掉新请求：所有权判定（requestId 不匹配即陈旧）', () => {
  assert.equal(logic.isSameRequestOwner({ requestId: 'rid-a' }, 'rid-a'), true);
  assert.equal(logic.isSameRequestOwner({ requestId: 'rid-b' }, 'rid-a'), false, '回执属于已被取代的请求 → 非所有者');
  assert.equal(logic.isSameRequestOwner(null, 'rid-a'), false, '记录已被情景切换清空 → 非所有者');
  assert.equal(logic.isSameRequestOwner(undefined, 'rid-a'), false);
});

// ---------------------------------------------------------------------------
// R3：回执只影响所属请求与所属草稿（草稿修订标识，不仅比较字符串）
// ---------------------------------------------------------------------------

test('R3 shouldClearDraftAfterConfirmation：A→B→A 修订序列不得误清新草稿', () => {
  assert.equal(logic.shouldClearDraftAfterConfirmation(0, 0), true, '在途未编辑 → 可清空');
  assert.equal(logic.shouldClearDraftAfterConfirmation(0, 1), false, 'A→B：修订号不同 → 保留 B');
  assert.equal(logic.shouldClearDraftAfterConfirmation(0, 2), false, 'A→B→A：字符串相同但修订号不同 → 不得清空');
  assert.equal(logic.shouldClearDraftAfterConfirmation(null, 0), false, '刷新恢复的记录无在会话修订关联 → 不清空（草稿本为空）');
});

test('R3 情景切换：旧情景记录失效，旧回执不得挂上新情景', () => {
  assert.equal(logic.isStaleRecordScenario(NOTE_RECORD, 'approval'), false);
  assert.equal(logic.isStaleRecordScenario(NOTE_RECORD, 'post-rental'), true, '情景已切换 → 记录失效');
  assert.equal(logic.isStaleRecordScenario(MESSAGE_RECORD, 'settled'), true);
  assert.match(logic.staleRecordNotice('note'), /补充说明/);
  assert.match(logic.staleRecordNotice('note'), /失效/);
  assert.match(logic.staleRecordNotice('message'), /项目沟通消息/);
  // 写入回执上下文检查：seed 重置后版本可能碰撞（同为 vN），仅查版本不够——
  // 旧情景回执（nextScenario ≠ 当前情景）不得应用；GET 全局真相不受此限制。
  assert.equal(logic.shouldApplyWriteResponse('post-rental', 'post-rental'), true);
  assert.equal(logic.shouldApplyWriteResponse('approval', 'post-rental'), false, '旧情景回执不得应用（即使版本相同）');
  assert.equal(logic.shouldApplyWriteResponse('approval', null), true, '首载无当前事实源时可应用');
});

// ---------------------------------------------------------------------------
// R1/R2：恢复受限（损坏/旧版标记）明确提示，无虚假确认按钮、不猜"已提交"
// ---------------------------------------------------------------------------

test('恢复受限提示：损坏与旧版哨兵各有可理解文案；确认冲突话术不宣称已落账', () => {
  const corruptNote = logic.recoveryLimitedNotice('note', 'corrupt');
  const legacyNote = logic.recoveryLimitedNotice('note', 'legacy');
  const corruptMsg = logic.recoveryLimitedNotice('message', 'corrupt');
  assert.match(corruptNote, /补充说明/);
  assert.match(corruptNote, /损坏/);
  assert.match(corruptNote, /无法自动确认/);
  assert.match(legacyNote, /不完整|旧版本/);
  assert.match(corruptMsg, /项目沟通消息/);
  for (const text of [corruptNote, legacyNote, corruptMsg]) {
    assert.doesNotMatch(text, /已提交|已确认|已落账/, '恢复受限不得虚报结果');
  }
  const conflictNote = logic.recoveryConflictNotice('note');
  assert.match(conflictNote, /未能.*落账|不包含该条内容/, '重放 409 = 未落账（幂等表先于版本门），必须如实告知');
  assert.doesNotMatch(conflictNote, /必然|已经落账/);
  assert.match(logic.recoveryConflictNotice('message'), /项目沟通/);
  assert.match(logic.staleRequestMessage(), /情景切换|失效/);
});

// ---------------------------------------------------------------------------
// 接线断言：页面/组件必须按新机制接线（替换旧 attemptRef + 布尔标记机制）
// ---------------------------------------------------------------------------

test('接线：page.tsx 双通道恢复记录 + 发送前持久化 + 所有权检查 + 确认重放原载荷', () => {
  const page = read('app/v5-preview/page.tsx');
  assert.match(page, /jw:v5-preview:pending-note-request/, '说明恢复记录独立存储键');
  assert.match(page, /jw:v5-preview:pending-message-request/, '消息恢复记录独立存储键');
  assert.match(page, /parseStoredNoteRequest/);
  assert.match(page, /parseStoredMessageRequest/);
  assert.match(page, /noteBodyFromRecord/, '确认动作必须重放记录原载荷');
  assert.match(page, /messageBodyFromRecord/, '消息确认动作必须重放记录原载荷');
  assert.match(page, /decideRepeatSubmit/, '同类第二次提交必须先决策（重放/阻断），不得静默覆盖');
  assert.match(page, /isSameRequestOwner/, '回执必须检查所属请求（所有权）');
  assert.match(page, /isStaleRecordScenario/, '应用新总览时必须校验记录情景归属');
  assert.match(page, /postNoteBody\(body\)/);
  assert.match(page, /postMessageBody\(body\)/);
  assert.match(page, /shouldApplyOverview\(next\.version, current\.version\)/, '版本防回退保留');
  assert.match(page, /shouldApplyWriteResponse\(next\.scenario, sentScenario\)|shouldApplyWriteResponse\(next\.scenario, record\.scenario\)/, '写入回执必须检查情景上下文');
  // 旧机制移除：不得再有共享布尔标记键与借道标记。
  assert.doesNotMatch(page, /setPendingNoteVisible/, '消息借说明布尔标记的做法必须移除');
  assert.doesNotMatch(page, /noteAttemptRef|messageAttemptRef/, '内存 attempt 引用由可恢复记录取代');
});

test('接线：恢复入口不依赖待办状态；草稿清空以修订标识判定', () => {
  const todo = read('app/v5-preview/todo-card.tsx');
  const chat = read('app/v5-preview/chat-panel.tsx');
  // 说明恢复条对所有待办状态可见（不得再挂在 !canSubmit 条件下）。
  assert.match(todo, /pendingRequestRowText\('note'\)/);
  assert.doesNotMatch(todo, /!canSubmit && hasPendingNote/, '恢复入口不得依赖待办状态');
  assert.match(todo, /shouldClearDraftAfterConfirmation/, '说明草稿清空必须按修订标识判定');
  assert.match(todo, /确认说明结果|recoveryResolveLabel/);
  assert.match(todo, /onDismissPendingNote/, '恢复受限提示必须提供显式清除入口');
  // 消息恢复条独立于聊天折叠区；草稿按修订判定。
  assert.match(chat, /pendingRequestRowText\('message'\)/);
  assert.match(chat, /确认消息结果|recoveryResolveLabel/);
  assert.match(chat, /shouldClearDraftAfterConfirmation/);
  assert.match(chat, /onDismissPendingMessage/);
});
