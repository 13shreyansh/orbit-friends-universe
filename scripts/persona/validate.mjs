import { resolve } from 'node:path'
import { parseArgs } from './lib.mjs'
import { validateFixtureDirectory } from './validation.mjs'

const args = parseArgs(process.argv.slice(2))
const projectRoot = resolve(import.meta.dirname, '../..')
const directory = resolve(projectRoot, args.get('input', 'test/persona/generated/hk-5'))

validateFixtureDirectory(directory)
  .then((result) => {
    for (const warning of result.warnings) console.warn(`[persona] warning: ${warning}`)
    if (!result.ok) {
      for (const error of result.errors) console.error(`[persona] error: ${error}`)
      process.exitCode = 1
      return
    }
    console.log(`[persona] ${result.cohortId} is valid`)
    console.log(`[persona] ${result.counts.profiles} profiles, ${result.counts.relationships} relationships, ${result.counts.scenarios} scenarios, ${result.counts.expectedAgentMemories} Agent Memory candidates`)
  })
  .catch((error) => {
    console.error(`[persona] validation failed: ${error.message}`)
    process.exitCode = 1
  })
