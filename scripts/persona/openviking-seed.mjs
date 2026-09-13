import { resolve } from 'node:path'
import { parseArgs, readJson, readJsonl, writeJson } from './lib.mjs'
import { commitOpenVikingDocument, personaOpenVikingConfig } from './openviking-client.mjs'
import { validateFixtureDirectory } from './validation.mjs'

const args = parseArgs(process.argv.slice(2))
const projectRoot = resolve(import.meta.dirname, '../..')
const directory = resolve(projectRoot, args.get('input', 'test/persona/generated/hk-5'))
const reportPath = resolve(args.get('report', '/tmp/social-cosmos-persona-openviking-seed.json'))
const limit = Number(args.get('limit', '0'))
const concurrency = Number(args.get('concurrency', '1'))

function percentile(values, percent) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.max(0, Math.ceil(sorted.length * percent) - 1)]
}

function profileNarrative(profile) {
  const person = profile.profile
  const lines = [
    `我叫${person.displayName}，年齡層${person.ageBand}，主要語言是${(person.languages || []).join('和')}。`,
    `我的職業是${person.occupation}。${person.bio}`,
    `我的溝通偏好：${person.communicationStyle}`,
    `我的興趣包括${(person.interests || []).join('、')}。`,
    `可以形容我的標籤：${(person.tags || []).join('、')}。`,
  ]
  if (profile.planet) {
    lines.push(`我的個人星球叫「${profile.planet.name}」，座右銘是「${profile.planet.motto}」。`)
  }
  return lines.join('\n')
}

function profileUnit(cohortId, profile) {
  const sessionKey = `persona:${cohortId}:profile:${profile.id}:v2`
  return {
    id: `profile:${profile.id}`,
    kind: 'profile',
    userId: profile.id,
    sessionKey,
    dedupeKey: sessionKey,
    content: profileNarrative(profile),
  }
}

function scenarioUnits(cohortId, scenarios, relationships, profileById) {
  const relationshipById = new Map(relationships.map((relationship) => [relationship.id, relationship]))
  return scenarios.flatMap((scenario) => scenario.inputs.map((input) => {
    const relationship = relationshipById.get(scenario.relationshipId)
    const perspective = relationship.perspectives.find((item) => item.ownerUserId === input.userId)
    const targetId = scenario.participantIds.find((item) => item !== input.userId)
    const target = profileById.get(targetId)
    const sessionKey = `persona:${cohortId}:scenario:${scenario.id}:${input.userId}:v1`
    return {
      id: `scenario:${scenario.id}:${input.userId}`,
      kind: 'scenario',
      userId: input.userId,
      sessionKey,
      dedupeKey: sessionKey,
      content: {
        schemaVersion: 1,
        source: 'persona_evaluation_fixture',
        cohortId,
        ownerUserId: input.userId,
        memory: {
          id: `memory-${input.userId}-${scenario.id}`,
          sourceType: 'text',
          rawText: input.text,
          people: [{
            id: targetId,
            name: target.profile.displayName,
            isExisting: true,
            relationType: perspective.relationType,
            identityLabel: perspective.identityLabel,
            relationshipDescription: perspective.description,
          }],
          eventTime: scenario.eventDate,
          location: scenario.location,
          eventType: scenario.eventType,
          summary: scenario.expectedBusinessMemory.summary,
          facts: scenario.expectedBusinessMemory.facts,
          emotions: scenario.expectedBusinessMemory.emotions,
          relationshipSignals: {
            relationshipChange: scenario.expectedBusinessMemory.relationshipChange,
          },
          keywords: [scenario.eventType, perspective.relationType],
          narrative: scenario.sharedEvent,
          confidence: 1,
          analysisProvider: 'persona-reviewed-fixture',
        },
      },
    }
  }))
}

async function main() {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 10) {
    throw new Error('--concurrency must be an integer between 1 and 10')
  }
  if (process.env.NODE_ENV === 'production' || process.env.APP_ENV === 'production') {
    throw new Error('Persona OpenViking seed is disabled in production')
  }
  const validation = await validateFixtureDirectory(directory)
  if (!validation.ok) throw new Error(`Fixture validation failed:\n${validation.errors.join('\n')}`)
  const profileDocument = await readJson(resolve(directory, 'profiles.json'))
  const relationshipDocument = await readJson(resolve(directory, 'relationships.json'))
  const scenarios = await readJsonl(resolve(directory, 'scenarios.jsonl'))
  const profileById = new Map(profileDocument.profiles.map((profile) => [profile.id, profile]))
  const allUnits = [
    ...profileDocument.profiles.map((profile) => profileUnit(validation.cohortId, profile)),
    ...(
      args.has('profiles-only')
        ? []
        : scenarioUnits(
            validation.cohortId,
            scenarios,
            relationshipDocument.relationships,
            profileById,
          )
    ),
  ]
  const units = limit > 0 ? allUnits.slice(0, limit) : allUnits
  const config = personaOpenVikingConfig(validation.cohortId, { requireApiKey: !args.has('dry-run') })
  if (args.has('dry-run')) {
    const summary = {
      cohortId: validation.cohortId,
      account: config.account,
      units: units.length,
      profiles: units.filter((unit) => unit.kind === 'profile').length,
      scenarios: units.filter((unit) => unit.kind === 'scenario').length,
    }
    process.stdout.write(`[persona-openviking] dry run: ${JSON.stringify(summary)}\n`)
    return
  }

  const results = new Array(units.length)
  let cursor = 0
  async function worker() {
    while (cursor < units.length) {
      const index = cursor
      cursor += 1
      const unit = units[index]
      process.stdout.write(`[persona-openviking] ${index + 1}/${units.length}: ${unit.id}\n`)
      const startedAt = Date.now()
      try {
        const committed = await commitOpenVikingDocument(config, unit, {
          pollIntervalMs: Number(process.env.PERSONA_OPENVIKING_POLL_MS || '2000'),
          taskTimeoutMs: Number(process.env.PERSONA_OPENVIKING_TASK_TIMEOUT_MS || '900000'),
        })
        results[index] = {
          id: unit.id,
          kind: unit.kind,
          userId: unit.userId,
          status: committed.status,
          taskId: committed.taskId,
          latencyMs: Date.now() - startedAt,
        }
      } catch (error) {
        results[index] = {
          id: unit.id,
          kind: unit.kind,
          userId: unit.userId,
          status: 'failed',
          errorType: error.name || 'Error',
          error: error.message,
          latencyMs: Date.now() - startedAt,
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, units.length) }, () => worker()))
  const report = {
    schemaVersion: 1,
    cohortId: validation.cohortId,
    seededAt: new Date().toISOString(),
    provider: 'openviking',
    baseUrl: config.baseUrl,
    account: config.account,
    summary: {
      units: results.length,
      completed: results.filter((item) => item.status === 'completed').length,
      failed: results.filter((item) => item.status === 'failed').length,
      profiles: results.filter((item) => item.kind === 'profile').length,
      scenarios: results.filter((item) => item.kind === 'scenario').length,
      latencyMs: {
        p50: percentile(results.map((item) => item.latencyMs), 0.5),
        p95: percentile(results.map((item) => item.latencyMs), 0.95),
        max: Math.max(0, ...results.map((item) => item.latencyMs)),
      },
    },
    results,
  }
  await writeJson(reportPath, report)
  process.stdout.write(`[persona-openviking] report: ${reportPath}\n`)
  process.stdout.write(`[persona-openviking] summary: ${JSON.stringify(report.summary)}\n`)
  if (report.summary.failed > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(`[persona-openviking] failed: ${error.message}`)
  process.exitCode = 1
})
