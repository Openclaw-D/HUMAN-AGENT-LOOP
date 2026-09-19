// HTTP 层（CONTRACT §4）：plain node:http，无框架依赖。
// 错误映射按错误码表；响应统一 no-store；错误信息绝不回显凭据（旧 D-10 教训）。
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { AppError } from '../domain/errors.ts';
import type { Kernel } from '../domain/kernel.ts';

const MAX_BODY = 1 << 20; // 1MB

interface RouteMatch {
    handler: (req: IncomingMessage, res: ServerResponse, params: Record<string, string>, query: URLSearchParams, body: unknown) => Promise<void>;
}

type Handler = (req: IncomingMessage, res: ServerResponse, params: Record<string, string>, query: URLSearchParams, body: Record<string, unknown>) => Promise<unknown>;

interface RouteDef {
    method: string;
    pattern: RegExp;
    keys: string[];
    handler: Handler;
}

export function startHttpServer(kernel: Kernel, port: number): Promise<Server> {
    const routes: RouteDef[] = [];
    const route = (method: string, path: string, handler: Handler): void => {
        const keys: string[] = [];
        const pattern = new RegExp('^' + path.replace(/:[a-zA-Z]+/g, (m) => {
            keys.push(m.slice(1));
            return '([^/]+)';
        }) + '$');
        routes.push({ method, pattern, keys, handler });
    };

    const writeJson = (res: ServerResponse, status: number, payload: unknown): void => {
        const body = JSON.stringify(payload);
        res.writeHead(status, {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
        });
        res.end(body);
    };

    const readBody = (req: IncomingMessage): Promise<string> => new Promise((resolve, reject) => {
        let size = 0;
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_BODY) {
                reject(new AppError('INVALID_INPUT', '请求体超出 1MB 限额'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });

    async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const path = url.pathname;
        // 健康检查不走错误包装
        if (req.method === 'GET' && (path === '/healthz' || path === '/api/v1/health')) {
            return writeJson(res, 200, await kernel.health());
        }
        for (const r of routes) {
            if (r.method !== req.method) continue;
            const m = r.pattern.exec(path);
            if (m === null) continue;
            const params: Record<string, string> = {};
            r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1] ?? ''); });
            let body: unknown = undefined;
            if (req.method === 'POST' || req.method === 'DELETE') {
              const raw = await readBody(req);
              body = raw.trim().length === 0 ? {} : JSON.parse(raw); // eslint-disable-line @typescript-eslint/no-unsafe-assignment
            }
            // 身份凭据：头优先，body 字段同义；__path 供 v2 幂等哈希绑定路径资源（v1 哈希显式剔除，行为不变）
            const credential = req.headers['x-principal-credential'] ??
                (body !== null && typeof body === 'object' ? (body as Record<string, unknown>).principalCredential : undefined);
            const frame = { ...(body as Record<string, unknown>), credential, __path: path };
            const result = await r.handler(req, res, params, url.searchParams, frame);
            if (result !== undefined) writeJson(res, 200, result);
            return;
        }
        writeJson(res, 404, { ok: false, error: 'NOT_FOUND', message: `无此路由：${req.method} ${path}` });
    }

    const server = createServer((req, res) => {
        handle(req, res).catch((error: unknown) => {
            if (error instanceof AppError) {
                if (error.status >= 400) {
                    // 业务拒绝留痕（排障用；只记 code+message，无凭据/载荷）
                    console.error(`[reject] ${req.method} ${req.url} → ${error.status} ${error.code}: ${error.message}`);
                }
                writeJson(res, error.status, { ok: false, error: error.code, message: error.message, ...error.extra });
                return;
            }
            if (error instanceof SyntaxError) {
                writeJson(res, 400, { ok: false, error: 'INVALID_INPUT', message: '请求体不是合法 JSON' });
                return;
            }
            // 未知错误：不外泄内部细节（可能含凭据/连接串）
            const summary = error instanceof Error ? error.constructor.name : 'UnknownError';
            console.error('[kernel] internal error:', error);
            writeJson(res, 500, { ok: false, error: 'INTERNAL', message: `内部错误（${summary}；详情见服务端日志）` });
        });
    });

    // 路由注册
    const k = kernel;
    const S = (v: string | undefined): string => v ?? '';
    const F = (body: Record<string, unknown>): Record<string, unknown> => body;
    /** 读端点身份：头优先，body.principalCredential 同义（GET 也可带查询凭据头）。 */
    const cred = (body: Record<string, unknown> | undefined, req: IncomingMessage): unknown =>
      req.headers['x-principal-credential'] ??
      (body !== null && typeof body === 'object' ? (body as Record<string, unknown>).principalCredential : undefined);
    route('GET', '/api/v1/templates/:templateId', async (_q, _s, p, _sp, body) => k.getTemplate(S(p.templateId), cred(body, _q)));
    route('POST', '/api/v1/templates', async (_q, _s, _p, _sp, body) => k.createTemplate(F(body)));
    route('POST', '/api/v1/projects', async (_q, _s, _p, _sp, body) => k.createProject(F(body)));
    route('GET', '/api/v1/projects/:projectId', async (_q, _s, p, _sp, body) => k.getProject(S(p.projectId), cred(body, _q)));
    route('POST', '/api/v1/projects/:projectId/goals', async (_q, _s, p, _sp, body) => k.createGoal(F(body), S(p.projectId)));
    route('GET', '/api/v1/projects/:projectId/human-requests', async (_q, _s, p, _sp, body) => k.listHumanRequests(S(p.projectId), cred(body, _q)));
    route('POST', '/api/v1/projects/:projectId/human-requests', async (_q, _s, p, _sp, body) => k.createHumanRequest(F(body), S(p.projectId)));
    route('POST', '/api/v1/projects/:projectId/evidence', async (_q, _s, p, _sp, body) => k.submitEvidence(F(body), S(p.projectId)));
    route('POST', '/api/v1/projects/:projectId/evidence/:evidenceId/supersede', async (_q, _s, p, _sp, body) => k.supersedeEvidence(F(body), S(p.projectId), S(p.evidenceId)));
    route('POST', '/api/v1/projects/:projectId/pause', async (_q, _s, p, _sp, body) => k.projectPause(F(body), S(p.projectId)));
    route('POST', '/api/v1/projects/:projectId/resume', async (_q, _s, p, _sp, body) => k.projectResume(F(body), S(p.projectId)));
    route('GET', '/api/v1/goals/:goalId', async (_q, _s, p, _sp, body) => k.getGoal(S(p.goalId), cred(body, _q)));
    route('POST', '/api/v1/goals/:goalId/claim', async (_q, _s, p, _sp, body) => k.claim(F(body), S(p.goalId)));
    route('POST', '/api/v1/goals/:goalId/complete', async (_q, _s, p, _sp, body) => k.complete(F(body), S(p.goalId)));
    route('POST', '/api/v1/goals/:goalId/fail', async (_q, _s, p, _sp, body) => k.failExecution(F(body), S(p.goalId)));
    route('POST', '/api/v1/goals/:goalId/accept', async (_q, _s, p, _sp, body) => k.accept(F(body), S(p.goalId)));
    route('POST', '/api/v1/goals/:goalId/decide', async (_q, _s, p, _sp, body) => k.decide(F(body), S(p.goalId)));
    route('POST', '/api/v1/goals/:goalId/pause', async (_q, _s, p, _sp, body) => k.pauseGoal(F(body), S(p.goalId)));
    route('POST', '/api/v1/goals/:goalId/resume', async (_q, _s, p, _sp, body) => k.resumeGoal(F(body), S(p.goalId)));
    route('POST', '/api/v1/goals/:goalId/takeover', async (_q, _s, p, _sp, body) => k.takeover(F(body), S(p.goalId)));
    route('POST', '/api/v1/human-requests/:hrequestId/respond', async (_q, _s, p, _sp, body) => k.respondHumanRequest(F(body), S(p.hrequestId)));
    route('POST', '/api/v1/human-requests/:hrequestId/cancel', async (_q, _s, p, _sp, body) => k.cancelHumanRequest(F(body), S(p.hrequestId)));
    route('GET', '/api/v1/events', async (_q, _s, _p, sp, body) => {
        const after = Number(sp.get('after') ?? 0);
        const limit = Number(sp.get('limit') ?? 100);
        if (!Number.isFinite(after) || !Number.isFinite(limit)) {
          throw new AppError('INVALID_INPUT', 'after/limit 必须是数字');
        }
        return k.pullEvents(cred(body, _q), after, limit);
      });
    route('POST', '/api/v1/subscriptions', async (_q, _s, _p, _sp, body) => k.subscribe(F(body)));
    route('GET', '/api/v1/receipts/:requestId', async (_q, _s, p, _sp, body) => k.getReceipt(S(p.requestId), cred(body, _q)));

    // ---- v2 客户授信内核（任务01；契约见 docs/customer-next/S1_API_V2_SCHEMA_PROPOSAL.md）----
    const C = k.v2;
    route('POST', '/api/v2/customers', async (_q, _s, _p, _sp, body) => C.createCustomer(F(body)));
    route('POST', '/api/v2/customers/:customerId/grants', async (_q, _s, p, _sp, body) => C.grantCustomerAccess(F(body), S(p.customerId)));
    route('DELETE', '/api/v2/customers/:customerId/grants/:principalId', async (_q, _s, p, _sp, body) => C.revokeCustomerAccess(F(body), S(p.customerId), S(p.principalId)));
    route('GET', '/api/v2/customers/:customerId', async (_q, _s, p, _sp, body) => C.getCustomer(cred(body, _q), S(p.customerId)));
    route('POST', '/api/v2/customers/:customerId/relationships', async (_q, _s, p, _sp, body) => C.declareRelationship(F(body), S(p.customerId)));
    route('GET', '/api/v2/customers/:customerId/relationships', async (_q, _s, p, _sp, body) => C.listRelationships(cred(body, _q), S(p.customerId)));
    route('POST', '/api/v2/customers/:customerId/artifacts', async (_q, _s, p, _sp, body) => C.registerArtifact(F(body), S(p.customerId)));
    route('GET', '/api/v2/customers/:customerId/artifacts', async (_q, _s, p, _sp, body) => C.listArtifacts(cred(body, _q), S(p.customerId)));
    route('POST', '/api/v2/customers/:customerId/assessments', async (_q, _s, p, _sp, body) => C.createAssessment(F(body), S(p.customerId)));
    route('GET', '/api/v2/assessments/:assessmentId', async (_q, _s, p, _sp, body) => C.getAssessment(cred(body, _q), S(p.assessmentId)));
    route('POST', '/api/v2/assessments/:assessmentId/candidate', async (_q, _s, p, _sp, body) => C.submitCandidate(F(body), S(p.assessmentId)));
    route('POST', '/api/v2/assessments/:assessmentId/submit-review', async (_q, _s, p, _sp, body) => C.submitForReview(F(body), S(p.assessmentId)));
    route('POST', '/api/v2/assessments/:assessmentId/decide', async (_q, _s, p, _sp, body) => C.decideAssessment(F(body), S(p.assessmentId)));
    route('POST', '/api/v2/customers/:customerId/facilities', async (_q, _s, p, _sp, body) => C.proposeFacility(F(body), S(p.customerId)));
    route('POST', '/api/v2/facilities/:facilityId/approve', async (_q, _s, p, _sp, body) => C.approveFacility(F(body), S(p.facilityId)));
    route('POST', '/api/v2/facilities/:facilityId/activate', async (_q, _s, p, _sp, body) => C.activateFacility(F(body), S(p.facilityId)));
    route('POST', '/api/v2/facilities/:facilityId/suspend', async (_q, _s, p, _sp, body) => C.suspendFacility(F(body), S(p.facilityId)));
    route('POST', '/api/v2/facilities/:facilityId/reduce', async (_q, _s, p, _sp, body) => C.reduceFacility(F(body), S(p.facilityId)));
    route('GET', '/api/v2/facilities/:facilityId', async (_q, _s, p, _sp, body) => C.getFacility(cred(body, _q), S(p.facilityId)));
    route('POST', '/api/v2/customers/:customerId/financing-requests', async (_q, _s, p, _sp, body) => C.createFinancingRequest(F(body), S(p.customerId)));
    route('GET', '/api/v2/financing-requests/:frId', async (_q, _s, p, _sp, body) => C.getFinancingRequest(cred(body, _q), S(p.frId)));
    route('POST', '/api/v2/financing-requests/:frId/reserve', async (_q, _s, p, _sp, body) => C.reserveFinancing(F(body), S(p.frId)));
    route('POST', '/api/v2/financing-requests/:frId/release', async (_q, _s, p, _sp, body) => C.releaseFinancing(F(body), S(p.frId)));
    route('POST', '/api/v2/financing-requests/:frId/commit', async (_q, _s, p, _sp, body) => C.commitFinancing(F(body), S(p.frId)));
    route('POST', '/api/v2/financing-requests/:frId/disburse', async (_q, _s, p, _sp, body) => C.disburseFinancing(F(body), S(p.frId)));
    route('POST', '/api/v2/financing-requests/:frId/settle', async (_q, _s, p, _sp, body) => C.settleFinancing(F(body), S(p.frId)));
    route('POST', '/api/v2/financing-requests/:frId/confirm-external', async (_q, _s, p, _sp, body) => C.confirmExternal(F(body), S(p.frId)));
    route('GET', '/api/v2/customers/:customerId/exposure', async (_q, _s, p, _sp, body) => C.getCustomerExposure(cred(body, _q), S(p.customerId)));
    route('GET', '/api/v2/customers/:customerId/events', async (_q, _s, p, sp, body) => {
      const after = Number(sp.get('after') ?? 0);
      const limit = Number(sp.get('limit') ?? 100);
      if (!Number.isFinite(after) || !Number.isFinite(limit)) {
        throw new AppError('INVALID_INPUT', 'after/limit 必须是数字');
      }
      return C.listCustomerEvents(cred(body, _q), S(p.customerId), after, limit);
    });
    route('GET', '/api/v2/receipts/:requestId', async (_q, _s, p, _sp, body) => C.getV2Receipt(cred(body, _q), S(p.requestId)));

    // ---- v2 决策闭环（任务02；契约见 Back/A/docs/DECISION_LOOP_V1.md）----
    route('POST', '/api/v2/customers/:customerId/findings', async (_q, _s, p, _sp, body) => C.createFinding(F(body), S(p.customerId)));
    route('GET', '/api/v2/customers/:customerId/findings', async (_q, _s, p, _sp, body) => C.listFindings(cred(body, _q), S(p.customerId)));
    route('GET', '/api/v2/findings/:findingId', async (_q, _s, p, _sp, body) => C.getFinding(cred(body, _q), S(p.findingId)));
    route('POST', '/api/v2/findings/:findingId/resolve', async (_q, _s, p, _sp, body) => C.resolveFinding(F(body), S(p.findingId)));
    route('POST', '/api/v2/customers/:customerId/object-relinks', async (_q, _s, p, _sp, body) => C.registerObjectRelink(F(body), S(p.customerId)));
    route('GET', '/api/v2/customers/:customerId/object-inventory', async (_q, _s, p, _sp, body) => C.listObjectInventory(cred(body, _q), S(p.customerId)));
    route('POST', '/api/v2/customers/:customerId/decision-packages', async (_q, _s, p, _sp, body) => C.createPackage(F(body), S(p.customerId)));
    route('POST', '/api/v2/decision-packages/:packageId/revisions', async (_q, _s, p, _sp, body) => C.revisePackage(F(body), S(p.packageId)));
    route('POST', '/api/v2/decision-packages/:packageId/domain-results', async (_q, _s, p, _sp, body) => C.recordDomainResult(F(body), S(p.packageId)));
    route('POST', '/api/v2/decision-packages/:packageId/adoption', async (_q, _s, p, _sp, body) => C.adoptDomainOpinion(F(body), S(p.packageId)));
    route('POST', '/api/v2/decision-packages/:packageId/gate', async (_q, _s, p, _sp, body) => C.recordGateResult(F(body), S(p.packageId)));
    route('POST', '/api/v2/decision-packages/:packageId/refresh-currency', async (_q, _s, p, _sp, body) => C.refreshPackageCurrency(F(body), S(p.packageId)));
    route('GET', '/api/v2/decision-packages/:packageId', async (_q, _s, p, _sp, body) => C.getPackage(cred(body, _q), S(p.packageId)));
    route('GET', '/api/v2/customers/:customerId/decision-status', async (_q, _s, p, _sp, body) => C.getCustomerDecisionStatus(cred(body, _q), S(p.customerId)));
    route('POST', '/api/v2/customers/:customerId/reports', async (_q, _s, p, _sp, body) => C.generateReport(F(body), S(p.customerId)));
    route('GET', '/api/v2/customers/:customerId/reports', async (_q, _s, p, _sp, body) => C.listReports(cred(body, _q), S(p.customerId)));
    route('GET', '/api/v2/reports/:reportId', async (_q, _s, p, sp, body) => C.getReport(cred(body, _q), S(p.reportId), sp.get('format')));
    route('GET', '/api/v2/financing-requests/:frId/use-readiness', async (_q, _s, p, _sp, body) => C.getUseReadiness(cred(body, _q), S(p.frId)));

    route('POST', '/api/v2/customers/:customerId/limit-increase-requests', async (_q, _s, p, _sp, body) => C.createLimitIncreaseRequest(F(body), S(p.customerId)));
    route('POST', '/api/v2/limit-increase-requests/:requestId/resolve', async (_q, _s, p, _sp, body) => C.resolveLimitIncreaseRequest(F(body), S(p.requestId)));

    // ---- 任务01 A2 可信规则回执通道 ----
    const AN = k.analysis;
    route('POST', '/api/v2/rule-pack-versions/activate', async (_q, _s, _p, _sp, body) => AN.activateRulePack(F(body)));
    route('POST', '/api/v2/customers/:customerId/rule-gate-receipts', async (_q, _s, p, _sp, body) => AN.registerGateReceipt(F(body), S(p.customerId)));
    route('POST', '/api/v2/customers/:customerId/analysis-runs/start', async (_q, _s, p, _sp, body) => AN.startAnalysisRun(F(body), S(p.customerId)));
    route('POST', '/api/v2/analysis-runs/:runId/finish', async (_q, _s, p, _sp, body) => AN.finishAnalysisRun(F(body), S(p.runId)));
    // ---- goal-01 G1 豁免登记（不变量 2：豁免须引用真实有权批准记录）----
    route('POST', '/api/v2/customers/:customerId/domain-exemptions', async (_q, _s, p, _sp, body) => AN.registerDomainExemption(F(body), S(p.customerId)));
    route('GET', '/api/v2/customers/:customerId/domain-exemptions', async (_q, _s, p, _sp, body) => AN.listDomainExemptions(cred(body, _q), S(p.customerId)));
    route('DELETE', '/api/v2/domain-exemptions/:exemptionId', async (_q, _s, p, _sp, body) => AN.revokeDomainExemption(F(body), S(p.exemptionId)));

    // ---- v2.4 身份与办理面（goal-01 四任务轮；契约见 CONTRACT §11）----
    const ID = k.identity;
    route('GET', '/api/v2/customers', async (_q, _s, _p, sp, body) => ID.listCustomersDirectory(cred(body, _q), { search: sp.get('search'), limit: sp.get('limit'), cursor: sp.get('cursor') }));
    route('POST', '/api/v2/customers/:customerId/invitations', async (_q, _s, p, _sp, body) => ID.createInvitation(F(body), S(p.customerId)));
    route('GET', '/api/v2/customers/:customerId/invitations', async (_q, _s, p, _sp, body) => ID.listInvitations(cred(body, _q), S(p.customerId)));
    route('POST', '/api/v2/invitations/:invitationId/revoke', async (_q, _s, p, _sp, body) => ID.revokeInvitation(F(body), S(p.invitationId)));
    route('POST', '/api/v2/invitations/redeem', async (_q, _s, _p, _sp, body) => ID.redeemInvitation(F(body)));
    route('POST', '/api/v2/customers/:customerId/artifacts/:artifactId/processing', async (_q, _s, p, _sp, body) => ID.recordArtifactProcessing(F(body), S(p.customerId), S(p.artifactId)));
    route('GET', '/api/v2/customers/:customerId/artifacts/:artifactId/processing', async (_q, _s, p, _sp, body) => ID.getArtifactProcessing(cred(body, _q), S(p.customerId), S(p.artifactId)));
    route('GET', '/api/v2/my/materials', async (_q, _s, _p, _sp, body) => ID.listMyMaterials(cred(body, _q)));

    // ---- 检查会话（任务一；契约见 Back/A/docs/INSPECTION_SESSION_V1.md）----
    const IX = k.ix;
    route('POST', '/api/v1/projects/:projectId/inspections', async (_q, _s, p, _sp, body) => IX.createSession(F(body), S(p.projectId)));
    route('GET', '/api/v1/inspections/:sessionId', async (_q, _s, p, _sp, body) => IX.getSession(S(p.sessionId), cred(body, _q)));
    route('GET', '/api/v1/inspections/:sessionId/next-actions', async (_q, _s, p, _sp, body) => IX.getNextActions(S(p.sessionId), cred(body, _q)));
    route('POST', '/api/v1/inspections/:sessionId/plan', async (_q, _s, p, _sp, body) => IX.revisePlan(F(body), S(p.sessionId)));
    route('POST', '/api/v1/inspections/:sessionId/scene', async (_q, _s, p, _sp, body) => IX.reviseScene(F(body), S(p.sessionId)));
    route('POST', '/api/v1/inspections/:sessionId/start', async (_q, _s, p, _sp, body) => IX.startSession(F(body), S(p.sessionId)));
    route('POST', '/api/v1/inspections/:sessionId/pause', async (_q, _s, p, _sp, body) => IX.pauseSession(F(body), S(p.sessionId)));
    route('POST', '/api/v1/inspections/:sessionId/resume', async (_q, _s, p, _sp, body) => IX.resumeSession(F(body), S(p.sessionId)));
    route('POST', '/api/v1/inspections/:sessionId/end', async (_q, _s, p, _sp, body) => IX.endSession(F(body), S(p.sessionId)));
    route('POST', '/api/v1/inspections/:sessionId/close', async (_q, _s, p, _sp, body) => IX.closeSession(F(body), S(p.sessionId)));
    route('POST', '/api/v1/inspections/:sessionId/presence', async (_q, _s, p, _sp, body) => IX.setPresence(F(body), S(p.sessionId)));
    route('POST', '/api/v1/inspections/:sessionId/takeover', async (_q, _s, p, _sp, body) => IX.takeoverSession(F(body), S(p.sessionId)));
    route('POST', '/api/v1/inspections/:sessionId/items', async (_q, _s, p, _sp, body) => IX.addItem(F(body), S(p.sessionId)));
    route('POST', '/api/v1/inspections/:sessionId/items/:itemId/verify', async (_q, _s, p, _sp, body) => IX.verifyItem(F(body), S(p.sessionId), S(p.itemId)));
    route('POST', '/api/v1/inspections/:sessionId/items/:itemId/rebind', async (_q, _s, p, _sp, body) => IX.rebindItem(F(body), S(p.sessionId), S(p.itemId)));
    route('POST', '/api/v1/inspections/:sessionId/items/:itemId/reassign', async (_q, _s, p, _sp, body) => IX.reassignItem(F(body), S(p.sessionId), S(p.itemId)));
    route('POST', '/api/v1/inspections/:sessionId/questions', async (_q, _s, p, _sp, body) => IX.createQuestion(F(body), S(p.sessionId)));
    route('POST', '/api/v1/inspections/:sessionId/questions/:questionId/answer', async (_q, _s, p, _sp, body) => IX.answerQuestion(F(body), S(p.sessionId), S(p.questionId)));
    route('POST', '/api/v1/inspections/:sessionId/questions/:questionId/reask', async (_q, _s, p, _sp, body) => IX.reaskQuestion(F(body), S(p.sessionId), S(p.questionId)));
    route('POST', '/api/v1/inspections/:sessionId/outbound/grant', async (_q, _s, p, _sp, body) => IX.grantOutbound(F(body), S(p.sessionId)));
    route('POST', '/api/v1/inspections/:sessionId/outbound/:sendId/result', async (_q, _s, p, _sp, body) => IX.outboundResult(F(body), S(p.sessionId), S(p.sendId)));
    route('POST', '/api/v1/inspections/:sessionId/sweep', async (_q, _s, p, _sp, body) => IX.sweep(F(body), S(p.sessionId)));
    route('POST', '/api/v1/inspections/:sessionId/evidence', async (_q, _s, p, _sp, body) => IX.addLateEvidence(F(body), S(p.sessionId)));
    route('POST', '/api/v1/inspections/:sessionId/checkpoint', async (_q, _s, p, _sp, body) => IX.writeCheckpointCommand(F(body), S(p.sessionId)));
    route('GET', '/api/v1/inspections/:sessionId/summary', async (_q, _s, p, sp, body) => {
      const revision = sp.get('revision');
      return IX.getSummaries(S(p.sessionId), sp.get('audience'), revision === null ? null : Number(revision), cred(body, _q));
    });

    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => resolve(server));
    });
}
