import { resolve } from 'node:path'
import { parseArgs, readJson, readJsonl, sha256, writeJson } from './lib.mjs'
import { validateFixtureDirectory } from './validation.mjs'

const args = parseArgs(process.argv.slice(2))
const projectRoot = resolve(import.meta.dirname, '../..')
const directory = resolve(projectRoot, args.get('input', 'test/persona/generated/hk-5'))
const reportPath = resolve(projectRoot, args.get('report', 'test/persona/reports/hk-5-replay.json'))
const apiBase = (process.env.PERSONA_APP_BASE_URL || 'http://127.0.0.1:8787/api').replace(/\/$/, '')
const password = process.env.PERSONA_DEV_PASSWORD || 'Persona2026!'
const commit = args.has('commit')
const limit = Number(args.get('limit', '0'))

async function request(path, options = {}, token) {
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
    signal: AbortSignal.timeout(Number(process.env.PERSONA_REPLAY_TIMEOUT_MS || 60000)),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail || body.error || 'unknown error')
    throw new Error(`${options.method || 'GET'} ${path} returned ${response.status}: ${detail}`)
  }
  return body
}

function percentile(values, percent) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.max(0, Math.ceil(sorted.length * percent) - 1)]
}

function confirmedMemory(candidate, scenario, input, targetProfile, perspective) {
  return {
    ...candidate,
    id: `memory-${input.userId}-${scenario.id}`,
    sourceType: 'text',
    rawText: input.text,
    mediaUrl: '',
    people: [{
      id: targetProfile.id,
      name: targetProfile.profile.displayName,
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
      interactionFrequency: candidate.relationshipSignals?.interactionFrequency ?? Math.round(perspective.strength * 80),
      emotionalIntimacy: candidate.relationshipSignals?.emotionalIntimacy ?? Math.round(perspective.strength * 90),
      initiativeBalance: candidate.relationshipSignals?.initiativeBalance ?? 50,
      relationshipChange: scenario.expectedBusinessMemory.relationshipChange,
    },
    keywords: Array.isArray(candidate.keywords) && candidate.keywords.length > 0
      ? candidate.keywords
      : [scenario.eventType, perspective.relationType],
    narrative: candidate.narrative || scenario.sharedEvent,
    confidence: Number(candidate.confidence || 0.8),
  }
}

async function main() {
  const validation = await validateFixtureDirectory(directory)
  if (!validation.ok) throw new Error(`Fixture validation failed:\n${validation.errors.join('\n')}`)
  const { profiles } = await readJson(resolve(directory, 'profiles.json'))
  const { relationships } = await readJson(resolve(directory, 'relationships.json'))
  const scenarios = await readJsonl(resolve(directory, 'scenarios.jsonl'))
  const manifest = await readJson(resolve(directory, 'manifest.json'))
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]))
  const relationshipById = new Map(relationships.map((relationship) => [relationship.id, relationship]))
  const sessions = new Map()

  for (const profile of profiles) {
    const result = await request('/auth/signin', {
      method: 'POST',
      body: JSON.stringify({ email: profile.account.email, password }),
    })
    sessions.set(profile.id, {
      token: result.session.token,
      knownMemoryIds: new Set((result.memories || []).map((memory) => memory.id)),
      relationshipIds: new Map((result.relationships || []).map((relationship) => [relationship.targetUserId, relationship.id])),
    })
  }

  const work = scenarios.flatMap((scenario) => scenario.inputs.map((input) => ({ scenario, input })))
  const selectedWork = limit > 0 ? work.slice(0, limit) : work
  const report = {
    schemaVersion: 1,
    cohortId: validation.cohortId,
    replayedAt: new Date().toISOString(),
    apiVersion: 'fastapi-v1-compat',
    fixtureHash: sha256(JSON.stringify(manifest.outputHashes || {})),
    fixtureGenerator: manifest.generator || {},
    analysisModel: process.env.AI_MODEL || 'local-deterministic',
    mode: commit ? 'analyze-and-commit' : 'analyze-only',
    apiBase,
    results: [],
  }

  for (const [index, item] of selectedWork.entries()) {
    const { scenario, input } = item
    const relationship = relationshipById.get(scenario.relationshipId)
    const perspective = relationship.perspectives.find((candidate) => candidate.ownerUserId === input.userId)
    const targetId = relationship.participantIds.find((id) => id !== input.userId)
    const targetProfile = profileById.get(targetId)
    const session = sessions.get(input.userId)
    console.log(`[persona] replay ${index + 1}/${selectedWork.length}: ${input.userId} ${scenario.id}`)
    const startedAt = Date.now()
    try {
      const relationshipId = session.relationshipIds.get(targetId)
      if (!relationshipId) throw new Error(`No FastAPI relationship found from ${input.userId} to ${targetId}`)
      const candidate = await request('/memories/analyze', {
        method: 'POST',
        body: JSON.stringify({ sourceType: 'text', rawText: input.text }),
      }, session.token)
      const memory = confirmedMemory(candidate, scenario, input, targetProfile, perspective)
      let status = 'analyzed'
      if (commit && !session.knownMemoryIds.has(memory.id)) {
        const result = await request('/memories', {
          method: 'POST',
          body: JSON.stringify({ memory, relationshipId }),
        }, session.token)
        session.knownMemoryIds.add(memory.id)
        for (const stored of result.cosmos?.memories || []) session.knownMemoryIds.add(stored.id)
        status = 'committed'
      } else if (commit) status = 'already-committed'
      report.results.push({
        scenarioId: scenario.id,
        userId: input.userId,
        status,
        latencyMs: Date.now() - startedAt,
        analysisProvider: candidate.analysisProvider || 'unknown',
        analyzedSummary: candidate.summary,
        expectedSummary: scenario.expectedBusinessMemory.summary,
      })
    } catch (error) {
      report.results.push({
        scenarioId: scenario.id,
        userId: input.userId,
        status: 'failed',
        latencyMs: Date.now() - startedAt,
        errorType: error.name || 'Error',
        error: error.message,
      })
    }
  }

  report.summary = report.results.reduce((summary, item) => {
    summary[item.status] = (summary[item.status] || 0) + 1
    return summary
  }, {})
  const latencies = report.results.map((item) => item.latencyMs)
  report.summary.latencyMs = {
    p50: percentile(latencies, 0.5),
    p95: percentile(latencies, 0.95),
  }
  report.summary.analysisProviders = [...new Set(report.results.map((item) => item.analysisProvider).filter(Boolean))]
  await writeJson(reportPath, report)
  console.log(`[persona] replay report: ${reportPath}`)
  if (report.summary.failed) process.exitCode = 1
}

main().catch((error) => {
  console.error(`[persona] replay failed: ${error.message}`)
  process.exitCode = 1
})
