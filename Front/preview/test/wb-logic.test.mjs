// goal-03c 工作本纯逻辑测试（node --test --experimental-strip-types 直跑 TS 源）。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_ORIGINAL_BYTES,
  buildOriginalEnvelope,
  bytesToBase64,
  errorText,
  decisionView,
  wbActionRequestId,
  buildConfirmPlan,
  audienceColumns,
  summarizeArtifacts,
  canAnswerQuestion,
  channelTaskRows,
  channelOpRows,
  latestGateReceiptRef,
  collectRunRefs,
  completedRunRefs,
  pickedFactKeys,
  mergeThread,
  previewKind,
  envelopeDataUrl,
  sniffImageMime,
} from '../../site-mirror/lib/workbench/wb-logic.ts';

const fmt = (minor) => (minor == null ? '未知' : `${(minor / 1000000).toFixed(0)} 万`);

test('受限上传预检：正常小文件产出信封；超大/空文件/坏名拒绝且给业务语言', () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const ok = buildOriginalEnvelope({ name: '发票.jpg', mime: 'image/jpeg', bytes });
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.envelope.encoding, 'base64');
    assert.equal(ok.envelope.size, 4);
    assert.equal(ok.envelope.data, bytesToBase64(bytes));
  }
  const big = buildOriginalEnvelope({ name: 'big.bin', mime: 'a/b', bytes: new Uint8Array(MAX_ORIGINAL_BYTES + 1) });
  assert.equal(big.ok, false);
  if (!big.ok) assert.equal(big.code, 'FILE_TOO_LARGE');
  const empty = buildOriginalEnvelope({ name: 'e.bin', mime: 'a/b', bytes: new Uint8Array(0) });
  assert.equal(empty.ok, false);
  const badName = buildOriginalEnvelope({ name: '', mime: 'a/b', bytes });
  assert.equal(badName.ok, false);
});

test('bytesToBase64 已知向量', () => {
  assert.equal(bytesToBase64(new Uint8Array([0x89, 0x50])), 'iVA=');
});

test('错误码→业务语言：政策未配置/Gate 阻断/未知码保守回显', () => {
  assert.match(errorText('POLICY_PENDING'), /政策未配置/);
  assert.match(errorText('GATE_BLOCKED'), /Gate 未通过/);
  assert.match(errorText('SOME_NEW_CODE', '操作未成功'), /SOME_NEW_CODE/);
  assert.match(errorText(null, '回退文案'), /回退文案/);
});

test('decisionView：候选≠批准≠可用 三行分开；阻断与 Gate 文案直出服务端字段', () => {
  const v = decisionView({
    decisionStatus: {
      basis: { packageId: 'pkg_1', revision: 2, basisVersion: 'v9', status: 'frozen', decisionReadiness: false, blockedActions: ['approve'], gate: { result: 'hold_for_review' } },
      facilityTotalsMinor: { proposed: 500000000, approvedInactive: 0, active: 300000000, suspended: 0, available: 100000000 },
    },
  }, fmt);
  assert.match(v.candidateText, /候选≠批准/);
  assert.match(v.approvedText, /3 亿|300 万|3 亿|已批准/);
  assert.match(v.availableText, /当前可用/);
  assert.match(v.basisText, /pkg_1/);
  assert.match(v.gateText, /hold_for_review/);
  assert.deepEqual(v.blockers, ['approve']);
  assert.equal(v.readinessTone, 'bad');

  const none = decisionView({ decisionStatus: null }, fmt);
  assert.match(none.basisText, /未冻结/);
  assert.match(none.gateText, /未登记/);
});

test('幂等键：稳定、同动作同键、跨动作不串、≤128', () => {
  const a1 = wbActionRequestId('wb-act', 'cust_1', 'facility.approve', 'n1');
  const a2 = wbActionRequestId('wb-act', 'cust_1', 'facility.approve', 'n1');
  const b1 = wbActionRequestId('wb-act', 'cust_1', 'fr.reserve', 'n1');
  assert.equal(a1, a2);
  assert.notEqual(a1, b1);
  assert.ok(a1.length <= 128);
});

test('二次确认计划：包含对象；幂等编号在 plan.requestId（由确认对话框统一渲染对账块）', () => {
  const p = buildConfirmPlan('facility.approve', 'cust_1', ['金额：500 万'], 'wb-act:cust_1:facility.approve:n1');
  assert.match(p.title, /正式批准额度/);
  assert.ok(p.lines.some((l) => l.includes('cust_1')));
  assert.equal(p.requestId, 'wb-act:cust_1:facility.approve:n1');
});

test('沟通分列：对客户与内部显式分开', () => {
  const cols = audienceColumns([
    { audience: 'customer', text: 'a', at: 't1', state: '已送达' },
    { audience: 'internal', text: 'b', at: 't2', state: '已送达' },
    { audience: 'customer', text: 'c', at: 't3', state: '已送达' },
  ]);
  assert.equal(cols.customer.length, 2);
  assert.equal(cols.internal.length, 1);
});

test('材料行汇总：现行/取代链/文件标记', () => {
  const s = summarizeArtifacts([
    { artifactId: 'a1', kind: 'invoice', factKey: 'invoice_total', grade: 'unverified', current: true, materialMeta: { period: '2026-07', subjectRef: '甲' }, objectRef: { objectId: 'obj_9' }, createdAt: '2026-09-18T00:00:00Z', content: { materialFile: { name: 'f.jpg' } } },
    { artifactId: 'a2', kind: 'invoice', current: false, supersededBy: 'a3' },
  ]);
  assert.equal(s.rows.length, 2);
  assert.equal(s.rows[0].objectRef, 'obj_9');
  assert.equal(s.rows[0].hasFile, true);
  assert.equal(s.rows[1].current, false);
  assert.equal(s.rows[1].supersededBy, 'a3');
});

test('回答授权：仅我的角色匹配 target_role 时可答', () => {
  assert.equal(canAnswerQuestion(['credit'], 'credit'), true);
  assert.equal(canAnswerQuestion(['business'], 'customer_owner'), false);
  assert.equal(canAnswerQuestion(['business'], undefined), false);
});

// ---- goal-03d 处理通道（IR-02-C）投影 ----

test('通道任务行：状态/分段中文投影；blocked_unknown 如实显示对账中', () => {
  const rows = channelTaskRows([
    { task_id: 't1', evidence_id: 'up-1', kind: 'bank_statement', status: 'running', stage_cursor: 'parse', attempts: 1, updated_at: '2026-09-19T01:00:00Z' },
    { task_id: 't2', evidence_id: 'up-2', kind: 'ledger_book', status: 'blocked_unknown', stage_cursor: 'register_results', failure_code: 'A_UNKNOWN' },
    { task_id: 't3', evidence_id: 'up-3', kind: 'invoice', status: 'done', stage_cursor: 'done' },
  ]);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].statusText, '处理中');
  assert.equal(rows[0].cursorText, '解析');
  assert.equal(rows[1].tone, 'yellow');
  assert.ok(rows[1].statusText.includes('对账中'));
  assert.equal(rows[2].cursorText, '完成');
});

test('collectRunRefs：每域全部已登记运行引用（按出现顺序去重），供下拉选择不手填', () => {
  const ops = [
    { entity_type: 'run', local_id: 'cust-1:credit', a_ref: 'run_a', status: 'registered' },
    { entity_type: 'run', local_id: 'cust-1:credit', a_ref: 'run_a', status: 'registered' },
    { entity_type: 'run', local_id: 'cust-1:credit', a_ref: 'run_b', status: 'registered' },
    { entity_type: 'run', local_id: 'cust-1:policy', a_ref: 'run_p', status: 'registered' },
    { entity_type: 'run', local_id: 'cust-1:asset', a_ref: 'run_x', status: 'unknown' },
  ];
  assert.deepEqual(collectRunRefs(ops), { credit: ['run_a', 'run_b'], policy: ['run_p'] });
});

test('pickedFactKeys：勾选材料的 factKey 去重收集；未勾选/无键为空', () => {
  const rows = [
    { artifactId: 'a1', factKey: 'cash_balance', current: true },
    { artifactId: 'a2', factKey: 'cash_balance', current: true },
    { artifactId: 'a3', factKey: null, current: true },
  ];
  assert.deepEqual(pickedFactKeys(rows, ['a1', 'a2', 'a3']), ['cash_balance']);
  assert.deepEqual(pickedFactKeys(rows, []), []);
});

test('通道 A 侧留痕行：实体中文名/Gate 引用/运行引用提取', () => {
  const ops = [
    { entity_type: 'artifact', local_id: 'm1', a_ref: 'art_1', request_id: 'p1', status: 'registered' },
    { entity_type: 'run', local_id: 'cust-1:credit', a_ref: 'run_a', request_id: 'p2', status: 'registered' },
    { entity_type: 'run', local_id: 'cust-1:credit:finish', a_ref: 'run_a', request_id: 'p3', status: 'registered' },
    { entity_type: 'gate', local_id: 'fin_1', a_ref: 'gate_9', request_id: 'p4', status: 'registered', detail: JSON.stringify({ gateResult: 'CLEAR' }) },
    { entity_type: 'gate', local_id: 'fin_x', a_ref: null, request_id: 'p5', status: 'unknown' },
    { entity_type: 'finding', local_id: 'cf1', a_ref: 'fnd_1', request_id: 'p6', status: 'registered' },
  ];
  const rows = channelOpRows(ops);
  assert.equal(rows[0].entityTypeText, 'A 工件登记');
  assert.equal(rows[3].entityTypeText, 'A Gate 回执');
  assert.equal(latestGateReceiptRef(ops), 'gate_9', '只取已登记的 Gate 回执');
  const runs = completedRunRefs(ops);
  assert.deepEqual(runs, { credit: 'run_a' }, 'finish 行不覆盖 start 行；非域格式忽略');
});

test('通道错误码业务语言：令牌无效/已用邀请/未完成运行', () => {
  assert.ok(errorText('TOKEN_INVALID').includes('通道令牌无效'));
  assert.ok(errorText('INVITATION_ALREADY_USED').includes('已被使用'));
  assert.ok(errorText('ANALYSIS_RUN_NOT_COMPLETED').includes('未完成'));
});

test('冻结/域结果/撤权确认计划标题齐备且带幂等键', () => {
  const freeze = buildConfirmPlan('package.freeze', 'cust-1', ['Gate 回执：gate_9'], 'wb-pkg:cust-1:freeze:n');
  assert.ok(freeze.title.includes('冻结决策依据包'));
  assert.ok(freeze.lines.some((l) => l.includes('gate_9')));
  const dr = buildConfirmPlan('package.domain-result', 'cust-1', [], 'x');
  assert.ok(dr.title.includes('authority=none'));
  const gr = buildConfirmPlan('grant.revoke', 'cust-1', [], 'x');
  assert.ok(gr.title.includes('撤销客户授权'));
});

// ---- goal-03e 页内消息线程（DEF-G04N-05）投影 ----

test('线程合并：远端为权威、mine/sender 归属标注、requestId 已留档的 pending 被远端行取代', () => {
  const remote = [
    { messageId: 'r1', requestId: 'wb-1', audience: 'customer', text: '请补流水', senderPrincipalId: 'p-biz', at: 't1' },
    { messageId: 'r2', requestId: 'wb-2', audience: 'customer', text: '下午补传', senderPrincipalId: 'cit-1', at: 't2' },
  ];
  const pending = [
    { id: 'p1', requestId: 'wb-2', audience: 'customer', text: '下午补传', at: 't2', state: '发送中' },
    { id: 'p2', requestId: 'wb-3', audience: 'internal', text: '内部备注', at: 't3', state: '发送失败：UPSTREAM_UNKNOWN' },
  ];
  const cols = mergeThread(pending, remote, 'p-biz');
  // 客户列：远端两行（p-biz 视角第一行为"我"、cit-1 为对端）+ 未留档 pending 不入客户列
  assert.equal(cols.customer.length, 2);
  assert.equal(cols.customer[0].mine, true);
  assert.equal(cols.customer[0].senderLabel, '我');
  assert.equal(cols.customer[1].mine, false);
  assert.equal(cols.customer[1].senderLabel, 'cit-1');
  assert.ok(cols.customer[0].key.startsWith('r:'), '远端行 key 以 r: 前缀稳定去重');
  // 内部列：requestId 未被服务端留档的 pending 保留占位（失败态可见）
  assert.equal(cols.internal.length, 1);
  assert.equal(cols.internal[0].state.includes('发送失败'), true);
});

test('线程合并：requestId 留档后 pending 行退出，不双显示；空线程含 pending 仍可见', () => {
  const pending = [{ id: 'p9', requestId: 'wb-9', audience: 'customer', text: '在途', at: 't', state: '已送达（服务端回执）' }];
  const emptyOnly = mergeThread(pending, [], 'p-biz');
  assert.equal(emptyOnly.customer.length, 1, '服务端尚无线程时在途行占位可见');
  const acked = mergeThread(pending, [{ messageId: 'r9', requestId: 'wb-9', audience: 'customer', text: '在途', senderPrincipalId: 'p-biz', at: 't' }], 'p-biz');
  assert.equal(acked.customer.length, 1);
  assert.ok(acked.customer[0].key.startsWith('r:'), '已留档的 pending 退出，由远端行取代');
});

// ---- goal-03e 原件预览（IR-03-3 / CONTRACT §11.2）投影 ----

test('预览类型投影：image/text 内联、其余下载兜底；data:URL 组装不经外部域', () => {
  assert.equal(previewKind('image/png', 'a.png'), 'image');
  assert.equal(previewKind('text/csv', 'b.csv'), 'text');
  assert.equal(previewKind('application/json', null), 'text');
  assert.equal(previewKind('application/pdf', 'c.pdf'), 'download');
  assert.equal(previewKind(null, 'd.bin'), 'download');
  assert.equal(envelopeDataUrl('image/png', 'aGk='), 'data:image/png;base64,aGk=', 'CSP img-src data: 放行');
});

test('魔数嗅探：octet-stream 下的 PNG/JPEG/GIF 识别为图片 mime（通道对象面）', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
  const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38]);
  const csv = new Uint8Array([0x61, 0x2c, 0x62]);
  assert.equal(sniffImageMime(png), 'image/png');
  assert.equal(sniffImageMime(jpeg), 'image/jpeg');
  assert.equal(sniffImageMime(gif), 'image/gif');
  assert.equal(sniffImageMime(csv), null, '非图片字节如实回 null');
});

test('提案确认计划：facility.propose 标题与依据包绑定行进确认（DEF-G04N-04 页面侧）', () => {
  const p = buildConfirmPlan('facility.propose', 'cust-1', [
    '提案（候选）：500 万 / 36 个月',
    '绑定评估：asm_1',
    '绑定依据包：pkg_9',
  ], 'wb-act:cust-1:facility.propose:n');
  assert.match(p.title, /额度提案/);
  assert.ok(p.lines.some((l) => l.includes('pkg_9')), '确认框必须展示所绑定的依据包引用');
  assert.match(errorText('BASIS_PACKAGE_REQUIRED'), /必须绑定依据包/, '409 业务语言如实映射');
});

// ---------------------------------------------------------------------------
// board-round-02 任务01：方案R 统一链投影 + 业务看板阶段概览（纯逻辑新增面）
// ---------------------------------------------------------------------------
import {
  channelBridgeView,
  deriveLifecycleStages,
  deriveBoardSummary,
} from '../../site-mirror/lib/workbench/wb-logic.ts';

test('方案R 通道任务投影：blocked_* 等待态与 aRegistered/bridgeState 逐任务字段映射', () => {
  const rows = channelTaskRows([
    { task_id: 't1', evidence_id: 'e1', kind: 'bank_statement', status: 'blocked_link', stage_cursor: 'parse', attempts: 2, failure_code: 'A_CUSTOMER_NOT_IN_A' },
    { task_id: 't2', evidence_id: 'e2', kind: 'invoice', status: 'running', aRegistered: false, bridgeState: 'none' },
    { task_id: 't3', evidence_id: 'e3', kind: 'invoice', status: 'done', aRegistered: true, bridgeState: 'registered' },
  ]);
  assert.match(rows[0].statusText, /被阻断（A 客户关联未建立/, 'blocked_link 等待态业务语言（自动续跑，不冒充失败/完成）');
  assert.match(errorText(rows[0].failureCode), /A 档案中未找到对应客户/, 'failure_code → 业务语言');
  assert.equal(rows[1].bridgeText, '未回写 A', '运行中任务如实显示未回写');
  assert.equal(rows[2].bridgeText, '已回写 A 档案', 'registered=已回写');
  assert.equal(rows[2].bridgeTone, 'green');
});

test('方案R 诚实性核心：done 且未回写 A 不得呈现为全链完成（本地完成标注）', () => {
  const localDone = channelBridgeView('done', false, 'none');
  assert.match(localDone.text, /本地完成（未回写 A：不等于全链完成）/, 'localOnly/done+未回写 ≠ 全链完成');
  assert.equal(localDone.tone, 'yellow');
  assert.match(channelBridgeView('done', true, 'registered').text, /已回写 A/);
  assert.match(channelBridgeView('running', false, 'unknown').text, /A 登记对账中/);
  assert.equal(channelBridgeView('running', null, null).tone, 'gray', '字段缺失=未知，不猜');
});

test('业务看板阶段概览：空快照=全部未开始+结清未支持；服务端字段驱动各段状态', () => {
  const empty = deriveLifecycleStages(null);
  assert.equal(empty.length, 7, '商机/尽调/政策/信审/商务/资产/结清 七段');
  assert.equal(empty.find((s) => s.key === 'settle').state, 'unsupported', '结清如实标未支持（不编造）');
  assert.ok(empty.every((s) => s.key !== 'settle' ? s.state === 'pending' || s.state === 'unsupported' : true));

  const rows = deriveLifecycleStages({
    customer: { customerId: 'cus_1', displayName: '喀什客户', status: 'active' },
    session: { runStatus: 'in_progress' },
    decisionStatus: { basis: { packageId: 'pkg_1', currency: [{ domain: 'policy', currency: 'current' }, { domain: 'credit', currency: 'stale' }] } },
    facilities: [{ status: 'proposed' }],
    financingRequests: [{ status: 'submitted' }],
  });
  assert.equal(rows.find((s) => s.key === 'opportunity').state, 'done');
  assert.equal(rows.find((s) => s.key === 'due_diligence').state, 'active');
  assert.equal(rows.find((s) => s.key === 'policy').state, 'done', '域 currency=current → 该段有当前产出（≠批准）');
  assert.equal(rows.find((s) => s.key === 'credit').state, 'active', 'stale=需更新');
  assert.equal(rows.find((s) => s.key === 'commerce').state, 'active', '设施候选≠批准');
  assert.equal(rows.find((s) => s.key === 'asset').state, 'active');
  assert.equal(rows.find((s) => s.key === 'settle').state, 'unsupported');
});

test('业务看板顶部摘要：融资申请与授信额度分列；采购金额不以授信额度冒充', () => {
  const lines = deriveBoardSummary({ financingRequests: [{ status: 'submitted' }], facilities: [{ status: 'active' }] });
  assert.ok(lines.some((l) => l.label === '融资申请'), '融资申请独立行');
  assert.ok(lines.some((l) => l.label === '授信额度'), '授信额度独立行（额度≠项目融资）');
  const purchase = lines.find((l) => l.label === '项目采购金额');
  assert.match(purchase.value, /不用授信额度冒充/, '采购金额诚实标注数据来源边界');
});
