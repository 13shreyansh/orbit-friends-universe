import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { parseArgs } from './lib.mjs'
import { validateFixtureDirectory } from './validation.mjs'

const args = parseArgs(process.argv.slice(2))
const projectRoot = resolve(import.meta.dirname, '../..')
const directory = resolve(projectRoot, args.get('input', 'test/persona/generated/hk-5'))

function runPythonSeed() {
  const pythonCommand = process.env.PYTHON_COMMAND || (process.platform === 'win32' ? 'python' : 'python3')
  const pythonArgs = ['-m', 'app.devtools.persona_seed', '--input', directory]
  if (args.has('dry-run')) pythonArgs.push('--dry-run')
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(pythonCommand, pythonArgs, {
      cwd: resolve(projectRoot, 'backend'),
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
      stdio: 'inherit',
    })
    child.on('error', rejectRun)
    child.on('exit', (code, signal) => {
      if (signal) rejectRun(new Error(`Persona Python seed stopped by ${signal}`))
      else if (code === 0) resolveRun()
      else rejectRun(new Error(`Persona Python seed exited with ${code}`))
    })
  })
}

async function main() {
  if (process.env.NODE_ENV === 'production' || process.env.APP_ENV === 'production') {
    throw new Error('Persona seed is disabled in production')
  }
  const validation = await validateFixtureDirectory(directory)
  if (!validation.ok) throw new Error(`Fixture validation failed:\n${validation.errors.join('\n')}`)
  for (const warning of validation.warnings) console.warn(`[persona] warning: ${warning}`)
  await runPythonSeed()
  if (args.has('dry-run')) console.log(`[persona] dry run validated ${validation.cohortId} through FastAPI application services without committing`)
  else console.log(`[persona] seeded ${validation.counts.profiles} users from ${validation.cohortId} through FastAPI application services`)
}

main().catch((error) => {
  console.error(`[persona] seed failed: ${error.message}`)
  process.exitCode = 1
})
