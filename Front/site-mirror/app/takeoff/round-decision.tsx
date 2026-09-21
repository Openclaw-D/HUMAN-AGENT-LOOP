import type { ColumnReceipt } from '../../lib/workbench/advance-client';
const labels:Record<string,string>={summary:'摘要',assessment:'专业分析',reason:'原因',unknowns:'待补信息',contradictions:'信息矛盾',findingsSuspicion:'待核查事项',sourceMode:'来源模式',authority:'决定权限',confidence:'置信度',calibration:'校准情况',selection:'人工选择',candidate:'分析候选',analysisRun:'分析记录',materialRefs:'材料引用',unreadable:'未能读取的材料',ok:'分析成功',value:'结果',factKey:'事实项',sourceRef:'依据来源',candidates:'候选方案',label:'方案',impact:'影响'};
function Value({value,depth=0}:{value:unknown;depth?:number}){
 if(value===null||value===undefined)return <span>未提供</span>;
 if(typeof value==='boolean')return <span>{value?'是':'否'}</span>;
 if(typeof value!=='object')return <span>{String(value)}</span>;
 if(depth>5)return <span>{JSON.stringify(value)}</span>;
 if(Array.isArray(value))return value.length?<ul>{value.map((v,i)=><li key={i}><Value value={v} depth={depth+1}/></li>)}</ul>:<span>无</span>;
 return <dl>{Object.entries(value).map(([key,v])=><div key={key}><dt>{labels[key]??key}</dt><dd><Value value={v} depth={depth+1}/></dd></div>)}</dl>;
}
/** Read the immutable round view; do not blend in a newer chat-generated candidate set. */
export function RoundDecision({round}:{round:ColumnReceipt}){
 const view=round.views?.decisions;
 const selection=view?.selection as {eventId?:string;candidateId?:string}|null|undefined;
 return <div className="tk-round-decision" data-round-id={round.roundId} data-round-version={round.version}>
  <strong>本轮专业分析 · v{round.version}</strong><p>{round.updatedAt??'服务端时间未提供'}{round.current?'':' · 历史依据'}</p>
  {!view?<p>本轮决策视图未返回，不以其他版本候选代替。</p>:<>
   <p>分析候选不等于正式批准；未校准置信度不显示概率。</p>
   <Value value={view.candidate}/>
   <div className={selection?.eventId&&selection.candidateId?'tk-round-selected':''}><strong>已记录的人工选择</strong><Value value={view.selection}/></div>
   {view.reason&&<p>{String(view.reason)}</p>}
  </>}
 </div>;
}
