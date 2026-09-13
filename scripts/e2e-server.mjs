import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const pythonCommand = process.env.PYTHON_COMMAND || (process.platform === 'win32' ? 'python' : 'python3')
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'social-cosmos-e2e-'))
const apiPort = process.env.E2E_API_PORT || '8788'
const webPort = process.env.E2E_WEB_PORT || '4173'
const databasePath = join(temporaryDirectory, 'e2e.db').replaceAll('\\', '/')
const quiet = process.env.E2E_QUIET === 'true'

const environment = {
  ...process.env,
  PYTHONUTF8: '1',
  PYTHONIOENCODING: 'utf-8',
  API_HOST: '127.0.0.1',
  API_PORT: apiPort,
  VITE_HOST: '127.0.0.1',
  VITE_PORT: webPort,
  VITE_API_PROXY_TARGET: `http://127.0.0.1:${apiPort}`,
  SOCIAL_COSMOS_DATABASE_URL: `sqlite:///${databasePath}?timeout=30`,
  SOCIAL_COSMOS_SEED_DEMO: 'true',
  SOCIAL_COSMOS_UPLOAD_DIR: join(temporaryDirectory, 'uploads'),
  CONVERSATION_AGENT_PROVIDER: 'e2e',
  SOCIAL_COSMOS_E2E_CONTROLS: 'true',
  SOCIAL_COSMOS_TEST_CLEANUP_ENABLED: 'true',
  OPENVIKING_URL: '',
  OPENVIKING_API_KEY: '',
  NEO4J_URI: '',
  AI_API_KEY: '',
  CONVERSATION_AI_API_KEY: '',
  OPENVIKING_AI_API_KEY: '',
  OPENVIKING_AI_EMB_API_KEY: '',
}

if (process.env.E2E_SKIP_BUILD !== 'true') {
  const build = spawnSync(npmCommand, ['run', 'build'], {
    env: environment,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (build.status !== 0) {
    rmSync(temporaryDirectory, { recursive: true, force: true })
    process.exit(build.status || 1)
  }
}

const children = [
  spawn(
    pythonCommand,
    [
      '-m', 'uvicorn', 'app.main:app', '--app-dir', 'backend',
      '--host', '127.0.0.1', '--port', apiPort,
      ...(quiet ? ['--log-level', 'warning'] : []),
    ],
    { env: environment, stdio: 'inherit' },
  ),
  spawn(
    npmCommand,
    [
      'run', 'preview', '--', '--mode', 'test', '--host', '127.0.0.1', '--port', webPort,
      ...(quiet ? ['--logLevel', 'silent'] : []),
    ],
    { env: environment, stdio: 'inherit', shell: process.platform === 'win32' },
  ),
]

let closing = false
function stopChild(child) {
  if (child.exitCode !== null || !child.pid) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true,
    })
  } else {
    child.kill('SIGTERM')
  }
}

function shutdown(code = 0) {
  if (closing) return
  closing = true
  for (const child of children) stopChild(child)
  setTimeout(() => {
    rmSync(temporaryDirectory, { recursive: true, force: true })
    process.exit(code)
  }, 500)
}

for (const child of children) {
  child.on('error', (error) => {
    console.error(`[e2e-server] ${error.message}`)
    shutdown(1)
  })
  child.on('exit', (code, signal) => {
    if (!closing) shutdown(code || (signal ? 1 : 0))
  })
}

process.on('SIGINT', () => shutdown())
process.on('SIGTERM', () => shutdown())
