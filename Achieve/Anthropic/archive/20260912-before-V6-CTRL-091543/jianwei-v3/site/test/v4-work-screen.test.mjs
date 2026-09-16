// /work/screen canonical 大屏镜像页回归测试（P5，2026-09-04）
// 源码断言风格（参照 test/v4-work-surface.test.mjs）：锁定大屏页不变量——
// 纯 client 只读镜像、EventSource 订阅 + 节流重取、四域泳道、awaiting_gate 最醒目、
// openGates 大字区、免责声明、断线容错（等待连接而非崩溃）。

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('/work/screen 三个文件存在，页面是纯 client 页（不适用 route segment 缓存机制）', async () => {
  const page = await read('app/work/screen/page.tsx');
  const css = await read('app/work/screen/screen.module.css');
  assert.ok(page.length > 0);
  assert.ok(css.length > 0);
  assert.match(page, /['"]use client['"]/);
  // 客户端页面：force-dynamic / no-store 等 route segment 与服务端 fetch 语义均不适用。
  assert.doesNotMatch(page, /force-dynamic/);
  assert.doesNotMatch(page, /no-store/);
  // 只读镜像：不 import lib/v4life/**，不发送任何写命令。
  assert.doesNotMatch(page, /lib\/v4life/);
  assert.doesNotMatch(page, /method:\s*['"]POST['"]/);
  assert.match(css, /--screen-bg:\s*#0/i, '深色底');
});

test('数据流：默认 demo caseId + URL query 校验回落 + EventSource 订阅 + 500ms 节流重取', async () => {
  const page = await read('app/work/screen/page.tsx');
  assert.match(page, /demo-sme-robot-500w/, '默认 caseId');
  assert.match(page, /CASE_ID_PATTERN/, 'caseId query 基本校验');
  assert.match(page, /new EventSource\(/, 'EventSource 订阅');
  assert.match(page, /events\/stream/, '订阅事件账本 SSE 端点');
  assert.match(page, /encodeURIComponent\(caseId\)/, 'caseId 进入 URL 前编码');
  assert.match(page, /REFETCH_THROTTLE_MS = 500/, '重取节流窗口 500ms');
  assert.match(page, /onmessage/, '每收到事件帧触发重取');
  assert.match(page, /scheduleThrottledRefresh/, '节流合并函数');
  assert.match(page, /\/api\/v4life\/cases\//, 'Projection 数据源为真实 API');
  assert.match(page, /\.close\(\)/, '组件卸载时 close EventSource');
  assert.match(page, /controller\.abort\(\)/, '卸载时中止在途 fetch');
});

test('四域泳道：固定序 policy/credit/commerce/asset 渲染循环 + 状态三通道', async () => {
  const page = await read('app/work/screen/page.tsx');
  assert.match(page, /DOMAIN_SEQUENCE[^;]*=\s*\[[^\]]*'policy'[^\]]*'credit'[^\]]*'commerce'[^\]]*'asset'/, '四域固定序');
  assert.match(page, /DOMAIN_SEQUENCE\.map/, '泳道渲染循环');
  for (const label of ['政策', '信审', '商务', '资产']) {
    assert.match(page, new RegExp(`${label}`));
  }
  for (const status of ['blocked', 'in_progress', 'awaiting_gate', 'completed', 'stopped_dependency']) {
    assert.match(page, new RegExp(status));
  }
  assert.match(page, /STATUS_GLYPHS/, '状态图形记号（不只靠颜色）');
  assert.match(page, /STATUS_LABELS/, '状态文字');
  // 泳道内容来自真实 Projection，不造假数据。
  assert.match(page, /workItems\.map/, 'WorkItem 渲染循环');
});

test('awaiting_gate 最醒目（专用高亮类 + 黄色 + 脉冲），状态色语义映射齐备', async () => {
  const page = await read('app/work/screen/page.tsx');
  const css = await read('app/work/screen/screen.module.css');
  assert.match(page, /itemAwaitingGate/, 'awaiting_gate 使用专用高亮类');
  assert.match(css, /\.itemAwaitingGate/, '高亮类样式存在');
  assert.match(css, /awaitingPulse/, '呼吸脉冲动画（全场最醒目）');
  assert.match(css, /--color-awaiting:\s*#facc15/i, '黄=等待人工');
  assert.match(css, /--color-completed:\s*#22c55e/i, '绿=完成');
  assert.match(css, /--color-progress:\s*#38bdf8/i, '蓝=进行中');
  assert.match(css, /--color-blocked:\s*#94a3b8/i, '灰=阻塞');
  assert.match(css, /--color-stopped:\s*#f87171/i, '红=停止');
  assert.match(css, /data-status=['"]completed['"]/i, '状态经 data-status 双通道映射');
});

test('大字号约束：标题字号下限 ≥64px、正文下限 ≥28px（CSS 变量）', async () => {
  const css = await read('app/work/screen/screen.module.css');
  assert.match(css, /--screen-title-size:\s*clamp\(64px/i, '标题 ≥64px');
  assert.match(css, /--screen-body-size:\s*clamp\(28px/i, '正文 ≥28px');
  assert.match(css, /--screen-heading-size/, '区标题字号变量');
  assert.match(css, /var\(--screen-title-size\)/, '标题字号变量被实际使用');
  assert.match(css, /var\(--screen-body-size\)/, '正文字号变量被实际使用');
});

test('openGates 大字区：「等待 <角色> 决定」高亮 + Receipt 流水 + 贡献计数', async () => {
  const page = await read('app/work/screen/page.tsx');
  assert.match(page, /openGates\.map/, '待决 Gate 渲染循环');
  assert.match(page, /等待 \{ROLE_LABELS\[gate\.requiredRole\]\} 决定/, '大字「等待 <角色> 决定」');
  assert.match(page, /gateWait/, 'Gate 大字类');
  assert.match(page, /receipts\.slice/, 'Receipt 流水取最近若干条');
  assert.match(page, /OUTCOME_LABELS/, 'outcome 中文化（批准/否决/退回）');
  assert.match(page, /contributions\.length|contribNumber/, '贡献计数渲染');
  const css = await read('app/work/screen/screen.module.css');
  assert.match(css, /\.gateWait[\s\S]*?font-size:\s*var\(--screen-heading-size\)/, 'gate 区使用大字号变量');
});

test('免责声明 + rev + 案例名渲染，全部来自 Projection 真实字段', async () => {
  const page = await read('app/work/screen/page.tsx');
  assert.match(page, /合成演示/, '免责声明前缀');
  assert.match(page, /caseMeta\.disclaimer/, '免责声明取自 Projection.case.disclaimer');
  assert.match(page, /rev \{projection\.rev\}/, 'rev 展示');
  assert.match(page, /caseMeta\.displayName/, '案例名展示');
  assert.match(page, /actorByRole\.get\(domain\)/, '域 Actor 名来自 Projection.actors 派生');
  assert.doesNotMatch(page, /mock|fixture/i, '不引入静态假数据');
});

test('断线容错：fetch 失败显示「等待连接」不清空画面；EventSource onerror 容忍自动重连', async () => {
  const page = await read('app/work/screen/page.tsx');
  assert.match(page, /等待连接/, '「等待连接」文案');
  assert.match(page, /source\.onerror/, 'EventSource onerror 分支');
  assert.match(page, /reconnecting/, '重连中状态');
  assert.match(page, /setFetchFailed\(true\)/, 'fetch 失败仅切换状态');
  assert.doesNotMatch(page, /setProjection\(null\)/, '失败不清空已有权威数据');
  assert.match(page, /isProjectionPayload/, '非预期载荷不渲染（失败关闭）');
  // onerror 内不主动 close：断线交给 EventSource 原生重连。
  const onerrorBlock = /source\.onerror[\s\S]*?\n    \};/.exec(page)?.[0] ?? '';
  assert.ok(onerrorBlock.includes('source.onerror'), '能定位 onerror 处理块');
  assert.doesNotMatch(onerrorBlock, /close\(\)/, 'onerror 不 close，容忍自动重连');
});

// ---------------------------------------------------------------------------
// v2（2026-09-04）：五类核验状态视图 + Risk Thread 面板 + Context 版本徽章
// 契约：新字段全部可选、缺失降级「暂无数据」；contradicted/stale 警示色；
// Context 三态 SEALED 绿 / STABILIZING 黄 / OPEN 蓝。
// ---------------------------------------------------------------------------

test('v2 五类核验视图：五分类固定序 + 缺省 claimed 归类 + 计数大数字渲染逻辑存在', async () => {
  const page = await read('app/work/screen/page.tsx');
  assert.match(
    page,
    /VERIFICATION_SEQUENCE[^;]*=\s*\[[^\]]*'claimed'[^\]]*'unverified'[^\]]*'verified'[^\]]*'contradicted'[^\]]*'stale'/,
    '五分类固定序常量',
  );
  assert.match(page, /normalizeVerificationStatus/, '缺省/未知状态归类函数（缺省 claimed）');
  assert.match(page, /buildVerificationGroups/, '五分类计数 + 下钻一次成形函数');
  assert.match(page, /verificationGroups\.map/, '五分类渲染循环');
  assert.match(page, /verifyNumber/, '每类大数字计数类');
  assert.match(page, /VERIFICATION_LABELS/, '五类中文标签映射');
  for (const label of ['自述', '未核验', '已核验', '矛盾', '过期']) {
    assert.match(page, new RegExp(label), `核验标签 ${label}`);
  }
});

test('v2 下钻列表：evidenceId + title + sourceType 小标，六类来源映射齐备', async () => {
  const page = await read('app/work/screen/page.tsx');
  assert.match(page, /styles\.verifyItem/, '下钻条目类');
  assert.match(page, /item\.evidenceId/, 'evidenceId 展示');
  assert.match(page, /item\.title \?\? item\.evidenceId/, 'title 缺失回落 evidenceId');
  assert.match(page, /sourceTypeLabel\(item\.sourceType\)/, 'sourceType 小标派生');
  assert.match(page, /SOURCE_TYPE_LABELS/, 'sourceType 中文映射表');
  for (const source of [
    'business_statement',
    'original_document',
    'existing_system',
    'authorized_external',
    'human_review',
    'model_derived',
  ]) {
    assert.match(page, new RegExp(source), `sourceType ${source} 在映射中`);
  }
});

test('v2 警示通道：contradicted / stale 专属警示类（红色 + data-verification 双通道）', async () => {
  const page = await read('app/work/screen/page.tsx');
  const css = await read('app/work/screen/screen.module.css');
  assert.match(page, /data-verification=\{group\.status\}/, '状态写入 data 属性');
  assert.match(css, /\.verifyGroup\[data-verification='contradicted'\]/, 'contradicted 警示类存在');
  assert.match(css, /\.verifyGroup\[data-verification='stale'\]/, 'stale 警示类存在');
  const warningBlocks =
    css.match(/\.verifyGroup\[data-verification='(?:contradicted|stale)'\][^{]*\{[^}]*\}/g) ?? [];
  assert.ok(warningBlocks.length >= 2, '两类各有专属警示样式块');
  assert.match(warningBlocks.join('\n'), /--color-stopped/, '警示色复用 --color-stopped 红');
});

test('v2 Risk Thread 面板：riskThreadKey + 关联 evidence/workItem/gate 计数 + lastSeq，行视觉区分', async () => {
  const page = await read('app/work/screen/page.tsx');
  assert.match(page, /riskThreads/, 'riskThreads 字段接入');
  assert.match(page, /thread\.riskThreadKey/, '线程 key 展示');
  assert.match(page, /thread\.evidenceIds\?\.length/, '关联 evidence 数量');
  assert.match(page, /thread\.workItemIds\?\.length/, '关联 workItem 数量');
  assert.match(page, /thread\.gateIds\?\.length/, '关联 gate 数量');
  assert.match(page, /thread\.lastSeq/, 'lastSeq 展示');
  assert.match(page, /styles\.threadRow/, '线程行类');
  const css = await read('app/work/screen/screen.module.css');
  assert.match(css, /\.threadRow\s*\{[^}]*border-left/, '线程行红色左侧色条（视觉区分）');
  assert.match(css, /\.threadGlyph/, '线程图形记号类');
});

test('v2 Context 徽章：Context v{major}.{minor} · {status}，三态配色，缺省不渲染', async () => {
  const page = await read('app/work/screen/page.tsx');
  const css = await read('app/work/screen/screen.module.css');
  assert.match(page, /contextMeta !== null &&\s*\(/, 'context 缺省时徽章不渲染');
  assert.match(
    page,
    /Context v\{contextMeta\.major\}\.\{contextMeta\.minor\} · \{contextMeta\.status\}/,
    '徽章文案 Context v{major}.{minor} · {status}',
  );
  assert.match(page, /data-context-status=\{contextMeta\.status\}/, '状态写入 data 属性');
  assert.match(page, /isValidContext/, 'context 轻量形状校验（缺失/不完整不渲染）');
  assert.match(
    css,
    /\.contextBadge\[data-context-status='SEALED'\]\s*\{[^}]*--color-completed/,
    'SEALED 绿',
  );
  assert.match(
    css,
    /\.contextBadge\[data-context-status='STABILIZING'\]\s*\{[^}]*--color-awaiting/,
    'STABILIZING 黄',
  );
  assert.match(
    css,
    /\.contextBadge\[data-context-status='OPEN'\]\s*\{[^}]*--color-progress/,
    'OPEN 蓝',
  );
});

test('v2 优雅降级：新字段全部可选，缺失分支渲染「暂无数据」，形状 gate 不新增必填', async () => {
  const page = await read('app/work/screen/page.tsx');
  // isProjectionPayload 只校验 v1 既有必填字段：新字段不做必需校验，后端先后到达均兼容。
  const gateBlock = /function isProjectionPayload[\s\S]*?\n\}/.exec(page)?.[0] ?? '';
  assert.ok(gateBlock.includes('isProjectionPayload'), '能定位载荷形状校验块');
  assert.doesNotMatch(
    gateBlock,
    /riskThreads|context|sourceType|verificationStatus/,
    '新字段不进入必需校验',
  );
  assert.match(page, /evidence\?:/, 'evidence 可选');
  assert.match(page, /context\?:/, 'context 可选');
  assert.match(page, /riskThreads\?:/, 'riskThreads 可选');
  assert.match(page, /readOptionalArray/, '可选数组统一回落空数组');
  assert.match(page, /evidenceItems\.length === 0[\s\S]*?暂无数据/, '核验视图空态「暂无数据」');
  assert.match(page, /riskThreads\.length === 0[\s\S]*?暂无数据/, 'Risk Thread 空态「暂无数据」');
});

test('v2 新 css 类齐备：核验面板/五分类组/下钻/Risk Thread/下排布局/Context 徽章/窄屏退化', async () => {
  const css = await read('app/work/screen/screen.module.css');
  for (const className of [
    'contextBadge',
    'lower',
    'verifyZone',
    'threadZone',
    'verifyGrid',
    'verifyGroup',
    'verifyNumber',
    'verifyLabel',
    'verifyList',
    'verifyItem',
    'verifyItemId',
    'verifyItemTitle',
    'verifySource',
    'verifyNone',
    'threadList',
    'threadRow',
    'threadGlyph',
    'threadKey',
    'threadMeta',
    'threadSeq',
  ]) {
    assert.match(css, new RegExp(`\\.${className}[\\s,{[]`), `css 类 .${className} 存在`);
  }
  const mediaBlock = /@media \(max-aspect-ratio: 3\/2\) \{[\s\S]*?\n\}/.exec(css)?.[0] ?? '';
  assert.ok(mediaBlock.includes('@media'), '能定位窄屏媒体查询');
  assert.match(mediaBlock, /\.lower/, '下排双面板纳入窄屏退化');
});
