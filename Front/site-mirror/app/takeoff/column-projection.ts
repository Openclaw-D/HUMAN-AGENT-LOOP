import type { ColumnReceipt } from '../../lib/workbench/advance-client';
import type { TakeoffCellView } from '../../lib/workbench/takeoff-projection';

/** Only explicit, current per-item server results can replace a cell projection. */
export function projectColumnReceipts(cells:TakeoffCellView[],receipts:ColumnReceipt[],customerId:string):TakeoffCellView[]{
 const latest=new Map<string,ColumnReceipt>();
 for(const r of receipts){if(r.customerId!==customerId)continue;const old=latest.get(r.domain);if(!old||r.roundNo>old.roundNo||(r.roundNo===old.roundNo&&r.version>old.version))latest.set(r.domain,r);}
 const ids={input:'materials',analysis:'analysis',human:'verification',closure:'completion'};
 return cells.map(cell=>{
  const r=latest.get(cell.domain==='opportunity'?'business':cell.domain);
  if(!r||r.current!==true)return cell;
  const results=r.views?.platform.cells as ColumnReceipt['columnResults']|undefined;
  const item=(results??r.columnResults).find(i=>i.itemId===ids[cell.row]);if(!item)return cell;
  const refused=r.caseOutcome?.status==='rejected'&&r.selection?.decision==='reject'&&!!r.selection.eventId;
  if(refused&&(cell.row==='human'||cell.row==='closure'))return {...cell,completed:false,running:false,displayBucket:null,needsReview:false,frozen:false,items:[{key:'gate',label:'已明确信审拒绝',tone:'red',detail:`人工选择事件 ${r.selection!.eventId}`}],basis:`服务端拒绝选择 ${r.roundId} · v${r.version}`};
  if(r.caseOutcome?.status==='rejected'&&item.state==='rejected'&&!refused)return {...cell,completed:false,running:false,displayBucket:null,needsReview:true,frozen:false,items:[{key:'blk',label:'流程已拒绝，后续办理已停止',tone:'gray',detail:r.caseOutcome.archiveRef??undefined}],basis:`服务端流程归档 ${r.roundId} · v${r.version}`};
  const complete=item.state==='completed';const running=['running','accepted'].includes(item.state);const rejected=item.state==='rejected';
  return {...cell,completed:complete,running,displayBucket:complete?100:null,needsReview:!complete&&!running,frozen:false,
   items:[{key:rejected?'gate':complete?'round-result':'blk',label:complete?'已完成':running?'处理中':item.state==='awaiting_confirmation'?'等待人工确认':item.state==='recorded'?'已记录，待核对':rejected?'未通过':'等待办理条件',tone:rejected?'red':complete?'green':running?'blue':'gray',detail:item.reason??item.resultRef}],
   basis:`服务端列回执 ${r.roundId} · v${r.version} · ${r.updatedAt??'时间未提供'} · ${item.itemId}`};
 });
}
