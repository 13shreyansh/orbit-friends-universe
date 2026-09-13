import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const rawArguments = process.argv.slice(2)
const cwdArgument = rawArguments.find((argument) => argument.startsWith('--cwd='))
const argumentsForPython = rawArguments.filter((argument) => argument !== cwdArgument)
const workingDirectory = cwdArgument ? resolve(process.cwd(), cwdArgument.slice('--cwd='.length)) : process.cwd()
const pythonCommand = process.env.PYTHON_COMMAND || (process.platform === 'win32' ? 'python' : 'python3')
const child = spawn(pythonCommand, argumentsForPython, {
  cwd: workingDirectory,
  env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
  stdio: 'inherit',
})

child.on('error', (error) => {
  console.error(`[python] failed to start ${pythonCommand}: ${error.message}`)
  process.exitCode = 1
})

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exitCode = code ?? 1
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal))
}
