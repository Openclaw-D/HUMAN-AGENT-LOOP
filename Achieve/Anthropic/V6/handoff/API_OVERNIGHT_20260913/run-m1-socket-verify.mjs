// A路：M1 全链路 socket 级验证驱动（3468 隔离实例 + 本地 mock 模型端点；非真实模型调用）。
// 链路：建会话→附证据→标注→真实分析①→客户补充→真实分析②→人工纠正→真实分析③→刷新读回。
const BASE = 'http://127.0.0.1:3468/api/v5-preview/remote-session';

async function getVersion() {
  const r = await fetch(BASE);
  return (await r.json()).remoteVersion;
}

async function post(path, body) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const expectedVersion = await getVersion();
    const r = await fetch(path === '' ? BASE : `${BASE}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedVersion, ...body }),
    });
    const data = await r.json();
    if (data.ok === true) return data;
    if (data.error !== 'VERSION_CONFLICT') throw new Error(`${path || '(root)'} 失败: ${JSON.stringify(data).slice(0, 300)}`);
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
  throw new Error(`${path || '(root)'} VERSION_CONFLICT 重试耗尽`);
}

const M1Q = '业务标疑（设备清单页）：客户实控人声称该数控横切机为“2021年购入、发票齐全、几乎全新”。本页清单所载：型号QM-NC2200，序列号SL-2021-0337，主机出厂日期2021-03。合同要素页载明：设备买卖合同签订于2022-05，合同价505万元。另据电费记录摘录，近6个月月均用电约4.1万kWh。请依据以上材料核对：该设备的取得/购买时点口径是否一致？如发现疑点，请列出疑点、说明依据（对应哪份材料），并给出建议向客户追问的问题。不要给出批准、否决、额度或价格建议。';
const SUPPLEMENT = '客户补充说明（实控人口述，业务代录）：2021年11月与厂方签了订购协议并付定金，设备主机2021年3月出厂；2022年5月正式签买卖合同、6月付清尾款、7月到厂安装。我们说的“2021年购入”是从签订订购协议算起。订购协议、定金收据和尾款付款凭证都可以补交。';
const CORRECTION = '人工更正：首次沟通纪要中“年产值约450万元”系业务记录笔误，经与客户财务人员核对应为“月产值约450万元”，现予更正；该数字仍未经书面台账核实。更正前基于“年产值”的产能-能耗匹配分析一律作废。';

function showAnalyze(stage, data) {
  const real = data.annotation.replies.filter((r) => r.kind === 'model_real');
  const finding = [...real].reverse().find((r) => r.text.includes('疑点'));
  console.log(`${stage}: source=${data.source} basedOn=${JSON.stringify(data.basedOn)} usage=${JSON.stringify(data.usage)} model_real累计=${real.length}`);
  if (finding) console.log(`  最新发现: ${finding.text.slice(0, 170)}`);
}

const session = await post('', { requestId: 'm1s-session-01', title: 'M1 socket验证·岐明包装机械（虚构）·合成演示' });
const sid = session.session.sessionId;
console.log('S0 会话:', sid);

await post('evidence', { requestId: 'm1s-attach-e1-01', sessionId: sid, fixtureId: 'fixture-equipment' });
await post('evidence', { requestId: 'm1s-attach-e2-01', sessionId: sid, fixtureId: 'fixture-contract' });
const detail1 = await (await fetch(`${BASE}/detail?sessionId=${sid}`)).json();
const equip = [...detail1.evidence].reverse().find((e) => e.fixtureId === 'fixture-equipment' && !e.expired);
console.log('S1 证据:', detail1.evidence.length, '条；设备清单=', equip.evidenceId);

const ann = await post('annotations', {
  requestId: 'm1s-annot-q1-01', sessionId: sid, evidenceId: equip.evidenceId, evidenceVersion: equip.version,
  question: M1Q, rect: { x: 0.05, y: 0.05, w: 0.3, h: 0.2 },
});
const annId = ann.annotation.annotationId;
console.log('S2-Q 标注:', annId);

const a1 = await post('annotations/analyze', { requestId: 'm1s-analyze-01', sessionId: sid, annotationId: annId });
showAnalyze('S2-A1 分析①（仅早期资料）', a1);

await post('annotations/replies', { requestId: 'm1s-reply-cust-01', sessionId: sid, annotationId: annId, kind: 'business', text: SUPPLEMENT });
console.log('S3-R1 客户补充已提交（business）');

const a2 = await post('annotations/analyze', { requestId: 'm1s-analyze-02', sessionId: sid, annotationId: annId });
showAnalyze('S3-A2 分析②（读到客户补充）', a2);

await post('annotations/replies', { requestId: 'm1s-corr-01', sessionId: sid, annotationId: annId, kind: 'domain', text: CORRECTION });
console.log('S4-R2a 人工更正已提交（domain）');

const a3 = await post('annotations/analyze', { requestId: 'm1s-analyze-03', sessionId: sid, annotationId: annId });
showAnalyze('S4-A3 分析③（读到人工纠正）', a3);

const detail2 = await (await fetch(`${BASE}/detail?sessionId=${sid}`)).json();
const stored = detail2.annotations.find((a) => a.annotationId === annId);
const kinds = stored.replies.reduce((acc, r) => ({ ...acc, [r.kind]: (acc[r.kind] ?? 0) + 1 }), {});
const declarations = stored.replies.filter((r) => r.kind === 'model_real' && r.text.includes('source=real'));
console.log('S6 刷新读回: replies kinds =', JSON.stringify(kinds), '| 分析声明数 =', declarations.length);
for (const d of declarations) console.log('  -', d.text.slice(0, 130));
console.log('CHAIN COMPLETE');
