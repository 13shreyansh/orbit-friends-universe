import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync } from 'node:fs'
import { parseArgs } from '../persona/lib.mjs'
import {
  commitOpenVikingDocument,
  openVikingApiKey,
  recallOpenViking,
} from '../persona/openviking-client.mjs'
import { check, composeArgs, printReport, run } from './lib.mjs'

const args = parseArgs(process.argv.slice(2))
const only = args.get('only', 'all')
const baseUrl = (process.env.PERSONA_OPENVIKING_URL || `http://127.0.0.1:${process.env.OPENVIKING_PORT || '1933'}`).replace(/\/$/, '')
const volumeName = args.get('volume', 'social-cosmos_openviking-data')
const backupDir = args.get('backup-dir', '/tmp/social-cosmos-drills')
const readyTimeoutMs = Number(args.get('ready-timeout-ms', '120000'))

const config = {
  baseUrl,
  account: 'social-cosmos-drill',
  apiKey: openVikingApiKey(baseUrl),
  timeoutMs: Number(process.env.PERSONA_RECALL_TIMEOUT_MS || '60000'),
}
const DRILL_USER = 'drill-restart-user'
const MARKER = 'OVDRILL-RESTART-MARKER-7Q4Z'

async function waitForReady(timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const health = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(3000) }).then((r) => r.json())
      const ready = await fetch(`${baseUrl}/ready`, { signal: AbortSignal.timeout(3000) })
      if (health.healthy && ready.ok) return true
    } catch {
      // service still restarting
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 2000))
  }
  return false
}

async function markerRecallHit() {
  const memories = await recallOpenViking(config, DRILL_USER, MARKER, 5)
  return memories.some((memory) => JSON.stringify(memory).includes(MARKER))
}

async function restartDrill() {
  const checks = []
  const committed = await commitOpenVikingDocument(config, {
    id: 'drill:openviking:restart',
    kind: 'drill',
    userId: DRILL_USER,
    sessionKey: 'drill:openviking:restart:v1',
    dedupeKey: 'drill:openviking:restart:v1',
    content: `這是故障演練標記文檔。唯一標記 token 是 ${MARKER}。它用於驗證 OpenViking 重啟後既有記憶仍可召回。`,
  }, { taskTimeoutMs: 900000 })
  checks.push(check('markerCommitted', committed.status === 'completed', `status=${committed.status}`))
  checks.push(check('recallBeforeRestart', await markerRecallHit(), `query=${MARKER}`))
  await run('docker', [...composeArgs(), 'restart', 'openviking'])
  const ready = await waitForReady(readyTimeoutMs)
  checks.push(check('readyAfterRestart', ready, `health/ready ok within ${readyTimeoutMs}ms`))
  checks.push(check('recallAfterRestart', ready && await markerRecallHit(), `query=${MARKER}`))
  return { drill: 'openviking-restart', pass: checks.every((item) => item.pass), checks }
}

async function backupDrill() {
  const checks = []
  const stamp = args.get('stamp', String(process.pid))
  const archive = `openviking-data-${stamp}.tar.gz`
  const scratchVolume = `social-cosmos-drill-restore-${stamp}`
  mkdirSync(backupDir, { recursive: true })
  await run('docker', ['run', '--rm', '-v', `${volumeName}:/source:ro`, '-v', `${backupDir}:/backup`, 'alpine', 'tar', 'czf', `/backup/${archive}`, '-C', '/source', '.'])
  const digest = createHash('sha256').update(readFileSync(`${backupDir}/${archive}`)).digest('hex')
  checks.push(check('backupCreated', true, `${backupDir}/${archive} sha256=${digest}`))
  const listing = await run('docker', ['run', '--rm', '-v', `${backupDir}:/backup:ro`, 'alpine', 'tar', 'tzf', `/backup/${archive}`], { capture: true })
  const archivedFiles = listing.stdout.split('\n').filter((entry) => entry && !entry.endsWith('/')).length
  checks.push(check('archiveIntegrity', archivedFiles > 0, `${archivedFiles} files listed with valid gzip stream`))
  try {
    await run('docker', ['volume', 'create', scratchVolume], { capture: true })
    await run('docker', ['run', '--rm', '-v', `${scratchVolume}:/target`, '-v', `${backupDir}:/backup:ro`, 'alpine', 'tar', 'xzf', `/backup/${archive}`, '-C', '/target'])
    const restored = await run('docker', ['run', '--rm', '-v', `${scratchVolume}:/target:ro`, 'alpine', 'sh', '-c', 'find /target -type f | wc -l'], { capture: true })
    const restoredFiles = Number(restored.stdout.trim())
    checks.push(check('restoreIntoScratchVolume', restoredFiles === archivedFiles, `restored=${restoredFiles} archived=${archivedFiles}`))
  } finally {
    await run('docker', ['volume', 'rm', scratchVolume], { capture: true, allowFailure: true })
  }
  return { drill: 'openviking-backup-restore', pass: checks.every((item) => item.pass), checks }
}

async function main() {
  if (!config.apiKey) throw new Error('OPENVIKING_API_KEY or OPENVIKING_AI_API_KEY is required')
  const drills = []
  if (only === 'all' || only === 'backup') drills.push(await backupDrill())
  if (only === 'all' || only === 'restart') drills.push(await restartDrill())
  printReport({
    schemaVersion: 1,
    provider: 'openviking',
    baseUrl,
    pass: drills.every((drill) => drill.pass),
    drills,
  })
}

main().catch((error) => {
  console.error(`[drill] openviking drill failed: ${error.message}`)
  process.exitCode = 1
})
