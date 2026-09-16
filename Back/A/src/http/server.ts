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
            if (req.method === 'POST') {
                const raw = await readBody(req);
                body = raw.trim().length === 0 ? {} : JSON.parse(raw); // eslint-disable-line @typescript-eslint/no-unsafe-assignment
            }
            // 身份凭据：头优先，body 字段同义
            const credential = req.headers['x-principal-credential'] ??
                (body !== null && typeof body === 'object' ? (body as Record<string, unknown>).principalCredential : undefined);
            const frame = { ...(body as Record<string, unknown>), credential };
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
    route('GET', '/api/v1/templates/:templateId', async (_q, _s, p) => k.getTemplate(S(p.templateId)));
    route('POST', '/api/v1/templates', async (_q, _s, _p, _sp, body) => k.createTemplate(F(body)));
    route('POST', '/api/v1/projects', async (_q, _s, _p, _sp, body) => k.createProject(F(body)));
    route('GET', '/api/v1/projects/:projectId', async (_q, _s, p) => k.getProject(S(p.projectId)));
    route('POST', '/api/v1/projects/:projectId/goals', async (_q, _s, p, _sp, body) => k.createGoal(F(body), S(p.projectId)));
    route('GET', '/api/v1/projects/:projectId/human-requests', async (_q, _s, p) => k.listHumanRequests(S(p.projectId)));
    route('POST', '/api/v1/projects/:projectId/human-requests', async (_q, _s, p, _sp, body) => k.createHumanRequest(F(body), S(p.projectId)));
    route('POST', '/api/v1/projects/:projectId/evidence', async (_q, _s, p, _sp, body) => k.submitEvidence(F(body), S(p.projectId)));
    route('POST', '/api/v1/projects/:projectId/evidence/:evidenceId/supersede', async (_q, _s, p, _sp, body) => k.supersedeEvidence(F(body), S(p.projectId), S(p.evidenceId)));
    route('POST', '/api/v1/projects/:projectId/pause', async (_q, _s, p, _sp, body) => k.projectPause(F(body), S(p.projectId)));
    route('POST', '/api/v1/projects/:projectId/resume', async (_q, _s, p, _sp, body) => k.projectResume(F(body), S(p.projectId)));
    route('GET', '/api/v1/goals/:goalId', async (_q, _s, p) => k.getGoal(S(p.goalId)));
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
    route('GET', '/api/v1/events', async (_q, _s, _p, sp) => {
        const after = Number(sp.get('after') ?? 0);
        const limit = Number(sp.get('limit') ?? 100);
        if (!Number.isFinite(after) || !Number.isFinite(limit)) {
            throw new AppError('INVALID_INPUT', 'after/limit 必须是数字');
        }
        return k.pullEvents(after, limit);
    });
    route('POST', '/api/v1/subscriptions', async (_q, _s, _p, _sp, body) => k.subscribe(F(body)));
    route('GET', '/api/v1/receipts/:requestId', async (_q, _s, p) => k.getReceipt(S(p.requestId)));

    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => resolve(server));
    });
}
