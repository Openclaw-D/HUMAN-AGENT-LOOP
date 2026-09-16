import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export function loadSnapshot(filePath) {
  if (!existsSync(filePath)) return undefined
  try {
    const snapshot = JSON.parse(readFileSync(filePath, 'utf8'))
    return snapshot?.schemaVersion === 1 ? snapshot : undefined
  } catch {
    return undefined
  }
}

export function saveSnapshot(filePath, snapshot) {
  mkdirSync(dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.tmp`
  writeFileSync(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
  renameSync(temporaryPath, filePath)
}

export function appendAuditEvents(filePath, contextId, events) {
  if (events.length === 0) return
  mkdirSync(dirname(filePath), { recursive: true })
  const lines = events.map((event) => JSON.stringify({ contextId, ...event })).join('\n')
  appendFileSync(filePath, `${lines}\n`, 'utf8')
}
