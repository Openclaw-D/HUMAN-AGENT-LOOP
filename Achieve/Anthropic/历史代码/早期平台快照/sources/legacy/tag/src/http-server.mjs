import { createServer } from 'node:http'

const statusFor = code => ({ REQUEST_HASH_MISMATCH: 400, AGENT_ID_REQUIRED: 400, EVIDENCE_CRITERION_INVALID: 400, CAPABILITY_REQUIRED: 403, HUMAN_AUTHORITY_REQUIRED: 403, ACTIVE_MEMBERSHIP_REQUIRED: 403, PROJECT_NOT_FOUND: 404, THREAD_NOT_FOUND: 404, SNAPSHOT_NOT_FOUND: 404, REVIEW_ROUND_NOT_FOUND: 404, ADVISORY_RUN_NOT_FOUND: 404, IDEMPOTENCY_CONFLICT: 409, VERSION_CONFLICT: 409, ADVISORY_RUN_FENCE_CONFLICT: 409, STATE_TRANSITION_INVALID: 409, PRECHECK_ATTEMPT_LIMIT_REACHED: 409, FORMAL_REVIEW_PASS_LIMIT_REACHED: 409, SNAPSHOT_PHASE_INVALID: 409, ADVISORY_INVALID_OUTPUT: 422, EVENT_LOG_CORRUPT: 503, ADVISORY_UNAVAILABLE: 503, ADVISORY_RATE_LIMITED: 503 }[code] ?? 400)
const send = (res, status, value) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)) }
const body = req => new Promise((resolve, reject) => { let value = ''; req.on('data', x => { value += x; if (value.length > 1_000_000) reject(new Error('REQUEST_TOO_LARGE')) }); req.on('end', () => { try { resolve(value ? JSON.parse(value) : {}) } catch { reject(Object.assign(new Error('INVALID_SCHEMA'), { code: 'INVALID_SCHEMA' })) } }) })

export function startHttpServer(app, { host = '127.0.0.1', port = 4174, origins = [] } = {}) {
  const clients = new Map()
  const fanout = event => { for (const res of clients.get(event.projectId) ?? []) res.write(`id: ${event.sequence}\ndata: ${JSON.stringify(event)}\n\n`) }
  const unsubscribe = app.onEvent(fanout)
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${host}:${port}`); const parts = url.pathname.split('/').filter(Boolean); const projectId = parts[2]
      const origin = req.headers.origin; const allowedOrigin = origin && origins.includes(origin)
      if (origin && !allowedOrigin) return send(res, 403, { error: { code: 'CORS_ORIGIN_DENIED', message: 'Request rejected' } })
      if (allowedOrigin) { res.setHeader('access-control-allow-origin', origin); res.setHeader('vary', 'Origin') }
      if (req.method === 'OPTIONS' && parts[0] === 'api' && parts[1] === 'projects' && parts[3] === 'commands') {
        if (!allowedOrigin) return send(res, 403, { error: { code: 'CORS_ORIGIN_DENIED', message: 'Request rejected' } })
        res.writeHead(204, { 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type' }); return res.end()
      }
      if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, app.health())
      if (req.method === 'GET' && parts[0] === 'api' && parts[1] === 'projects' && parts[3] === 'state') return send(res, 200, app.state(projectId))
      if (req.method === 'GET' && parts[0] === 'api' && parts[1] === 'projects' && parts[3] === 'graph') return send(res, 200, app.graph(projectId))
      if (req.method === 'GET' && parts[0] === 'api' && parts[1] === 'projects' && parts[3] === 'judgment') return send(res, 200, app.judgment(projectId, url.searchParams.get('threadId')))
      if (req.method === 'GET' && parts[0] === 'api' && parts[1] === 'projects' && parts[3] === 'events' && parts[4] !== 'stream') return send(res, 200, app.events(projectId, Number(url.searchParams.get('after') ?? 0)))
      if (req.method === 'GET' && parts[0] === 'api' && parts[1] === 'projects' && parts[3] === 'events' && parts[4] === 'stream') { const last = Number(req.headers['last-event-id'] ?? 0); const bounds = app.eventBounds(projectId); res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' }); res.flushHeaders?.(); if (last && (!bounds.first || last < bounds.first - 1 || last > bounds.last)) res.write('event: reset\ndata: {"reason":"cursor_unavailable"}\n\n'); else for (const event of app.events(projectId, last)) res.write(`id: ${event.sequence}\ndata: ${JSON.stringify(event)}\n\n`); const set = clients.get(projectId) ?? new Set(); set.add(res); clients.set(projectId, set); req.on('close', () => set.delete(res)); return }
      if (req.method === 'POST' && parts[0] === 'api' && parts[1] === 'projects' && parts[3] === 'commands') { const input = await body(req); const raw = await app.command(projectId, input.command, input.payload, input.envelope); const data = input.command === 'requestModelAdvisory' ? { runId: raw.advisoryRun.id, attempt: raw.advisoryRun.attempt, fencingToken: raw.advisoryRun.fencingToken, status: raw.advisoryRun.status, ...(raw.advisoryRun.artifactId ? { artifactId: raw.advisoryRun.artifactId } : {}), ...(raw.advisoryRun.failureCode ? { failureCode: raw.advisoryRun.failureCode } : {}) } : raw; return send(res, 200, { data, projectVersion: app.projectVersion(projectId, input.payload.threadId), eventSequence: app.health().eventSequence }) }
      return send(res, 404, { error: { code: 'NOT_FOUND', message: 'Not found' } })
    } catch (error) { return send(res, statusFor(error.code ?? error.message), { error: { code: error.code ?? error.message, message: 'Request rejected' } }) }
  })
  return new Promise(resolve => server.listen(port, host, () => resolve({ server, close: () => { unsubscribe(); return new Promise(done => server.close(done)) } })))
}
