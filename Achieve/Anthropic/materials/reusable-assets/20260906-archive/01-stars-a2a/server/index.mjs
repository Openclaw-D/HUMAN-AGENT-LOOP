import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { A2A_VERSION, AGENT_IDS, A2ACoordinationEngine, createAgentCards, rpcError } from './a2a-core.mjs'
import { appendAuditEvents, loadSnapshot, saveSnapshot } from './store.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const port = Number(process.env.STARS_API_PORT ?? 8787)
const host = process.env.STARS_API_HOST ?? '127.0.0.1'
const dataFile = process.env.STARS_DATA_FILE ?? join(root, '.stars-data', 'a2a-state.json')
const auditFile = process.env.STARS_AUDIT_FILE ?? join(root, '.stars-data', 'audit.jsonl')
const initialSnapshot = loadSnapshot(dataFile)
const engine = new A2ACoordinationEngine(initialSnapshot)
const persistedSequences = new Map((initialSnapshot?.contexts ?? []).map((context) => [context.id, context.audit?.at(-1)?.sequence ?? 0]))
const subscribers = new Set()

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
}

function sendJson(response, statusCode, data, headers = {}) {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8', ...headers })
  response.end(JSON.stringify(data))
}

function sendError(response, statusCode, error) {
  sendJson(response, statusCode, { error: error instanceof Error ? error.message : String(error) })
}

async function readJson(request) {
  let body = ''
  for await (const chunk of request) {
    body += chunk
    if (body.length > 1_000_000) throw new Error('请求体超过 1 MB 限制。')
  }
  if (!body) return {}
  try {
    return JSON.parse(body)
  } catch {
    throw new Error('请求体不是有效 JSON。')
  }
}

function persistAndNotify(context) {
  const lastSequence = persistedSequences.get(context.id) ?? 0
  const newEvents = (context.audit ?? []).filter((event) => event.sequence > lastSequence)
  appendAuditEvents(auditFile, context.id, newEvents)
  if (newEvents.length > 0) persistedSequences.set(context.id, newEvents.at(-1).sequence)
  saveSnapshot(dataFile, engine.exportSnapshot())
  const payload = `event: context\ndata: ${JSON.stringify(context)}\n\n`
  for (const response of subscribers) response.write(payload)
}

function a2aVersion(request, response) {
  const requested = request.headers['a2a-version']
  if (requested === A2A_VERSION) return true
  sendJson(response, 400, rpcError(null, -32009, `仅支持 A2A-Version: ${A2A_VERSION}`, 'VERSION_NOT_SUPPORTED'))
  return false
}

function serveStatic(response, pathname) {
  const dist = join(root, 'dist')
  if (!existsSync(dist)) return false
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
  const candidate = resolve(dist, relative)
  if (!candidate.startsWith(dist) || !existsSync(candidate) || !statSync(candidate).isFile()) {
    const index = join(dist, 'index.html')
    if (!existsSync(index)) return false
    response.writeHead(200, { 'Content-Type': mimeTypes['.html'] })
    createReadStream(index).pipe(response)
    return true
  }
  response.writeHead(200, { 'Content-Type': mimeTypes[extname(candidate)] ?? 'application/octet-stream' })
  createReadStream(candidate).pipe(response)
  return true
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? `${host}:${port}`}`)
  const pathname = url.pathname
  try {
    if (request.method === 'GET' && pathname === '/health') {
      return sendJson(response, 200, { ok: true, protocolVersion: A2A_VERSION, persistence: dataFile, appendOnlyAudit: auditFile })
    }
    if (request.method === 'GET' && pathname === '/.well-known/agent-card.json') {
      return sendJson(response, 200, createAgentCards(`http://${host}:${port}`).supervisor, { 'Cache-Control': 'public, max-age=300' })
    }
    const cardMatch = pathname.match(/^\/\.well-known\/agents\/(supervisor|business|risk)\/agent-card\.json$/)
    if (request.method === 'GET' && cardMatch) {
      return sendJson(response, 200, createAgentCards(`http://${host}:${port}`)[cardMatch[1]], { 'Cache-Control': 'public, max-age=300' })
    }
    const a2aMatch = pathname.match(/^\/a2a\/(supervisor|business|risk)$/)
    if (request.method === 'POST' && a2aMatch) {
      if (!a2aVersion(request, response)) return
      const result = engine.handleRpc(a2aMatch[1], await readJson(request))
      if (!result.error) persistAndNotify(engine.listContexts()[0] ?? {})
      return sendJson(response, 200, result)
    }
    if (request.method === 'GET' && pathname === '/api/agents') {
      const cards = createAgentCards(`http://${host}:${port}`)
      return sendJson(response, 200, AGENT_IDS.map((id) => ({ id, ...cards[id] })))
    }
    if (request.method === 'GET' && pathname === '/api/contexts') {
      return sendJson(response, 200, engine.listContexts())
    }
    const contextMatch = pathname.match(/^\/api\/contexts\/([^/]+)$/)
    if (request.method === 'GET' && contextMatch) {
      return sendJson(response, 200, engine.getContext(contextMatch[1]))
    }
    if (request.method === 'POST' && pathname === '/api/contexts') {
      const context = engine.createContext(await readJson(request))
      persistAndNotify(context)
      return sendJson(response, 201, context)
    }
    const actionMatch = pathname.match(/^\/api\/contexts\/([^/]+)\/(run|evidence|risk-decision|reconsider)$/)
    if (request.method === 'POST' && actionMatch) {
      const [, contextId, action] = actionMatch
      const input = await readJson(request)
      const context = action === 'run'
        ? engine.runRound(contextId)
        : action === 'evidence'
          ? engine.addEvidence(contextId, input)
          : action === 'risk-decision'
            ? engine.recordRiskDecision(contextId, input)
            : engine.reconsiderContext(contextId, input)
      persistAndNotify(context)
      return sendJson(response, 200, context)
    }
    if (request.method === 'GET' && pathname === '/api/events') {
      response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })
      response.write(`event: ready\ndata: {"protocolVersion":"${A2A_VERSION}"}\n\n`)
      subscribers.add(response)
      request.on('close', () => subscribers.delete(response))
      return
    }
    if (request.method === 'GET' && serveStatic(response, pathname)) return
    sendJson(response, 404, { error: 'Not found' })
  } catch (error) {
    sendError(response, error instanceof Error && error.message.includes('不存在') ? 404 : 400, error)
  }
})

server.listen(port, host, () => {
  console.log(`STARS A2A server: http://${host}:${port}`)
  console.log(`A2A agent card: http://${host}:${port}/.well-known/agent-card.json`)
})
