// 多结果聚合不变量(R2 Goal 工作包4):
//  - 异议丢失 0:dissent 全量保留,任何参数都不得过滤它;
//  - 越权决定 0:pendingDecisions 只列冲突条目,绝不含决定/批准类字段;
//  - 去重不吞关键项:相同 text 合并 sources;关键追问(unresolved)绝不丢失;
//  - 非法输入 TypeError;空数组空结构;两次聚合逐字节确定。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateResults } from '../../src/aggregate.mjs';
import { makeEvidence } from '../helpers.mjs';

/** 适配器结果形状的最小合成件(与 adapter.mjs 成功结果的 findings/questions/dissent 同构)。 */
function makeResult(requestId, overrides = {}) {
  return {
    requestId,
    findings: [],
    questions: [],
    dissent: [],
    ...overrides,
  };
}

const EV = makeEvidence(2);

test('两个同证据不同结论的结果聚合:findings 与 dissent 全保留(异议丢失 0),findings 附来源', () => {
  const r1 = makeResult('req-A', {
    findings: [{ id: 'F1', text: '结论A:回款周期风险可控。', evidenceRefs: [{ ...EV[0] }] }],
    dissent: [{ id: 'D1', position: 'original', text: '专业原意见:证据充分。', evidenceRefs: [{ ...EV[0] }], conflictsWith: [] }],
  });
  const r2 = makeResult('req-B', {
    findings: [{ id: 'F1', text: '结论B:同一凭证显示回款周期存疑。', evidenceRefs: [{ ...EV[0] }] }],
    dissent: [
      { id: 'D1', position: 'dissenting', text: '不同结论:该凭证不足以支持结论A。', evidenceRefs: [{ ...EV[0] }], conflictsWith: ['F1'] },
      { id: 'D2', position: 'original', text: '补充原意见:现场访谈与结论A一致。', evidenceRefs: [{ ...EV[1] }], conflictsWith: [] },
    ],
  });
  const agg = aggregateResults([r1, r2]);
  assert.equal(agg.findings.length, 2, '发现全保留,不合并不裁剪');
  assert.deepEqual(agg.findings.map((f) => f.sourceRequestId), ['req-A', 'req-B'], '每条发现可回溯来源请求');
  assert.equal(agg.dissent.length, 3, '三条异议一条不丢(异议丢失 0)');
  assert.deepEqual(agg.dissent.map((d) => d.sourceRequestId), ['req-A', 'req-B', 'req-B']);
  assert.deepEqual(agg.dissent.map((d) => d.position), ['original', 'dissenting', 'original']);
  assert.equal(agg.stats.findingsTotal, 2);
  assert.equal(agg.stats.dissentTotal, 3);
});

test('相同 text 问题去重:合并为一条并保留 sources:[requestId...]', () => {
  const r1 = makeResult('req-A', {
    questions: [{ id: 'Q1', text: '请补充下季度回款计划。', evidenceRefs: [] }],
  });
  const r2 = makeResult('req-B', {
    questions: [{ id: 'Q9', text: '请补充下季度回款计划。', evidenceRefs: [{ ...EV[0] }] }],
  });
  const agg = aggregateResults([r1, r2]);
  assert.equal(agg.questions.length, 1, 'text 精确相同的追问合并');
  assert.equal(agg.questions[0].text, '请补充下季度回款计划。');
  assert.deepEqual(agg.questions[0].sources, ['req-A', 'req-B'], '合并项保留全部来源请求 id');
  assert.equal(agg.questions[0].id, 'Q1', '保留首次出现的 id');
  assert.equal(agg.questions[0].evidenceRefs.length, 1, '证据引用合并去重,不丢失 req-B 的引用');
  assert.equal(agg.stats.questionsDeduped, 1);
});

test('不同 text 的关键追问全部保留:去重不吞掉任何一条', () => {
  const r1 = makeResult('req-A', {
    questions: [
      { id: 'Q1', text: '追问一:抵押物权属证明原件在哪?', evidenceRefs: [{ ...EV[0] }] },
      { id: 'Q2', text: '追问二:关联方资金往来明细?请提供。', evidenceRefs: [{ ...EV[1] }] },
    ],
  });
  const r2 = makeResult('req-B', {
    questions: [{ id: 'Q3', text: '追问三:担保合同签署人权限?请说明。', evidenceRefs: [{ ...EV[0] }] }],
  });
  const agg = aggregateResults([r1, r2]);
  assert.equal(agg.questions.length, 3);
  assert.equal(agg.unresolvedQuestions.length, 3, '引用了证据的追问全部进入关键未解决清单');
  assert.ok(agg.unresolvedQuestions.some((q) => q.id === 'Q1' && q.sources.length === 1));
  assert.ok(agg.unresolvedQuestions.every((q) => q.evidenceRefs.length > 0 || q.mustResolve === true));
});

test('mustResolve 标记的无引用追问也进入 unresolvedQuestions;去重合并后标记保留', () => {
  const r1 = makeResult('req-A', {
    questions: [{ id: 'Q1', text: '请确认实际控制人是否在经营现场。', evidenceRefs: [], mustResolve: true }],
  });
  const r2 = makeResult('req-B', {
    questions: [{ id: 'Q2', text: '请确认实际控制人是否在经营现场。', evidenceRefs: [] }],
  });
  const agg = aggregateResults([r1, r2]);
  assert.equal(agg.questions.length, 1, '相同 text 仍合并');
  assert.equal(agg.unresolvedQuestions.length, 1, 'mustResolve 任一来源为 true 即为关键项,不因去重丢失');
  assert.equal(agg.unresolvedQuestions[0].mustResolve, true);
  assert.deepEqual(agg.unresolvedQuestions[0].sources, ['req-A', 'req-B']);
});

test('conflictsWith 非空 → pendingDecisions 列出冲突双方,且绝不含决定性字段(越权决定 0)', () => {
  const r1 = makeResult('req-A', {
    findings: [{ id: 'F1', text: '结论A:风险可控。', evidenceRefs: [{ ...EV[0] }] }],
    dissent: [{ id: 'D1', position: 'dissenting', text: '不同结论:证据不足。', evidenceRefs: [{ ...EV[0] }], conflictsWith: ['F1'] }],
  });
  const r2 = makeResult('req-B', {
    findings: [{ id: 'F2', text: '结论B:回款周期存疑。', evidenceRefs: [{ ...EV[0] }] }],
    dissent: [{ id: 'D9', position: 'dissenting', text: '不同结论:应补充访谈后再定。', evidenceRefs: [{ ...EV[1] }], conflictsWith: ['F2', 'Q1'] }],
  });
  const agg = aggregateResults([r1, r2]);
  assert.equal(agg.pendingDecisions.length, 2, '两条显式冲突各列一个待人决定条目');
  const pd1 = agg.pendingDecisions.find((p) => p.sides.includes('D1'));
  assert.deepEqual(pd1.sides, ['D1', 'F1'], '只列出冲突双方 id,不裁决谁对谁错');
  assert.deepEqual(pd1.sourceRequestIds, ['req-A']);
  const allKeys = new Set(agg.pendingDecisions.flatMap((p) => Object.keys(p)));
  for (const k of allKeys) {
    assert.ok(['id', 'sides', 'sourceRequestIds'].includes(k), `待人决定条目只允许 id/sides/来源类字段,实际出现:${k}`);
  }
  for (const p of agg.pendingDecisions) {
    const serialized = JSON.stringify(p).toLowerCase();
    assert.ok(!serialized.includes('approv'), '不得出现批准类语义');
    assert.ok(!serialized.includes('decision:'), '不得出现决定值语义');
    assert.ok(!('decision' in p) && !('approved' in p) && !('verdict' in p), '不得携带决定性字段');
  }
});

test('position=dissenting 且无 conflictsWith:与其来源结果 findings 构成隐式冲突对,同样只列不裁', () => {
  const r = makeResult('req-A', {
    findings: [{ id: 'F1', text: '结论:风险可控。', evidenceRefs: [{ ...EV[0] }] }],
    dissent: [{ id: 'D1', position: 'dissenting', text: '不同结论:依据不足。', evidenceRefs: [{ ...EV[0] }], conflictsWith: [] }],
  });
  const agg = aggregateResults([r]);
  assert.equal(agg.pendingDecisions.length, 1);
  assert.deepEqual(agg.pendingDecisions[0].sides, ['D1', 'F1']);
  assert.deepEqual(Object.keys(agg.pendingDecisions[0]), ['id', 'sides', 'sourceRequestIds']);
});

test('original 意见且无 conflictsWith:不产生待人决定条目', () => {
  const r = makeResult('req-A', {
    findings: [{ id: 'F1', text: '结论:一致。', evidenceRefs: [{ ...EV[0] }] }],
    dissent: [{ id: 'D1', position: 'original', text: '专业原意见:证据充分。', evidenceRefs: [{ ...EV[0] }], conflictsWith: [] }],
  });
  const agg = aggregateResults([r]);
  assert.deepEqual(agg.pendingDecisions, []);
});

test('dedupeQuestions=false:问题全部保留;该参数绝不作用于 dissent(异议仍全保留)', () => {
  const q = { id: 'Q1', text: '同一问句。', evidenceRefs: [] };
  const d = { id: 'D1', position: 'original', text: '原意见。', evidenceRefs: [{ ...EV[0] }], conflictsWith: [] };
  const results = [
    makeResult('req-A', { questions: [{ ...q }], dissent: [{ ...d }] }),
    makeResult('req-B', { questions: [{ ...q }], dissent: [{ ...d }] }),
  ];
  const aggNo = aggregateResults(results, { dedupeQuestions: false });
  assert.equal(aggNo.questions.length, 2, '关闭去重后问题全保留');
  assert.deepEqual(aggNo.questions.map((x) => x.sources), [['req-A'], ['req-B']]);
  assert.equal(aggNo.dissent.length, 2, '无论参数如何,异议一条不丢');
  assert.equal(aggNo.stats.questionsDeduped, 0);

  const aggYes = aggregateResults(results, { dedupeQuestions: true });
  assert.equal(aggYes.questions.length, 1);
  assert.equal(aggYes.dissent.length, 2, '开启去重同样不得抹任何异议');
});

test('空数组输入 → 空结构(不抛错)', () => {
  const agg = aggregateResults([]);
  assert.deepEqual(agg, {
    findings: [],
    dissent: [],
    questions: [],
    unresolvedQuestions: [],
    pendingDecisions: [],
    stats: { inputCount: 0, findingsTotal: 0, dissentTotal: 0, questionsDeduped: 0 },
  });
});

test('非法输入 → TypeError:非数组 / 元素缺 requestId / requestId 非字符串', () => {
  assert.throws(() => aggregateResults(null), TypeError);
  assert.throws(() => aggregateResults('nope'), TypeError);
  assert.throws(() => aggregateResults([{ findings: [] }]), /requestId/, '元素缺 requestId 必须显式报错');
  assert.throws(() => aggregateResults([makeResult('req-A'), { requestId: 42 }]), TypeError, 'requestId 必须是非空字符串');
  assert.throws(() => aggregateResults([makeResult('  ')]), TypeError);
  assert.throws(() => aggregateResults([makeResult('req-A')], { dedupeQuestions: 'yes' }), TypeError);
});

test('确定性:相同输入两次聚合,JSON 逐字节相等', () => {
  const results = [
    makeResult('req-A', {
      findings: [{ id: 'F1', text: '结论A。', evidenceRefs: [{ ...EV[0] }] }],
      questions: [{ id: 'Q1', text: '同一问句。', evidenceRefs: [] }],
      dissent: [{ id: 'D1', position: 'dissenting', text: '不同结论。', evidenceRefs: [{ ...EV[0] }], conflictsWith: ['F1'] }],
    }),
    makeResult('req-B', {
      questions: [{ id: 'Q1', text: '同一问句。', evidenceRefs: [{ ...EV[1] }] }],
      dissent: [{ id: 'D1', position: 'original', text: '原意见。', evidenceRefs: [{ ...EV[1] }], conflictsWith: [] }],
    }),
  ];
  const a1 = aggregateResults(results);
  const a2 = aggregateResults(results);
  assert.equal(JSON.stringify(a1), JSON.stringify(a2), '聚合必须是确定性的(无时钟/随机/外部状态)');
  assert.notEqual(a1.findings[0], results[0].findings[0], '不复用输入对象引用(纯函数不改输入)');
  assert.equal(results[0].findings[0].sourceRequestId, undefined, '输入对象不被修改');
});
