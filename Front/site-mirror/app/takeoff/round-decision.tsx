import type { ColumnReceipt } from '../../lib/workbench/advance-client';
const labels:Record<string,string>={summary:'摘要',assessment:'专业分析',reason:'原因',unknowns:'待补信息',contradictions:'信息矛盾',findingsSuspicion:'待核查事项',sourceMode:'来源模式',authority:'决定权限',confidence:'置信度',calibration:'校准情况',selection:'人工选择',candidate:'分析候选',analysisRun:'分析记录',materialRefs:'材料引用',unreadable:'未能读取的材料',ok:'分析成功',value:'结果',factKey:'事实项',sourceRef:'依据来源',candidates:'候选方案',label:'方案',impact:'影响'};
function Value({value,depth=0}:{value:unknown;depth?:number}){
 if(value===null||value===undefined)return <span>未提供</span>;
 if(typeof value==='boolean')return <span>{value?'是':'否'}</span>;
 if(typeof value!=='object')return <span>{String(value)}</span>;
 if(depth>5)return <span>内容过长，已省略展示</span>;
 if(Array.isArray(value))return value.length?<ul>{value.map((v,i)=><li key={i}><Value value={v} depth={depth+1}/></li>)}</ul>:<span>无</span>;
 return <dl>{Object.entries(value).map(([key,v])=><div key={key}><dt>{labels[key]??key}</dt><dd><Value value={v} depth={depth+1}/></dd></div>)}</dl>;
}
/** 业务可读的候选摘要（FINAL-02）：从候选对象取人会读的字段拼一句话；取不到的字段如实缺席，
 * 不编造。原始字段（stale/domain/knownFacts/evidenceRefs 等）只进默认折叠的技术明细。 */
function candidateBrief(candidate: unknown): { tendency: string; summary: string; extra: string[] } {
  const c = (candidate ?? null) as { tendency?: unknown; summary?: unknown; ruleRankNote?: unknown; ruleRank?: unknown; amountMinor?: unknown; suggestedAmountMinor?: unknown; termMonths?: unknown } | null;
  const TENDENCY: Record<string, string> = { do: '建议推进', do_not: '不建议推进', review: '需复核后再定' };
  const t = typeof c?.tendency === 'string' ? (TENDENCY[c.tendency] ?? `倾向：${c.tendency}`) : '';
  const summary = typeof c?.summary === 'string' && c.summary.trim() ? c.summary.trim() : '';
  const extra: string[] = [];
  const amt = typeof c?.amountMinor === 'number' ? c.amountMinor : typeof c?.suggestedAmountMinor === 'number' ? c.suggestedAmountMinor : null;
  if (amt != null) { const wan = amt / 1_000_000; extra.push(`金额 ${wan.toLocaleString('zh-CN', { maximumFractionDigits: 2 })} 万元`); }
  if (typeof c?.termMonths === 'number') extra.push(`期限 ${c.termMonths} 个月`);
  if (typeof c?.ruleRankNote === 'string' && c.ruleRankNote.trim()) extra.push(c.ruleRankNote.trim());
  else if (c?.ruleRank != null) extra.push('按规则排序列出（概率未校准不显示）');
  return { tendency: t, summary, extra };
}
/** Read the immutable round view; do not blend in a newer chat-generated candidate set. */
export function RoundDecision({round}:{round:ColumnReceipt}){
 const view=round.views?.decisions;
 const selection=view?.selection as {eventId?:string;candidateId?:string}|null|undefined;
 const brief=candidateBrief(view?.candidate);
 // CLOSE-02（FINAL 遗留2）：服务端 ISO 时间本地化为可读格式；解析失败如实显示原值。
 const atText = round.updatedAt && Number.isFinite(Date.parse(round.updatedAt))
   ? new Date(round.updatedAt).toLocaleString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
   : (round.updatedAt ?? '服务端时间未提供');
 return <div className="tk-round-decision" data-round-id={round.roundId} data-round-version={round.version}>
  <strong>本轮专业分析 · v{round.version}</strong><p>{atText}{round.current?'':' · 历史依据'}</p>
  {!view?<p>本轮决策视图未返回，不以其他版本候选代替。</p>:<>
   <p>分析候选不等于正式批准；未校准置信度不显示概率。</p>
   <div className="tk-round-brief">
    {brief.tendency && <p><strong>{brief.tendency}</strong></p>}
    {brief.summary && <p>{brief.summary}</p>}
    {brief.extra.length > 0 && <p>{brief.extra.join(' · ')}</p>}
    {!brief.tendency && !brief.summary && brief.extra.length === 0 && <p>本轮候选摘要字段未返回，明细见下方技术明细。</p>}
    {selection?.eventId && selection.candidateId
      ? <p>已记录的人工选择：本区已按所选方案确认（选择记录可在下方技术明细核对）。</p>
      : <p>尚未记录人工选择：默认建议不等于确认，确认由有权人员在办理区完成。</p>}
   </div>
   <details className="tk-round-tech">
    <summary>技术明细（原始字段）</summary>
    <Value value={view.candidate}/>
    <div className={selection?.eventId&&selection.candidateId?'tk-round-selected':''}><strong>已记录的人工选择</strong><Value value={view.selection}/></div>
   </details>
   {view.reason&&<p>{String(view.reason)}</p>}
  </>}
 </div>;
}
