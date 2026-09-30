import type { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import type { Kernel } from './kernel.ts';
import { authenticate, requireVerified } from './principal.ts';
import { lookupCustomer } from './v2kit.ts';
import { canonicalHash, newId } from './util.ts';
import { conflict, forbidden, invalid, notFound } from './errors.ts';

type Data = Record<string, any>;
type Q = { query: (text: string, values?: readonly unknown[]) => Promise<any> };

/** 02-execution 增量：同客户独立业务周期（履约→待外部回执→结清→关闭；返单=新周期）。
 * 诚实边界：外部收付款系统未连接——内部义务完成后如实停在 awaiting_external_receipt；
 * 结清必须先有有权人类对真实外部回执的手工确认（身份+审计留痕），系统绝不伪造实收或自动结清。
 * 每个周期的五区依据独立（source_process_id 各自指向一个已完结 diamond 流程），历史不互写。 */
export function buildArrowCycles(kernel: Kernel) {
  const STATES = ['active', 'awaiting_external_receipt', 'settled', 'closed'];

  async function tx<T>(fn: (q: Q) => Promise<T>): Promise<T> {
    const q = await kernel.pool.connect();
    try { await q.query('BEGIN'); const v = await fn(q); await q.query('COMMIT'); return v; }
    catch (e) { await q.query('ROLLBACK').catch(() => {}); throw e; }
    finally { q.release(); }
  }
  async function audit(q: Q, actor: string, action: string, targetId: string, summary: string, customerId: string) {
    await q.query('INSERT INTO outbox_events(event_id,event_type,customer_id,payload) VALUES($1,$2,$3,$4)',
      [randomUUID(), 'ARROW_CYCLE_EVENT', customerId, JSON.stringify({ action, cycleId: targetId, actor, at: new Date().toISOString() })]);
    await v2Audit(actor, action, targetId, summary);
  }
  async function v2Audit(actor: string, action: string, targetId: string, summary: string) {
    const { v2Helpers } = await import('./v2kit.ts');
    const c = await kernel.pool.connect();
    try { await v2Helpers(c).audit({ actor, action, targetType: 'cycle', targetId, summary }); } finally { c.release(); }
  }

  async function auth(credential: unknown, cid: string) {
    const a = await authenticate(kernel.verifierForV2(), credential); requireVerified(a);
    if (a.principal.kind !== 'human' || a.principal.roles.includes('customer')) throw forbidden('PERMISSION_DENIED', '内部人类身份必需');
    const customer = await lookupCustomer(kernel, credential, cid);
    return { p: a.principal, customer };
  }

  function field(v: unknown, name: string): string {
    if (typeof v !== 'string' || !v.length || v.length > 128) throw invalid(`${name} 必须为1..128字符`);
    return v;
  }

  async function latestCompletedProcess(q: Q, cid: string) {
    return (await q.query(`SELECT * FROM arrow_processes WHERE customer_id=$1 AND state='completed' ORDER BY created_at DESC LIMIT 1`, [cid])).rows[0] ?? null;
  }
  async function adoptedRefs(q: Q, pid: string) {
    const rows = (await q.query(`SELECT DISTINCT ON (domain) domain,job_id,result_id,basis_hash,selection FROM arrow_jobs
      WHERE process_id=$1 AND state='completed' AND selection->>'decision'='adopt' ORDER BY domain,attempt DESC`, [pid])).rows;
    return rows;
  }
  async function cycleView(q: Q, row: Data) {
    const basis = row.source_process_id ? await adoptedRefs(q, row.source_process_id) : [];
    return { cycleId: row.cycle_id, customerId: row.customer_id, tenantId: row.tenant_id, cycleNo: row.cycle_no,
      state: row.state, sourceProcessId: row.source_process_id, reorderOfCycleId: row.reorder_of_cycle_id,
      basis: { processId: row.source_process_id, adoptedDomains: basis.map((r: Data) => r.domain), adoptedRefs: basis.map((r: Data) => ({ domain: r.domain, jobId: r.job_id, resultId: r.result_id, basisHash: r.basis_hash })) },
      internalFulfillment: row.internal_fulfillment ?? null, externalReceipt: row.external_receipt ?? null,
      settlement: row.settlement ?? null, createdBy: row.created_by, createdAt: row.created_at?.toISOString?.() ?? row.created_at,
      updatedAt: row.updated_at?.toISOString?.() ?? row.updated_at,
      next: row.state === 'active' ? ['fulfill'] : row.state === 'awaiting_external_receipt' ? ['external-receipt', 'settle'] :
        row.state === 'settled' ? ['close', 'reorder'] : [],
      externalIntegration: { connected: false, note: '外部收付款未连接：实收须有权人类对真实回执手工确认；系统不自动结清' } };
  }

  async function list(credential: unknown, cid: string) {
    await auth(credential, cid);
    const rows = (await kernel.pool.query('SELECT * FROM arrow_cycles WHERE customer_id=$1 ORDER BY cycle_no DESC', [cid])).rows;
    const cycles = [];
    for (const row of rows) cycles.push(await cycleView(kernel.pool, row));
    return { ok: true, customerId: cid, found: cycles.length > 0, cycles };
  }

  async function open(frame: Data, cid: string) {
    const requestId = field(frame.requestId, 'requestId');
    const reorderOf = frame.reorderOf === undefined || frame.reorderOf === null ? null : field(frame.reorderOf, 'reorderOf');
    const { p, customer } = await auth(frame.credential, cid);
    const payloadHash = canonicalHash({ requestId, reorderOf });
    const claim = await tx(async q => {
      await q.query('SELECT customer_id FROM customers WHERE customer_id=$1 FOR UPDATE', [cid]);
      const prior = (await q.query('SELECT * FROM arrow_cycles WHERE customer_id=$1 AND request_id=$2', [cid, requestId])).rows[0];
      if (prior) {
        if (canonicalHash({ requestId: prior.request_id, reorderOf: prior.reorder_of_cycle_id }) !== payloadHash)
          throw conflict('IDEMPOTENCY_REPLAY_CONFLICT', '同ID载荷不同');
        return { row: prior, reused: true };
      }
      const proc = await latestCompletedProcess(q, cid);
      if (!proc) throw conflict('NOT_READY', 'OPEN_REQUIRES_COMPLETED_CASE：须先完成同客户五区协同并全部采用');
      const refs = await adoptedRefs(q, proc.process_id);
      if (refs.length !== 5) throw conflict('NOT_READY', 'OPEN_REQUIRES_FIVE_ADOPTED：五区采用记录不全');
      let priorCycle: Data | null = null;
      if (reorderOf) {
        priorCycle = (await q.query('SELECT * FROM arrow_cycles WHERE cycle_id=$1 AND customer_id=$2', [reorderOf, cid])).rows[0] ?? null;
        if (!priorCycle) throw notFound('被返单周期不存在');
        if (priorCycle.state !== 'settled' && priorCycle.state !== 'closed') throw conflict('NOT_READY', 'REORDER_REQUIRES_SETTLED：仅已结清（或结清后关闭）周期可返单');
        if (!((new Date(proc.created_at).getTime()) > new Date(priorCycle.source_process_id ? (await q.query('SELECT created_at FROM arrow_processes WHERE process_id=$1', [priorCycle.source_process_id])).rows[0].created_at : 0).getTime()))
          throw conflict('NOT_READY', 'REORDER_REQUIRES_FRESH_CASE：返单须基于返单决定之后完成的新五区流程（独立依据）');
      }
      const cycleNo = Number((await q.query('SELECT COALESCE(MAX(cycle_no),0) n FROM arrow_cycles WHERE customer_id=$1', [cid])).rows[0].n) + 1;
      const cycleId = newId('cycle');
      const at = new Date().toISOString();
      await q.query(`INSERT INTO arrow_cycles(cycle_id,customer_id,tenant_id,cycle_no,state,source_process_id,reorder_of_cycle_id,request_id,created_by,created_at,updated_at)
        VALUES($1,$2,$3,$4,'active',$5,$6,$7,$8,$9,$9)`,
        [cycleId, cid, customer.tenant_id, cycleNo, proc.process_id, reorderOf, requestId, p.principalId, at]);
      await q.query('INSERT INTO outbox_events(event_id,event_type,customer_id,payload) VALUES($1,$2,$3,$4)',
        [randomUUID(), 'ARROW_CYCLE_OPENED', cid, JSON.stringify({ cycleId, cycleNo, sourceProcessId: proc.process_id, reorderOf, actor: p.principalId, at })]);
      await audit(q, p.principalId, 'cycle.open', cycleId, `开启第${cycleNo}期业务周期（依据流程 ${proc.process_id}${reorderOf ? `；返单自 ${reorderOf}` : ''}）`, cid);
      return { row: (await q.query('SELECT * FROM arrow_cycles WHERE cycle_id=$1', [cycleId])).rows[0], reused: false };
    });
    return { ok: true, reused: claim.reused, cycle: await cycleView(kernel.pool, claim.row) };
  }

  async function transition(frame: Data, cid: string, cycleId: string, action: 'fulfill' | 'external-receipt' | 'settle' | 'close') {
    const requestId = field(frame.requestId, 'requestId');
    if (action === 'external-receipt') {
      if (typeof frame.ref !== 'string' || !frame.ref.trim() || frame.ref.length > 200) throw invalid('ref 必须为1..200字符的外部回执编号');
      if (frame.source !== undefined && (typeof frame.source !== 'string' || frame.source.length > 80)) throw invalid('source 过长');
    }
    const { p, customer } = await auth(frame.credential, cid);
    const payloadHash = canonicalHash({ requestId, action, ...(action === 'external-receipt' ? { ref: frame.ref, source: frame.source ?? null } : {}) });
    const result = await tx(async q => {
      await q.query('SELECT customer_id FROM customers WHERE customer_id=$1 FOR UPDATE', [cid]);
      const row = (await q.query('SELECT * FROM arrow_cycles WHERE cycle_id=$1 AND customer_id=$2 FOR UPDATE', [cycleId, cid])).rows[0];
      if (!row) throw notFound('周期不存在');
      const logged = (() => {
        const log = ({ fulfill: row.internal_fulfillment, 'external-receipt': row.external_receipt, settle: row.settlement, close: null } as Record<string, any>)[action];
        return log && log.requestId === requestId && canonicalHash({ requestId, action, ...(action === 'external-receipt' ? { ref: log.ref, source: log.source ?? null } : {}) }) === payloadHash ? log : null;
      })();
      if (logged) return { row, reused: true, log: logged };
      const at = new Date().toISOString();
      const need = (cond: boolean, code: string, msg: string) => { if (!cond) throw conflict('NOT_READY', `${code}：${msg}`); };
      if (action === 'fulfill') {
        need(row.state === 'active', 'FULFILL_REQUIRES_ACTIVE', '仅 active 周期可记录内部履约完成');
        const refs = await adoptedRefs(q, row.source_process_id);
        if (refs.length !== 5) throw conflict('NOT_READY', 'FULFILL_REQUIRES_FIVE_ADOPTED');
        const log = { requestId, at, actor: p.principalId, refs: refs.map((r: Data) => ({ domain: r.domain, jobId: r.job_id })), note: '内部义务完成；外部收付款未连接，等待真实外部回执' };
        await q.query("UPDATE arrow_cycles SET state='awaiting_external_receipt',internal_fulfillment=$2,updated_at=clock_timestamp() WHERE cycle_id=$1", [cycleId, JSON.stringify(log)]);
        await q.query('INSERT INTO outbox_events(event_id,event_type,customer_id,payload) VALUES($1,$2,$3,$4)',
          [randomUUID(), 'ARROW_CYCLE_AWAITING_EXTERNAL', cid, JSON.stringify({ cycleId, actor: p.principalId, at })]);
        await audit(q, p.principalId, 'cycle.fulfill', cycleId, '内部履约完成；如实停在待外部回执', cid);
      } else if (action === 'external-receipt') {
        need(row.state === 'awaiting_external_receipt', 'RECEIPT_REQUIRES_AWAITING', '仅待外部回执周期可确认外部回执');
        const log = { requestId, ref: frame.ref, source: frame.source ?? 'manual-attestation', recordedBy: p.principalId, at, note: '有权人类对真实外部回执的手工确认；系统未连接外部收付款，不自动生成' };
        await q.query("UPDATE arrow_cycles SET external_receipt=$2,updated_at=clock_timestamp() WHERE cycle_id=$1", [cycleId, JSON.stringify(log)]);
        await q.query('INSERT INTO outbox_events(event_id,event_type,customer_id,payload) VALUES($1,$2,$3,$4)',
          [randomUUID(), 'ARROW_CYCLE_EXTERNAL_RECEIPT_RECORDED', cid, JSON.stringify({ cycleId, actor: p.principalId, ref: frame.ref, at })]);
        await audit(q, p.principalId, 'cycle.external-receipt', cycleId, `记录外部回执手工确认（ref=${String(frame.ref).slice(0, 32)}）`, cid);
      } else if (action === 'settle') {
        need(row.state === 'awaiting_external_receipt', 'SETTLE_REQUIRES_AWAITING', '须先处于待外部回执状态');
        if (!row.external_receipt) throw conflict('NOT_READY', 'SETTLE_REQUIRES_EXTERNAL_RECEIPT：未确认真实外部回执前禁止结清');
        const log = { requestId, at, actor: p.principalId, basedOnReceipt: { ref: row.external_receipt.ref, recordedBy: row.external_receipt.recordedBy } };
        await q.query("UPDATE arrow_cycles SET state='settled',settlement=$2,updated_at=clock_timestamp() WHERE cycle_id=$1", [cycleId, JSON.stringify(log)]);
        await q.query('INSERT INTO outbox_events(event_id,event_type,customer_id,payload) VALUES($1,$2,$3,$4)',
          [randomUUID(), 'ARROW_CYCLE_SETTLED', cid, JSON.stringify({ cycleId, actor: p.principalId, at })]);
        await audit(q, p.principalId, 'cycle.settle', cycleId, '周期结清（依据已确认外部回执）', cid);
      } else {
        need(row.state === 'settled', 'CLOSE_REQUIRES_SETTLED', '仅已结清周期可关闭');
        const log = { requestId, at, actor: p.principalId };
        await q.query("UPDATE arrow_cycles SET state='closed',settlement=$2,updated_at=clock_timestamp() WHERE cycle_id=$1",
          [cycleId, JSON.stringify({ ...(row.settlement ?? {}), closed: log })]);
        await q.query('INSERT INTO outbox_events(event_id,event_type,customer_id,payload) VALUES($1,$2,$3,$4)',
          [randomUUID(), 'ARROW_CYCLE_CLOSED', cid, JSON.stringify({ cycleId, actor: p.principalId, at })]);
        await audit(q, p.principalId, 'cycle.close', cycleId, '周期关闭', cid);
      }
      return { row: (await q.query('SELECT * FROM arrow_cycles WHERE cycle_id=$1', [cycleId])).rows[0], reused: false, log: null };
    });
    return { ok: true, reused: result.reused, cycle: await cycleView(kernel.pool, result.row) };
  }

  return { list, open, transition };
}
