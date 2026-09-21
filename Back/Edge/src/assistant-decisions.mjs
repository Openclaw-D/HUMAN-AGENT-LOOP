import { workspaceContext, contextHash, digest } from './assistant-receipts.mjs';
import { decisionError, validateDecisionCandidates, validateForecastCandidates } from './decision-feedback-store.mjs';

const assistants = ['business', 'policy', 'credit', 'commerce', 'asset', 'jianwei'];
const staff = ['admin', 'business', 'policy', 'credit', 'commerce', 'asset'];
const operation = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{8,80}$/.test(value);
const taskKinds = ['next_action', 'path_forecast'];

/** Auxiliary decisions only. No kernel writes; scope is tenant/customer/person/assistant. */
export function createDecisionHandler({ sessionOf, verify, store, model, evidence, repository, sendJson, readJsonBody }) {
  return async (req, res, url) => {
    const match = url.pathname.match(/^\/api\/jw\/v2\/(actions\/)?customers\/([^/]+)\/assistant\/decisions(\/feedback)?$/);
    if (!match) return false;
    try {
      if ((req.method === 'GET' && (match[1] || match[3])) ||
          (req.method === 'POST' && !match[1]) || !['GET', 'POST'].includes(req.method)) throw decisionError('METHOD_NOT_ALLOWED', 405);
      if (!repository) throw decisionError('DECISION_STORAGE_REQUIRED', 503);
      const customerId = decodeURIComponent(match[2]);
      const parsed = req.method === 'POST' ? await readJsonBody(req) : { body: {} };
      if (parsed.err) throw decisionError('INVALID_REQUEST', 400);
      const body = parsed.body ?? {};
      const assistant = req.method === 'GET' ? url.searchParams.get('assistant') : body.assistant;
      if (!assistants.includes(assistant)) throw decisionError('INVALID_ASSISTANT', 400);
      // R2-03 显式材料选择（可选）：此处只做形状门（非法进入即拒 400，零 Connectors/模型出站、
      // 不写决策仓库）；缺省=undefined→provider legacy 全量语义，与改动前逐字节一致。
      // 空集/越权/上游缺件等语义校验归 provider 精确错误码，不在此重复发明。
      let materialScope;
      if (body.materialScope !== undefined) {
        const ms = body.materialScope;
        if (!ms || typeof ms !== 'object' || Array.isArray(ms) || !Array.isArray(ms.artifactIds) ||
            ms.artifactIds.some(id => typeof id !== 'string' || !id.length))
          throw decisionError('INVALID_MATERIAL_SCOPE', 400);
        materialScope = { artifactIds: ms.artifactIds };
      }
      const initialSession = sessionOf(req);
      if (!initialSession) throw decisionError('SESSION_REQUIRED', 401);
      async function authorized() {
        const session = sessionOf(req);
        if (!session || session.principalId !== initialSession.principalId || session.sessionId !== initialSession.sessionId)
          throw decisionError('SESSION_REQUIRED', 401);
        if (!session.roles?.some(role => staff.includes(role)) || session.roles.includes('customer')) throw decisionError('FORBIDDEN', 403);
        const allowed = await verify({ req, customerId, action: 'workspace:read', session });
        if (!allowed.ok) throw decisionError('FORBIDDEN', 403);
        const snapshot = await store.getWorkspace(customerId, { credential: session.credential, principalId: session.principalId });
        if (!snapshot) throw decisionError('NOT_FOUND', 404);
        const context = workspaceContext(snapshot, assistant);
        const tenantId = session.tenantId ?? (snapshot.snapshot ?? snapshot)?.admission?.scope?.tenantId;
        if (!tenantId || !session.principalId) throw decisionError('DECISION_SCOPE_MISSING', 403);
        if (!evidence) throw decisionError('EVIDENCE_UNAVAILABLE', 422);
        // scope 经闭包进入全部再入（respond/checkCurrent/finish sameBasis），同一请求内 basis 一致。
        context.evidencePack = await evidence({ snapshot, tenantId, customerId, revision: context.contextVersion, scope: materialScope });
        context.evidenceRefs = context.evidencePack.snippets.map(s => ({ id: s.id, version: s.parserVersion, hash: s.hash }));
        return { scope: { tenantId, customerId, principalId: session.principalId, assistant }, context, baseHash: contextHash(context) };
      }
      const basis = await authorized();
      const sameBasis = next => digest(next.scope) === digest(basis.scope) && next.baseHash === basis.baseHash;
      let state = await repository.read(basis.scope);
      async function respond(extra = {}) {
        const latestBasis = await authorized();
        if (digest(latestBasis.scope) !== digest(basis.scope)) throw decisionError('FORBIDDEN', 403);
        const current = !!state.latest && state.latest.baseHash === latestBasis.baseHash && state.latest.valid === true;
        const latest = state.latest ? { ...state.latest,
          taskKind: state.latest.taskKind ?? 'next_action',
          candidates: current ? state.latest.candidates : [], evidenceRefs: current ? state.latest.evidenceRefs : [], current } : null;
        sendJson(res, 200, { ok: true, authority: 'none', customerId, assistant, revision: state.revision,
          pending: state.pending ? { operationId: state.pending.operationId, question: state.pending.question,
            taskKind: state.pending.taskKind ?? 'next_action' } : null,
          latest, ...extra });
      }
      if (req.method === 'GET') { await respond(); return true; }
      if (!operation(body.operationId) || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0)
        throw decisionError('INVALID_REQUEST', 400);
      const taskKind = body.taskKind === undefined ? 'next_action' : body.taskKind;
      if (!taskKinds.includes(taskKind)) throw decisionError('INVALID_TASK_KIND', 400);
      if (match[3]) {
        if (state.pending) throw decisionError('DECISION_PENDING');
        const set = state.latest;
        if (!set || body.decisionSetId !== set.id || set.baseHash !== basis.baseHash || !set.valid)
          throw decisionError('DECISION_STALE');
        if (!['select', 'none', 'undo'].includes(body.action) || typeof (body.reason ?? '') !== 'string' || (body.reason?.length ?? 0) > 500)
          throw decisionError('INVALID_FEEDBACK', 400);
        const candidate = set.candidates.find(c => c.id === body.candidateId);
        if (body.action === 'select' && !candidate) throw decisionError('INVALID_CANDIDATE', 400);
        if (body.action !== 'select' && body.candidateId != null) throw decisionError('INVALID_FEEDBACK', 400);
        const event = { id: `feedback:${body.operationId}`, type: 'feedback', decisionSetId: set.id,
          action: body.action, candidateId: candidate?.id ?? null, reason: body.reason ?? '', actor: basis.scope.principalId };
        if (!sameBasis(await authorized())) throw decisionError('DECISION_STALE');
        state = await repository.update(basis.scope, body.expectedRevision, event, s => {
          s.latest.feedback = body.action === 'undo' ? null : { action: body.action, candidateId: candidate?.id ?? null,
            label: candidate?.label ?? '均不合适', reason: event.reason, eventId: event.id, at: new Date().toISOString() };
          return s;
        });
        await respond(); return true;
      }
      if (!model?.observe || !model.requiresEvidence) throw decisionError('MODEL_NOT_CONFIGURED', 503);
      if (typeof body.question !== 'string' || !body.question.trim() || body.question.length > 2000)
        throw decisionError('INVALID_QUESTION', 400);
      const question = body.question.trim();
      // Reconcile the original receipt even if materials changed while its outcome was unknown.
      // 摘要按kind投影：next_action/缺kind 不进入摘要（与升级前哈希逐字节一致，旧begin事件与回执可核对、
      // 不因升级重复出站）；path_forecast 进入摘要，使相同operationId换kind必然幂等冲突。
      const requestHash = digest({ question,
        baseHash: state.pending?.operationId === body.operationId ? state.pending.baseHash : basis.baseHash,
        taskKind: taskKind === 'path_forecast' ? taskKind : undefined });
      const begin = state.events.find(e => e.id === `begin:${body.operationId}`);
      if (begin && begin.requestHash !== requestHash) throw decisionError('IDEMPOTENCY_CONFLICT');
      if (begin && state.events.some(e => e.id === `finish:${body.operationId}`)) { await respond({ replayed: true }); return true; }
      if (state.pending && state.pending.operationId !== body.operationId) throw decisionError('DECISION_PENDING');
      if (!state.pending) {
        // 反馈复用同时匹配问题与taskKind：两类候选语义不同，反馈不得跨kind带入。
        const feedback = state.latest?.baseHash === basis.baseHash && state.latest.question === question
          && (state.latest.taskKind ?? 'next_action') === taskKind ? state.latest.feedback : null;
        const context = { ...basis.context, decisionTask: { version: 1, operationId: body.operationId,
          principalId: basis.scope.principalId, feedback,
          // 仅path_forecast把taskKind写进冻结上下文：next_action保持与升级前逐字节一致，旧回执身份可复算。
          ...(taskKind === 'path_forecast' ? { taskKind } : {}) } };
        state = await repository.update(basis.scope, body.expectedRevision,
          { id: `begin:${body.operationId}`, type: 'analysis_started', requestHash }, s => {
            s.pending = { operationId: body.operationId, question, taskKind, context, baseHash: basis.baseHash }; return s;
          });
      }
      const pending = state.pending;
      const pendingKind = pending.taskKind ?? 'next_action';
      let result;
      try {
        result = await model.observe({ customerId, tenantId: basis.scope.tenantId, assistant, question,
          context: pending.context, checkCurrent: async () => { try { const fresh = await authorized(); return sameBasis(fresh) && fresh.baseHash === pending.baseHash; } catch { return false; } } });
      } catch { await respond({ error: 'DECISION_SEND_UNKNOWN' }); return true; }
      if (result.status === 'unknown' || result.sent == null) { await respond({ error: 'DECISION_SEND_UNKNOWN' }); return true; }
      let candidates = [], error = result.error?.code ?? null;
      const validStatus = ['succeeded', 'simulated'].includes(result.status);
      if (validStatus) {
        try { candidates = pendingKind === 'path_forecast'
          ? validateForecastCandidates(result.decisions, pending.context.evidencePack)
          : validateDecisionCandidates(result.decisions, pending.context.evidencePack); }
        catch { error = 'INVALID_DECISION_OUTPUT'; }
      }
      const current = result.current === true && sameBasis(await authorized());
      const set = { id: digest({ scope: basis.scope, operationId: body.operationId }), question, baseHash: pending.baseHash,
        taskKind: pendingKind,
        valid: validStatus && !error && current, candidates, evidenceRefs: pending.context.evidencePack.snippets,
        omitted: pending.context.evidencePack.omitted ?? [], feedback: null,
        feedbackUsed: pending.context.decisionTask.feedback?.eventId ?? null,
        model: { status: result.status, source: result.source, requestId: result.requestId, analysisRunId: result.analysisRunId,
          contextVersion: result.contextVersion, usage: result.usage, error }, at: new Date().toISOString() };
      state = await repository.update(basis.scope, state.revision,
        { id: `finish:${body.operationId}`, type: 'analysis_finished', decisionSetId: set.id, result: set }, s => {
          s.pending = null; s.latest = set; return s;
        });
      await respond(); return true;
    } catch (e) {
      // R2-03：证据层（provider/scope）失败如实透出精确码与 detail（全部发生在模型出站之前），
      // 不再并入 DECISION_UNAVAILABLE；EVIDENCE_UNAVAILABLE 既有 422 语义不变，其余映射不变。
      if (typeof e?.message === 'string' && e.message.startsWith('EVIDENCE_')) {
        sendJson(res, e.status ?? 422, { ok: false, error: e.message, ...(e.detail !== undefined ? { detail: e.detail } : {}) });
        return true;
      }
      const status = e.status ?? (e.upstream?.status === 403 ? 403 : 503);
      sendJson(res, status, { ok: false, error: e.status ? e.code : 'DECISION_UNAVAILABLE' });
      return true;
    }
  };
}
