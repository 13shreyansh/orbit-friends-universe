import { parseArgs } from '../persona/lib.mjs'
import { composeArgs, run } from './lib.mjs'

const args = parseArgs(process.argv.slice(2))
const drill = args.get('drill', 'all')
const extra = []
if (args.has('skip-recall')) extra.push('--skip-recall')
if (args.has('deadline-seconds')) extra.push('--deadline-seconds', args.get('deadline-seconds'))

async function workerIsRunning() {
  const { stdout } = await run('docker', [...composeArgs(), 'ps', '--status', 'running', '--format', '{{.Service}}'], {
    capture: true,
    allowFailure: true,
  })
  return stdout.split('\n').includes('agent-memory-worker')
}

async function main() {
  const restartWorker = await workerIsRunning()
  if (restartWorker) {
    process.stdout.write('[drill] stopping agent-memory-worker for the drill window\n')
    await run('docker', [...composeArgs(), 'stop', 'agent-memory-worker'])
  }
  try {
    // Keep the drill module in sync with the repo even when the deployed image predates it.
    await run('docker', [...composeArgs(), 'cp', 'backend/app/agent_memory_drill.py', 'api:/app/backend/app/agent_memory_drill.py'])
    const { code } = await run(
      'docker',
      [...composeArgs(), 'exec', '-T', '-w', '/app/backend', 'api', 'python', '-m', 'app.agent_memory_drill', '--drill', drill, ...extra],
      { allowFailure: true },
    )
    process.exitCode = code
  } finally {
    if (restartWorker) {
      process.stdout.write('[drill] restarting agent-memory-worker\n')
      await run('docker', [...composeArgs(), 'start', 'agent-memory-worker'])
    }
  }
}

main().catch((error) => {
  console.error(`[drill] agent-memory drill failed: ${error.message}`)
  process.exitCode = 1
})
