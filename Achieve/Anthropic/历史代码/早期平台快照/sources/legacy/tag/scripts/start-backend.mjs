import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { homedir } from 'node:os'
import { DurableApp, Glm53Adapter, startHttpServer } from '../src/index.mjs'

const path = resolve(process.env.TAG_DB_PATH ?? `${process.env.LOCALAPPDATA ?? `${homedir()}/AppData/Local`}/TAG/p0.sqlite`)
mkdirSync(dirname(path), { recursive: true })
const modelAdapter = process.env.TAG_GLM_API_KEY || process.env.ZAI_API_KEY ? new Glm53Adapter() : null
const app = new DurableApp(path, { modelAdapter })
const service = await startHttpServer(app, { host: '127.0.0.1', port: Number(process.env.PORT ?? 4174), origins: (process.env.TAG_CORS_ORIGINS ?? '').split(',').filter(Boolean) })
console.log(`TAG local backend listening at http://127.0.0.1:${service.server.address().port}`)
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await service.close(); app.close(); process.exit(0) })
