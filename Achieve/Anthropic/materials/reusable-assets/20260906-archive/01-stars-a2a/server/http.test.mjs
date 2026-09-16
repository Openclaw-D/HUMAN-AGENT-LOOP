import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const port = 18_000 + Math.floor(Math.random() * 1_000)
const baseUrl = `http://127.0.0.1:${port}`
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'stars-a2a-http-'))
const dataFile = join(temporaryDirectory, 'state.json')
const auditFile = join(temporaryDirectory, 'audit.jsonl')
let serverProcess

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/health`)
      if (response.ok) return
    } catch {
      // The child process may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('Temporary STARS server did not become ready.')
}

async function json(path, init) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  const body = await response.json()
  if (!response.ok) throw new Error(body.error ?? JSON.stringify(body))
  return body
}

beforeAll(async () => {
  serverProcess = spawn(process.execPath, ['server/index.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      STARS_API_PORT: String(port),
      STARS_DATA_FILE: dataFile,
      STARS_AUDIT_FILE: auditFile,
    },
    stdio: 'ignore',
    windowsHide: true,
  })
  await waitForServer()
})

afterAll(() => {
  serverProcess?.kill()
  rmSync(temporaryDirectory, { recursive: true, force: true })
})

describe('STARS A2A HTTP vertical slice', () => {
  it('publishes the card and completes challenge, evidence and risk-decision gates', async () => {
    const health = await json('/health')
    const card = await json('/.well-known/agent-card.json')
    expect(health).toMatchObject({ ok: true, protocolVersion: '1.0' })
    expect(card.supportedInterfaces[0]).toMatchObject({ protocolVersion: '1.0', protocolBinding: 'JSONRPC' })

    const rpc = await json('/a2a/supervisor', {
      method: 'POST',
      headers: { 'A2A-Version': '1.0' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'list-1', method: 'ListTasks', params: {} }),
    })
    expect(rpc.result.tasks).toEqual([])

    const context = await json('/api/contexts', {
      method: 'POST',
      body: JSON.stringify({
        goal: '让设备融资首轮审查形成证据完整且可执行的风险结论',
        successMetric: '硬门槛有证据且最终裁决可追溯',
        minimumYield: 82,
        constraints: ['风控否决不可覆盖', '证据必须可定位'],
        evidence: [{ title: '融资租赁合同', source: '业务材料', locator: '合同第 4 页' }],
      }),
    })
    const firstRound = await json(`/api/contexts/${context.id}/run`, { method: 'POST', body: '{}' })
    expect(firstRound.phase).toBe('风控质询·业务补证')
    expect(firstRound.yield.openChallenges.length).toBeGreaterThan(0)

    await json(`/api/contexts/${context.id}/evidence`, {
      method: 'POST',
      body: JSON.stringify({ title: '设备发票', source: '发票系统', locator: 'invoice-001' }),
    })
    await json(`/api/contexts/${context.id}/evidence`, {
      method: 'POST',
      body: JSON.stringify({ title: '回款流水', source: '银行回单', locator: '流水第 8 行' }),
    })
    const secondRound = await json(`/api/contexts/${context.id}/run`, { method: 'POST', body: '{}' })
    expect(secondRound.phase).toBe('等待风控裁决')
    expect(secondRound.yield.readyForDecision).toBe(true)
    expect(secondRound.yield.achieved).toBe(false)

    const final = await json(`/api/contexts/${context.id}/risk-decision`, {
      method: 'POST',
      body: JSON.stringify({ outcome: 'conditionally_approved', note: '放款前再次核对设备交付记录。' }),
    })
    expect(final).toMatchObject({
      status: 'TASK_STATE_COMPLETED',
      governanceStatus: 'CONDITIONALLY_APPROVED',
      finalDecision: { actor: 'risk-human' },
    })
    expect(final.yield.achieved).toBe(true)

    const auditLines = readFileSync(auditFile, 'utf8').trim().split('\n')
    expect(auditLines.length).toBe(final.audit.length)
  })

  it('rejects a missing or unsupported A2A version', async () => {
    const response = await fetch(`${baseUrl}/a2a/supervisor`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'A2A-Version': '0.3' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'bad-version', method: 'ListTasks', params: {} }),
    })
    const body = await response.json()
    expect(response.status).toBe(400)
    expect(body.error.code).toBe(-32009)
  })
})
