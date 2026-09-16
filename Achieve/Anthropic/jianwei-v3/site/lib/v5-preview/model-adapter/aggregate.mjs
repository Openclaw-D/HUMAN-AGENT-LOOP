// 多结果聚合纯函数(R2 Goal 工作包4:候选结构支持专业原意见、不同结论、依据引用、
// 冲突与待人决定)。
//
// 三条不变量(与输出守门同等地位,逐条可测):
//  1. 聚合绝不抹异议:dissent 全量保留,任何过滤/去重参数都不得作用于 dissent;
//  2. 聚合绝不裁决:pendingDecisions 只列出冲突双方条目 id(待人决定),不产生任何
//     决定/批准/通过类字段或语义(越权决定 0);Human 是唯一 authority 主体;
//  3. 去重不吞关键项:提问去重只合并 text 精确相同的条目并保留全部 sources;
//     引用了证据或标记 mustResolve 的追问进入 unresolvedQuestions,绝不因去重丢失。
//
// 确定性:输出只由输入决定(无时钟、无随机、无外部状态);相同输入两次聚合结果
// 逐字节相等。零依赖、零副作用,不修改输入对象。

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function refKeyOf(ref) {
  return `${ref.id}\u0000${ref.version}\u0000${ref.hash}`;
}

function refsOf(q) {
  return Array.isArray(q.evidenceRefs) ? q.evidenceRefs : [];
}

/** 把单条问题规范化为统一形状(不丢任何来源信息)。 */
function questionEntryOf(q, requestId) {
  return {
    id: q.id,
    text: q.text,
    evidenceRefs: refsOf(q).map((r) => ({ ...r })),
    mustResolve: q.mustResolve === true, // 提供方可用 mustResolve 标记关键未解决项
    sources: [requestId],                // 该问题文本出现过的请求 id(合并时累加)
  };
}

/**
 * 聚合多个适配器结果(纯函数)。
 * @param {Array} results 适配器结果数组;每个元素必须是对象且携带非空字符串 requestId。
 * @param {{ dedupeQuestions?: boolean }} options dedupeQuestions 缺省 true:按 text 精确
 *   重复合并问题,合并项保留 sources:[requestId...];false 时全部保留。该参数只作用于
 *   questions,绝不作用于 dissent。
 * @returns {{
 *   findings: Array, dissent: Array, questions: Array, unresolvedQuestions: Array,
 *   pendingDecisions: Array, stats: { inputCount, findingsTotal, dissentTotal, questionsDeduped }
 * }}
 * @throws {TypeError} results 非数组、元素缺 requestId、或 options/dedupeQuestions 类型非法。
 */
export function aggregateResults(results, { dedupeQuestions = true } = {}) {
  if (!Array.isArray(results)) {
    throw new TypeError('聚合输入非法:results 必须是结果数组');
  }
  if (typeof dedupeQuestions !== 'boolean') {
    throw new TypeError('聚合参数非法:dedupeQuestions 必须是布尔值');
  }
  for (let i = 0; i < results.length; i += 1) {
    const r = results[i];
    if (!isPlainObject(r) || typeof r.requestId !== 'string' || r.requestId.trim() === '') {
      throw new TypeError(`聚合输入非法:results[${i}] 缺少有效 requestId(必须是非空字符串),聚合产物必须可回溯到来源请求`);
    }
  }

  const findings = [];
  const dissent = [];
  const rawQuestions = [];
  const findingIdsByRequest = new Map(); // requestId -> 该结果全部 finding id(用于待人决定条目配对)
  let findingsTotal = 0;
  let dissentTotal = 0;

  for (const result of results) {
    const requestId = result.requestId;
    const resFindings = Array.isArray(result.findings) ? result.findings : [];
    findingIdsByRequest.set(requestId, resFindings.map((f) => (isPlainObject(f) ? f.id : undefined)));
    for (const f of resFindings) {
      findingsTotal += 1;
      // 全部保留,只附加来源标识,不删不改任何内容(发现不做跨结果去重)。
      findings.push({ ...f, sourceRequestId: requestId });
    }
    // 不变量1:dissent 全量保留——任何过滤/去重参数都不得作用于异议。
    const resDissent = Array.isArray(result.dissent) ? result.dissent : [];
    for (const d of resDissent) {
      dissentTotal += 1;
      dissent.push({ ...d, sourceRequestId: requestId });
    }
    const resQuestions = Array.isArray(result.questions) ? result.questions : [];
    for (const q of resQuestions) {
      rawQuestions.push({ q, requestId });
    }
  }

  // 问题去重:仅按 text 精确相同合并;合并项保留全部 sources、合并去重后的证据引用、
  // mustResolve 只要任一来源为 true 即保留。dedupeQuestions=false 时全部原样保留。
  const questions = [];
  if (!dedupeQuestions) {
    for (const { q, requestId } of rawQuestions) {
      questions.push(questionEntryOf(q, requestId));
    }
  } else {
    const byText = new Map(); // text -> { entry, refKeys }
    for (const { q, requestId } of rawQuestions) {
      if (!byText.has(q.text)) {
        const entry = questionEntryOf(q, requestId);
        byText.set(q.text, { entry, refKeys: new Set(entry.evidenceRefs.map(refKeyOf)) });
        questions.push(entry);
        continue;
      }
      const merged = byText.get(q.text);
      if (!merged.entry.sources.includes(requestId)) merged.entry.sources.push(requestId);
      if (q.mustResolve === true) merged.entry.mustResolve = true;
      for (const ref of refsOf(q)) {
        const key = refKeyOf(ref);
        if (!merged.refKeys.has(key)) {
          merged.refKeys.add(key);
          merged.entry.evidenceRefs.push({ ...ref });
        }
      }
    }
  }

  // 不变量3:关键未解决项——引用了证据或标记 mustResolve 的追问绝不因去重丢失
  // (去重本身合并而非删除,这里再显式单列,保证消费方可直接拿到待人追问清单)。
  const unresolvedQuestions = questions.filter(
    (q) => (Array.isArray(q.evidenceRefs) && q.evidenceRefs.length > 0) || q.mustResolve === true,
  );

  // 不变量2:待人决定——只列条目,不裁决。推导规则(确定性,无语义推断):
  //  a) dissent.conflictsWith 非空:显式冲突,sides = [异议 id, ...被冲突的 finding/question id];
  //  b) position === 'dissenting'(不同结论):与其来源结果内的 findings 构成隐式冲突对。
  // 每个条目只含 id / sides / sourceRequestIds,不含任何 approve/decision 类字段。
  const pendingDecisions = [];
  let pdSeq = 0;
  for (const d of dissent) {
    const sides = [d.id];
    const seen = new Set([d.id]);
    const pushTargets = (ids) => {
      if (!Array.isArray(ids)) return;
      for (const t of ids) {
        if (typeof t === 'string' && !seen.has(t)) {
          seen.add(t);
          sides.push(t);
        }
      }
    };
    pushTargets(d.conflictsWith);
    if (d.position === 'dissenting') {
      pushTargets(findingIdsByRequest.get(d.sourceRequestId));
    }
    if (sides.length < 2) continue; // 没有可配对的另一方,不构成本轮待人决定条目
    pdSeq += 1;
    pendingDecisions.push({ id: `PD-${pdSeq}`, sides, sourceRequestIds: [d.sourceRequestId] });
  }

  return {
    findings,
    dissent, // 全量,与输入同序;聚合层没有任何参数能过滤它
    questions,
    unresolvedQuestions,
    pendingDecisions,
    stats: {
      inputCount: results.length,
      findingsTotal,
      dissentTotal,
      questionsDeduped: rawQuestions.length - questions.length,
    },
  };
}
