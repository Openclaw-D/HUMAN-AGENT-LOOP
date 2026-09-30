// Local deterministic candidate evaluation. No model calls, service credentials or human decisions.
import { buildPerceptionSnapshot, projectForDomain } from '../../../C/domains/perception.mjs';
import { defaultSimulationRegistry } from '../../../C/domains/capability-registry.mjs';
import { assessBusiness } from '../../../C/domains/assessors.mjs';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { perceptionStage, assessStage } from '../../../C/domains/pipeline.mjs';
import { zoneCandidates } from '../../../C/domains/zone-candidates.mjs';
import { candidateMaterials,valueOf,loadColumnRules } from './column-dependencies.mjs';

export function runBusinessColumn({ customer, materials, facts, evaluatedAt }) {
  if (!String(customer.legal_entity_ref).startsWith('SYNTHETIC-')) throw new Error('SYNTHETIC_ONLY');
  // Trust only A's fact_assertions, never verification claims embedded in uploaded content.
  const levels = { confirmed: 'verified', source_supported: 'source_supported', unverified: 'declared', inference: 'unknown', unknown: 'unknown' };
  const live = materials.filter(a => !a.superseded_by && !a.duplicate_of);
  const inputs = live.map(a => ({
    materialId: a.artifact_id, kind: String(a.kind).replace(/^material\./, ''),
    content: JSON.stringify(a.content),
    sourceRef: { channel: 'A.evidence_artifacts', field: 'registered_fact_assertions', capturedAt: new Date(a.created_at).toISOString() },
    declaredFacts: facts.filter(f => f.artifact_id === a.artifact_id).map(f => ({
      factKey: f.fact_key, value: f.value, verificationLevel: levels[f.grade] ?? 'unknown',
      sourceRef: { channel: 'A.fact_assertions', field: f.assertion_id },
    })),
  }));
  const built = buildPerceptionSnapshot({ tenantId: customer.tenant_id, customerId: customer.customer_id,
    materials: inputs, capabilities: defaultSimulationRegistry(),
    provider: { providerMode: 'simulation', modelVersion: 'deterministic-extractor@0.3' } });
  if (!built.ok) return { ok: false, reason: 'BUSINESS_INPUT_INVALID', problems: built.problems };
  const projection = projectForDomain(built.snapshot, 'business');
  if (!projection.ok) return { ok: false, reason: 'BUSINESS_PROJECTION_FAILED' };
  const result = assessBusiness({ snapshot: built.snapshot, projection: projection.projection,
    ruleEvaluation: null, now: () => evaluatedAt });
  return { ...result, sourceMode: 'synthetic', authority: 'none',
    registration: 'advance_rounds.candidate_only',
    materialRefs: live.map(a => ({ artifactId: a.artifact_id, hash: a.sha256 })),
    unreadable: built.snapshot.unreadable };
}

export function runDomainCandidate(input) {
  const { customer, materials, facts, domain } = input;
  if (!String(customer.legal_entity_ref).startsWith('SYNTHETIC-')) throw new Error('SYNTHETIC_ONLY');
  const transaction = valueOf(facts.find(f=>f.fact_key==='transaction_scope'));
  if (!transaction || ['orgType','product','region','customerRange'].some(k=>typeof transaction[k]!=='string'))
    return {ok:false,reason:'TRANSACTION_SCOPE_REQUIRED'};
  const rows = candidateMaterials(materials,facts);
  const rulePack = loadColumnRules();
  if(input.deps?.rulePackVersion&&input.deps.rulePackVersion!==rulePack.version)return {ok:false,reason:'RULE_PACK_VERSION_NOT_LOADED'};
  const built = perceptionStage({ tenantId:customer.tenant_id,customerId:customer.customer_id,materials:rows,rulePack });
  if (!built.ok) return built;
  const result = assessStage({ snapshot:built.snapshot,rulePack,domains:[domain],asOf:new Date().toISOString().slice(0,10),
    transaction });
  if (!result.ok) return result;
  const {facts:unusedFacts,...ruleEvaluation}=result.ruleEvaluation;
  const zone = zoneCandidates({ domain, entry: result.analyses[domain], ruleEvaluation, transaction });
  return { ok:true,...result.analyses[domain],...(domain==='policy'?{ruleEvaluation}:{}),unreadable:built.snapshot.unreadable,
    zoneCandidates:zone.ok?zone:{ok:false,reason:zone.reason},
    sourceMode:'synthetic',authority:'none',ruleVersion:rulePack.version };
}

/** Domain evaluations run in independent CPU workers, admitted through a bounded slot pool
 * (backpressure: inputs beyond maxConcurrency wait for a freed slot; no fake delay or progress timer).
 * Timeout/abort/worker exit resolve as unknown — never silently retried or marked complete. */
export async function runReadyDomains(inputs, { timeoutMs = 15000, signal, maxConcurrency = 4 } = {}) {
  if (!inputs.length) return [];
  const cap = Math.max(1, Math.min(maxConcurrency, inputs.length));
  const gate = new SharedArrayBuffer(4);
  const gateView = new Int32Array(gate);
  const workers = [];
  let ready = 0, released = false, settled = false;
  let settleReject = null;
  let initWatchdog = null;
  const release = () => { Atomics.store(gateView, 0, 1); Atomics.notify(gateView, 0, 1); };
  const settle = (error) => {
    if (settled) return; settled = true;
    if (initWatchdog) clearTimeout(initWatchdog);
    signal?.removeEventListener('abort', onAbort);
    if (error && settleReject) settleReject(error);
  };
  const onAbort = () => settle(new Error('COLUMN_CANCELLED_UNKNOWN'));
  try {
    return await Promise.all(inputs.map((input, index) => new Promise((resolve, reject) => {
      if (signal?.aborted) { settled = true; return reject(new Error('COLUMN_CANCELLED_UNKNOWN')); }
      if (!settleReject) {
        settleReject = reject;
        if (signal) signal.addEventListener('abort', onAbort, { once: true });
        initWatchdog = setTimeout(() => settle(new Error('COLUMN_TIMEOUT_UNKNOWN')), timeoutMs);
      }
      const worker = new Worker(new URL(import.meta.url), { execArgv: process.execArgv.filter(a => !a.startsWith('--input-type')),
        workerData: { arrowColumn: true, input, gate } });
      workers.push(worker);
      let done = false, timer = null;
      const finish = (error, result) => {
        if (done) return; done = true; if (timer) clearTimeout(timer);
        worker.removeAllListeners();
        if (error) { settle(error); reject(error); return; }
        resolve(result);
        // Slot accounting: only a completed job frees exactly one admission slot.
        if (!settled && released) release();
      };
      worker.on('message', message => {
        if (message.ready) { if (++ready === inputs.length && !released) { released = true; if (initWatchdog) clearTimeout(initWatchdog); for (let i = 0; i < cap; i++) release(); } }
        else if (message.started) { timer = setTimeout(() => finish(new Error('COLUMN_TIMEOUT_UNKNOWN')), timeoutMs); }
        else finish(null, message);
      });
      worker.on('error', error => finish(error));
      worker.on('exit', code => { if (!done) finish(new Error(`COLUMN_EXIT_WITHOUT_RESULT:${code}`)); });
    })));
  } finally { await Promise.all(workers.map(w => w.terminate())); }
}

if (!isMainThread && workerData?.arrowColumn) {
  parentPort.postMessage({ready:true});
  Atomics.wait(new Int32Array(workerData.gate),0,0);
  parentPort.postMessage({started:true});
  const startedAt = new Date().toISOString();
  const result = runDomainCandidate(workerData.input);
  parentPort.postMessage({jobId:workerData.input.jobId,domain:workerData.input.domain,startedAt,
    finishedAt:new Date().toISOString(),threadId:(await import('node:worker_threads')).threadId,result});
}
