/** Planned AdvanceRound transport. Availability is established by HTTP, never inferred locally. */
export interface RequiredDecision {roundId:string;resultId:string;choices:Array<'adopt'|'set_aside'|'reject'>}
export interface CaseOutcome {processId:string;status:string;version:number;terminalEventId:string|null;archiveRef:string|null;ending:'diamond'|'rejection'|null;sourceMode:string}
export interface AdvancePlan {
  affectedDomains?:string[];
  requiredDecision?:RequiredDecision|null;
  customerId: string; available: boolean; reason?: string; domain: string; reused?: boolean; resultRef?: string;
  planId: string; planHash: string; expectedVersion: Record<string, unknown>;
  roundNo: number; summary: string;
  allowedActions: Array<{actionId: string; commandKind: string; requiresHumanConfirmation?: boolean}>;
}
export interface RoundView {
 customerId:string; processId:string; roundId:string; domain:string; version:number; current:boolean; serverUpdatedAt:string|null;
 [key:string]:unknown;
}
export interface ColumnReceipt {
  customerId: string; requestId: string; roundId: string; domain: string;
  current?: boolean; processId?: string; actor?: {principalId?:string;roles?:string[]}; version: number; roundNo: number; state: string; updatedAt: string | null;
  columnResults: Array<{itemId: string; kind?: string; state: string; result?: unknown; resultRef?: string; reason?: string; materialRefs?: unknown[]; blockers?: unknown[]}>;
  downstream: Array<{domain: string; state: string; jobId?: string | null; causedByEventId?: string | null; waitFor?: unknown}>;
  affectedDomains?:string[];
  needsReselection?:Array<{domain:string;roundId:string;resultId:string;reason:string}>;
  dependencyChange?:{eventId:string;affectedDomains:string[];reason:string};
  basisVersion?:unknown;
  caseOutcome?:CaseOutcome;
  selection?:{candidateId:string;eventId:string;decision:string;at:string;actor:string};
  views?: Record<'platform'|'materials'|'decisions'|'flow'|'history',RoundView>;
  next?: {canAdvance: boolean; reason?: string};
}
export const unsettled = (r: ColumnReceipt) => ['accepted','running','unknown'].includes(r.state);
const states = ['accepted','running','completed','waiting_evidence','awaiting_confirmation','rejected','failed','unknown','needs_reassessment'];
function invalid(): never { throw Object.assign(new Error('推进返回内容未通过客户与版本核对'), {code:'INVALID_RESPONSE'}); }
export function readColumnReceipt(value: unknown, customerId: string): ColumnReceipt {
  const r = value as ColumnReceipt;
  if (!r || r.customerId !== customerId || !r.requestId || !r.roundId || !r.domain || !states.includes(r.state) ||
      !Number.isSafeInteger(r.version) || r.version < 0 || !Number.isSafeInteger(r.roundNo) ||
      !Array.isArray(r.columnResults) || !Array.isArray(r.downstream)) return invalid();
  if (!r.columnResults.every(x => x && typeof x.itemId==='string' && typeof x.state==='string') ||
      !r.downstream.every(x => x && typeof x.domain==='string' && typeof x.state==='string')) return invalid();
  if(r.views){
    for(const key of ['platform','materials','decisions','flow','history'] as const){
      const v=r.views[key];
      if(!v||v.customerId!==customerId||v.processId!==r.processId||v.roundId!==r.roundId||v.domain!==r.domain||v.version!==r.version||v.current!==r.current||v.serverUpdatedAt!==r.updatedAt||JSON.stringify(v.basisVersion)!==JSON.stringify(r.basisVersion))return invalid();
    }
    if(!Array.isArray(r.views.materials.items)||!Array.isArray(r.views.platform.cells)||!Array.isArray(r.views.flow.events))return invalid();
  }
  if(r.caseOutcome&&(r.caseOutcome.processId!==r.processId||r.caseOutcome.version!==r.version))return invalid();
  if(r.selection&&r.views){
    const events=r.views.flow.events as Array<{eventId?:string;selection?:{candidateId?:string}}>;
    if(!r.selection.eventId||!r.selection.candidateId||!events.some(e=>e.eventId===r.selection!.eventId&&e.selection?.candidateId===r.selection!.candidateId))return invalid();
  }
  return r;
}
export function createAdvanceClient(root: string, headers: () => Record<string,string>, fetchImpl: typeof fetch) {
  async function request(path: string, body?: unknown): Promise<Record<string,unknown>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const res = await fetchImpl(root + path, {method:body ? 'POST':'GET', headers:{...headers(),...(body ? {'content-type':'application/json'}:{})}, ...(body ? {body:JSON.stringify(body)}:{}), signal:controller.signal});
      const value = await res.json().catch(() => invalid());
      if (!res.ok) throw Object.assign(new Error(String(value.note ?? value.message ?? value.error ?? '推进请求未成功')), {status:res.status,code:String(value.error ?? 'REQUEST_FAILED')});
      if (!value || typeof value!=='object') return invalid();
      return value;
    } finally { clearTimeout(timeout); }
  }
  const base = (id: string) => `/api/jw/v2/customers/${encodeURIComponent(id)}`;
  return {
    async plan(id: string, domain: string): Promise<AdvancePlan> {
      const p = await request(`${base(id)}/advance-plan?domain=${encodeURIComponent(domain)}`) as unknown as AdvancePlan;
      if (p.customerId !== id || typeof p.available!=='boolean') return invalid();
      if (p.available && (p.domain!==domain || !p.planId || !p.planHash || !p.expectedVersion || typeof p.expectedVersion!=='object' ||
        !Number.isSafeInteger(p.roundNo) || typeof p.summary!=='string' || !Array.isArray(p.allowedActions) || !p.allowedActions.length ||
        !p.allowedActions.every(a=>a && typeof a.actionId==='string' && typeof a.commandKind==='string'))) return invalid();
      return p;
    },
    async active(id: string): Promise<ColumnReceipt | null> {
      const v = await request(`${base(id)}/advance-rounds/active`);
      return v.receipt === null ? null : readColumnReceipt(v.receipt,id);
    },
    async history(id: string): Promise<ColumnReceipt[]> {
      const v = await request(`${base(id)}/advance-rounds`);
      if (!Array.isArray(v.receipts)) return invalid();
      return v.receipts.map(r=>readColumnReceipt(r,id));
    },
    async receipt(id: string, roundId: string): Promise<ColumnReceipt> {
      const v = await request(`${base(id)}/advance-rounds/${encodeURIComponent(roundId)}`);
      return readColumnReceipt(v.receipt ?? v,id);
    },
    async recover(id: string, requestId: string): Promise<ColumnReceipt | null> {
      const v = await request(`${base(id)}/advance-rounds/by-request/${encodeURIComponent(requestId)}`);
      if (v.found === false) return null;
      const r = readColumnReceipt(v.receipt,id);
      if (v.found!==true || r.requestId!==requestId) return invalid();
      return r;
    },
    async decide(id:string, round:ColumnReceipt, required:RequiredDecision, decision:'adopt'|'set_aside'|'reject', requestId:string, rationale:string):Promise<ColumnReceipt>{
      if(round.customerId!==id||required.roundId!==round.roundId||!required.choices.includes(decision))return invalid();
      const v=await request(`/api/jw/v2/actions/customers/${encodeURIComponent(id)}/advance-rounds/${encodeURIComponent(round.roundId)}/decision`,{requestId,decision,resultId:required.resultId,expectedVersion:round.version,rationale});
      const r=readColumnReceipt(v.receipt,id);if(r.roundId!==round.roundId||r.domain!==round.domain)return invalid();return r;
    },
    async advance(id: string, plan: AdvancePlan, requestId: string): Promise<ColumnReceipt> {
      if (plan.customerId!==id || !plan.available) return invalid();
      const v = await request(`/api/jw/v2/actions/customers/${encodeURIComponent(id)}/advance-rounds`, {
        requestId,domain:plan.domain,planId:plan.planId,planHash:plan.planHash,expectedVersion:plan.expectedVersion,
        roundNo:plan.roundNo,actionIds:plan.allowedActions.map(a=>a.actionId),
      });
      const r = readColumnReceipt(v.receipt ?? v,id);
      if ((r.requestId!==requestId && !(v.reused===true && plan.reused===true && plan.resultRef===r.roundId)) || r.domain!==plan.domain) return invalid();
      return r;
    },
  };
}
export type AdvanceClient = ReturnType<typeof createAdvanceClient>;
