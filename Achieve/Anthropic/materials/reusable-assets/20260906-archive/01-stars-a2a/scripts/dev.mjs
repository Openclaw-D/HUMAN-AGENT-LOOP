import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const api = spawn(process.execPath, ['server/index.mjs'], { stdio: 'inherit' })
const viteCli = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url))
const web = spawn(process.execPath, [viteCli], { stdio: 'inherit' })
const children = [api, web]

function stop(code = 0) {
  for (const child of children) {
    if (!child.killed) child.kill()
  }
  process.exit(code)
}

for (const child of children) {
  child.on('exit', (code) => {
    if (code && code !== 0) stop(code)
  })
}

process.on('SIGINT', () => stop())
process.on('SIGTERM', () => stop())
