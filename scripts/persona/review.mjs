import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseArgs, readJson, readJsonl, sha256, writeJson, writeJsonl } from './lib.mjs'
import { validateFixtureDirectory } from './validation.mjs'

const args = parseArgs(process.argv.slice(2))
const projectRoot = resolve(import.meta.dirname, '../..')
const directory = resolve(projectRoot, args.get('input', 'test/persona/generated/hk-5'))

function correctStrings(value, applied, textCorrections) {
  if (typeof value === 'string') {
    let result = value
    for (const [from, to, reason] of textCorrections) {
      const matches = result.split(from).length - 1
      if (matches > 0) {
        result = result.replaceAll(from, to)
        applied.push({ from, to, reason, replacements: matches })
      }
    }
    return result
  }
  if (Array.isArray(value)) return value.map((item) => correctStrings(item, applied, textCorrections))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, correctStrings(item, applied, textCorrections)]))
  }
  return value
}

async function main() {
  const profilesDocument = await readJson(resolve(directory, 'profiles.json'))
  const relationshipsDocument = await readJson(resolve(directory, 'relationships.json'))
  const scenarios = await readJsonl(resolve(directory, 'scenarios.jsonl'))
  const agentMemoryDocument = await readJson(resolve(directory, 'expected-agent-memory.json'))
  const manifest = await readJson(resolve(directory, 'manifest.json'))
  const reviewPatch = await readJson(resolve(directory, 'review-patch.json'))
  if (reviewPatch.schemaVersion !== 1 || reviewPatch.cohortId !== manifest.cohortId) {
    throw new Error('review-patch.json must use schemaVersion 1 and match the fixture cohortId')
  }
  if (!Array.isArray(reviewPatch.textCorrections)) throw new Error('review-patch.json must contain textCorrections[]')
  for (const correction of reviewPatch.textCorrections) {
    if (![correction.from, correction.to, correction.reason].every((value) => typeof value === 'string' && value.trim())) {
      throw new Error('Every review text correction needs non-empty from, to, and reason fields')
    }
  }
  const textCorrections = reviewPatch.textCorrections.map(({ from, to, reason }) => [from, to, reason])
  const applied = []

  for (const profile of profilesDocument.profiles) {
    const suffix = ` ${profile.planet.archetype}`
    if (profile.planet.name.endsWith(suffix)) {
      const previous = profile.planet.name
      profile.planet.name = profile.planet.name.slice(0, -suffix.length)
      applied.push({
        from: previous,
        to: profile.planet.name,
        reason: 'Removed the model archetype token from the user-facing planet name',
        replacements: 1,
      })
    }
  }

  const correctedRelationships = correctStrings(relationshipsDocument, applied, textCorrections)
  const correctedScenarios = correctStrings(scenarios, applied, textCorrections)
  const correctedAgentMemories = correctStrings(agentMemoryDocument, applied, textCorrections)

  await writeJson(resolve(directory, 'profiles.json'), profilesDocument)
  await writeJson(resolve(directory, 'relationships.json'), correctedRelationships)
  await writeJsonl(resolve(directory, 'scenarios.jsonl'), correctedScenarios)
  await writeJson(resolve(directory, 'expected-agent-memory.json'), correctedAgentMemories)

  const consolidated = new Map()
  for (const correction of applied) {
    const key = `${correction.from}\u0000${correction.to}\u0000${correction.reason}`
    const previous = consolidated.get(key)
    if (previous) previous.replacements += correction.replacements
    else consolidated.set(key, { ...correction })
  }
  const corrections = [...consolidated.values()]
  const outputFiles = ['profiles.json', 'relationships.json', 'scenarios.jsonl', 'expected-agent-memory.json']
  for (const file of outputFiles) manifest.outputHashes[file] = sha256(await readFile(resolve(directory, file), 'utf8'))
  const previousCorrections = manifest.review?.corrections || []
  manifest.review = {
    status: 'automated-review-complete',
    reviewedAt: new Date().toISOString(),
    corrections: corrections.length > 0 ? corrections : previousCorrections,
    agentMemoryApproval: 'pending',
  }
  await writeJson(resolve(directory, 'manifest.json'), manifest)

  const validation = await validateFixtureDirectory(directory)
  if (!validation.ok) throw new Error(`Reviewed fixture is invalid:\n${validation.errors.join('\n')}`)
  for (const warning of validation.warnings) console.warn(`[persona] warning: ${warning}`)
  console.log(`[persona] applied ${corrections.reduce((sum, item) => sum + item.replacements, 0)} replacements from ${textCorrections.length} cohort review rules`)
  console.log('[persona] Agent Memory candidates remain pending for product-owner approval')
}

main().catch((error) => {
  console.error(`[persona] review failed: ${error.message}`)
  process.exitCode = 1
})
