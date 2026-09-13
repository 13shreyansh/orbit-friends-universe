import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { loadEnvFile } from 'node:process'

const envFiles = ['.env.development.local', '.env.development', '.env.local', '.env']
const loadedEnvFiles = []
for (const envFile of envFiles) {
  if (!existsSync(envFile)) continue
  loadEnvFile(envFile)
  loadedEnvFiles.push(envFile)
}

if (loadedEnvFiles.length > 0) {
  console.log(`[dev] Loaded environment from ${loadedEnvFiles.join(', ')}`)
}

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const pythonCommand = process.env.PYTHON_COMMAND || 'python'
const apiHost = process.env.API_HOST || '127.0.0.1'
const apiPort = process.env.API_PORT || '8787'

const children = [
  spawn(pythonCommand, ['-m', 'uvicorn', 'app.main:app', '--app-dir', 'backend', '--host', apiHost, '--port', apiPort], {
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    stdio: 'inherit',
  }),
  spawn(npmCommand, ['run', 'dev:web'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  }),
]

let closing = false
function shutdown(code = 0) {
  if (closing) return
  closing = true
  for (const child of children) child.kill()
  process.exitCode = code
}

for (const child of children) {
  child.on('exit', (code) => {
    if (!closing && code && code !== 0) shutdown(code)
  })
}

process.on('SIGINT', () => shutdown())
process.on('SIGTERM', () => shutdown())
