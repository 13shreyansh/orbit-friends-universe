import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { loadEnvFile } from 'node:process'

for (const envFile of ['.env.development.local', '.env.development', '.env.local', '.env']) {
  if (existsSync(envFile)) loadEnvFile(envFile)
}

const pythonCommand = process.env.PYTHON_COMMAND || 'python'
const apiHost = process.env.API_HOST || '127.0.0.1'
const apiPort = process.env.API_PORT || '8787'
const child = spawn(
  pythonCommand,
  ['-m', 'uvicorn', 'app.main:app', '--app-dir', 'backend', '--host', apiHost, '--port', apiPort],
  {
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    stdio: 'inherit',
  },
)

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  process.exitCode = code ?? 1
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal))
}
