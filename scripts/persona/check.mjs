import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const projectRoot = resolve(import.meta.dirname, '../..')
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'social-cosmos-persona-'))
const databasePath = join(temporaryDirectory, 'persona-check.db')
const reportPath = join(temporaryDirectory, 'replay-report.json')
const uploadPath = join(temporaryDirectory, 'uploads')
const port = 8900 + (process.pid % 500)
const apiBase = `http://127.0.0.1:${port}/api`
const pythonCommand = process.env.PYTHON_COMMAND || (process.platform === 'win32' ? 'python' : 'python3')
const environment = {
  ...process.env,
  PYTHONUTF8: '1',
  PYTHONIOENCODING: 'utf-8',
  API_HOST: '127.0.0.1',
  API_PORT: String(port),
  SOCIAL_COSMOS_DATABASE_URL: `sqlite:///${databasePath}`,
  SOCIAL_COSMOS_SEED_DEMO: 'false',
  SOCIAL_COSMOS_UPLOAD_DIR: uploadPath,
  PERSONA_APP_BASE_URL: apiBase,
}

function run(command, args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', rejectRun)
    child.on('exit', (code, signal) => {
      if (code === 0) resolveRun({ stdout, stderr })
      else rejectRun(new Error(`${command} ${args.join(' ')} exited with ${code ?? signal}\n${stdout}${stderr}`))
    })
  })
}

async function stop(child) {
  if (!child || child.exitCode !== null) return
  const exited = new Promise((resolveExit) => child.once('exit', resolveExit))
  child.kill('SIGTERM')
  await Promise.race([exited, delay(2000)])
  if (child.exitCode === null) child.kill('SIGKILL')
}

let api
try {
  const migration = await run(pythonCommand, ['-m', 'alembic', '-c', 'backend/alembic.ini', 'upgrade', 'head'])
  process.stdout.write(migration.stdout)

  const seed = await run(process.execPath, ['scripts/persona/seed.mjs'])
  process.stdout.write(seed.stdout)

  const openVikingDryRun = await run(process.execPath, ['scripts/persona/openviking-seed.mjs', '--dry-run'])
  process.stdout.write(openVikingDryRun.stdout)
  if (!openVikingDryRun.stdout.includes('"units":53')) {
    throw new Error(`Expected 53 Persona OpenViking units. ${openVikingDryRun.stdout}`)
  }

  api = spawn(
    pythonCommand,
    ['-m', 'uvicorn', 'app.main:app', '--app-dir', 'backend', '--host', '127.0.0.1', '--port', String(port)],
    { cwd: projectRoot, env: environment, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  let apiError = ''
  api.stderr.on('data', (chunk) => { apiError += chunk })

  let health
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${apiBase}/health`)
      if (response.ok) {
        health = await response.json()
        break
      }
    } catch {
      await delay(200)
    }
  }
  if (!health) throw new Error(`Persona check FastAPI did not become healthy. ${apiError}`)
  if (health.database !== 'sqlite') throw new Error(`Expected temporary SQLite API, received ${health.database}`)

  const replay = await run(process.execPath, [
    'scripts/persona/replay.mjs',
    '--limit=2',
    '--commit',
    `--report=${reportPath}`,
  ])
  process.stdout.write(replay.stdout)
  const report = JSON.parse(await readFile(reportPath, 'utf8'))
  if (report.summary?.committed !== 2) {
    throw new Error(`Expected two committed replay items, received ${JSON.stringify(report.summary)}`)
  }

  const memoryIds = new Set()
  for (const index of [1, 2]) {
    const email = `persona.hk.${String(index).padStart(3, '0')}@socialcosmos.local`
    const response = await fetch(`${apiBase}/auth/signin`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: process.env.PERSONA_DEV_PASSWORD || 'Persona2026!' }),
    })
    if (!response.ok) throw new Error(`Post-replay sign-in failed for ${email}: ${response.status}`)
    const cosmos = await response.json()
    if (cosmos.memories.length !== 1) throw new Error(`${email} expected one memory, received ${cosmos.memories.length}`)
    if (cosmos.timeline.length !== 1) throw new Error(`${email} expected one timeline item, received ${cosmos.timeline.length}`)
    if (cosmos.relationships.length === 0) throw new Error(`${email} expected seeded relationships`)
    memoryIds.add(cosmos.memories[0].id)
  }
  if (memoryIds.size !== 2) throw new Error('Persona users did not receive isolated memory IDs')
  console.log('[persona] FastAPI integration check passed: migrate -> seed -> analyze -> confirm/save -> timeline')
} finally {
  await stop(api)
  await rm(temporaryDirectory, { recursive: true, force: true })
}
