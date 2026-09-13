import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

export const projectRoot = resolve(import.meta.dirname, '../..')

export function composeArgs() {
  const envFile = existsSync(resolve(projectRoot, '.env.production')) ? '.env.production' : '/dev/null'
  return ['compose', '--env-file', envFile, '--profile', 'agent-memory']
}

export function run(command, args, { capture = false, allowFailure = false } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    })
    let stdout = ''
    let stderr = ''
    if (capture) {
      child.stdout.on('data', (chunk) => { stdout += chunk })
      child.stderr.on('data', (chunk) => { stderr += chunk })
    }
    child.on('error', rejectPromise)
    child.on('exit', (code) => {
      if (code === 0 || allowFailure) resolvePromise({ code: code ?? 1, stdout, stderr })
      else rejectPromise(new Error(`${command} ${args.join(' ')} exited with ${code}${capture ? `\n${stderr}` : ''}`))
    })
  })
}

export function check(name, pass, detail) {
  return { name, pass: Boolean(pass), detail }
}

export function printReport(report) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  for (const drill of report.drills) {
    const failed = drill.checks.filter((item) => !item.pass)
    if (failed.length > 0) {
      process.stdout.write(`[drill] ${drill.drill} FAILED:\n${failed.map((item) => `  - ${item.name}: ${item.detail}`).join('\n')}\n`)
    }
  }
  process.stdout.write(`[drill] overall: ${report.pass ? 'passed' : 'FAILED'}\n`)
  if (!report.pass) process.exitCode = 1
}
