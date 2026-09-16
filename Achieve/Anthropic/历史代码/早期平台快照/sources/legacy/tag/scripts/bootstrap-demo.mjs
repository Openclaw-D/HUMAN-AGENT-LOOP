import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { homedir } from 'node:os'
import { DurableApp, ActorClass } from '../src/index.mjs'
import { canonicalHash } from '../src/event-log.mjs'

const path = resolve(process.env.TAG_DB_PATH ?? `${process.env.LOCALAPPDATA ?? `${homedir()}/AppData/Local`}/TAG/p0.sqlite`)
mkdirSync(dirname(path), { recursive: true })
const app = new DurableApp(path)
const payload = { id: 'demo-project', title: 'Simulated local business/risk review', memberships: [
  { principalId: 'business', capabilities: ['message', 'addEvidence', 'submit', 'answer', 'invoke', 'reconsider'] },
  { principalId: 'risk', capabilities: ['message', 'communicate', 'resolve', 'decide', 'invoke', 'reconsider'] },
] }
const actor = { id: 'business', class: ActorClass.HUMAN }
try { app.bootstrapProject(payload, { actor, idempotencyKey: 'simulated-demo-bootstrap', requestHash: canonicalHash(payload) }); console.log(`Simulated demo project ready: ${path}`) }
catch (error) { if (error.message === 'IDEMPOTENCY_CONFLICT') throw error; console.log(`Simulated demo project already exists: ${path}`) }
finally { app.close() }
