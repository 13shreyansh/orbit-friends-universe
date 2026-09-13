import { resolve } from 'node:path'
import { parseArgs, readJson, writeJson } from './lib.mjs'
import { personaOpenVikingConfig, recallOpenViking } from './openviking-client.mjs'
import { validateFixtureDirectory } from './validation.mjs'

const args = parseArgs(process.argv.slice(2))
const projectRoot = resolve(import.meta.dirname, '../..')
const directory = resolve(projectRoot, args.get('input', 'test/persona/generated/hk-5'))
const reportPath = resolve(args.get('report', '/tmp/social-cosmos-persona-recall-baseline.json'))
const topK = Number(args.get('top-k', process.env.AGENT_MEMORY_RECALL_TOP_K || '5'))
const limit = Number(args.get('limit', '0'))
const coverageThreshold = Number(args.get('coverage-threshold', '0.25'))
const allowUnapproved = args.has('allow-unapproved')
const minHitAtK = Number(args.get('min-hit-at-k', '0.90'))
const minTypeHitAtK = Number(args.get('min-type-hit-at-k', '0.80'))
const maxEmptyRecallRate = Number(args.get('max-empty-recall-rate', '0'))
const maxWrongScopeObjectRate = Number(args.get('max-wrong-scope-object-rate', '0'))
const maxCrossUserProbeLeakageRate = Number(args.get('max-cross-user-probe-leakage-rate', '0'))

function textTokens(value) {
  const normalized = String(value || '').normalize('NFKC').toLowerCase()
  const tokens = new Set(normalized.match(/[a-z0-9]{2,}/g) || [])
  for (const sequence of normalized.match(/[\p{Script=Han}]+/gu) || []) {
    const characters = [...sequence]
    if (characters.length === 1) tokens.add(characters[0])
    for (let index = 0; index < characters.length - 1; index += 1) {
      tokens.add(characters.slice(index, index + 2).join(''))
    }
  }
  return tokens
}

function coverage(expected, actual) {
  const expectedTokens = textTokens(expected)
  if (expectedTokens.size === 0) return 0
  const actualTokens = textTokens(actual)
  let matched = 0
  for (const token of expectedTokens) if (actualTokens.has(token)) matched += 1
  return matched / expectedTokens.size
}

function collectText(value, output = []) {
  if (typeof value === 'string') output.push(value)
  else if (Array.isArray(value)) value.forEach((item) => collectText(item, output))
  else if (value && typeof value === 'object') Object.values(value).forEach((item) => collectText(item, output))
  return output
}

function rate(count, total) {
  return total > 0 ? Number((count / total).toFixed(4)) : 0
}

function summarize(items) {
  return {
    queries: items.length,
    hitAtK: rate(items.filter((item) => item.hit).length, items.length),
    emptyRecallRate: rate(items.filter((item) => item.recalled === 0).length, items.length),
    averageMaxCoverage: items.length > 0
      ? Number((items.reduce((total, item) => total + item.maxCoverage, 0) / items.length).toFixed(4))
      : 0,
  }
}

function evaluateGate(summary) {
  const checks = [
    { name: 'allQueriesCompleted', pass: summary.completedQueries === summary.expectedQueries, detail: `${summary.completedQueries}/${summary.expectedQueries} completed` },
    { name: 'noFailedQueries', pass: summary.failedQueries === 0, detail: `failedQueries=${summary.failedQueries}` },
    { name: 'overallHitAtK', pass: summary.hitAtK >= minHitAtK, detail: `hitAtK=${summary.hitAtK} (min ${minHitAtK})` },
    { name: 'emptyRecallRate', pass: summary.emptyRecallRate <= maxEmptyRecallRate, detail: `emptyRecallRate=${summary.emptyRecallRate} (max ${maxEmptyRecallRate})` },
    { name: 'wrongScopeObjectRate', pass: summary.wrongScopeObjectRate <= maxWrongScopeObjectRate, detail: `wrongScopeObjectRate=${summary.wrongScopeObjectRate} (max ${maxWrongScopeObjectRate})` },
    { name: 'crossUserProbeLeakageRate', pass: summary.crossUserProbeLeakageRate <= maxCrossUserProbeLeakageRate, detail: `crossUserProbeLeakageRate=${summary.crossUserProbeLeakageRate} (max ${maxCrossUserProbeLeakageRate})` },
  ]
  for (const [memoryType, typeSummary] of Object.entries(summary.byMemoryType)) {
    checks.push({
      name: `hitAtK:${memoryType}`,
      pass: typeSummary.hitAtK >= minTypeHitAtK,
      detail: `${memoryType} hitAtK=${typeSummary.hitAtK} (min ${minTypeHitAtK})`,
    })
  }
  return { pass: checks.every((check) => check.pass), checks }
}

async function main() {
  if (!Number.isInteger(topK) || topK < 1) throw new Error('--top-k must be a positive integer')
  if (!Number.isFinite(coverageThreshold) || coverageThreshold < 0 || coverageThreshold > 1) {
    throw new Error('--coverage-threshold must be between 0 and 1')
  }
  const validation = await validateFixtureDirectory(directory)
  if (!validation.ok) throw new Error(`Fixture validation failed:\n${validation.errors.join('\n')}`)
  const manifestDocument = await readJson(resolve(directory, 'manifest.json'))
  const manifestApproved = manifestDocument.review?.status === 'product-owner-review-complete'
    && manifestDocument.review?.agentMemoryApproval === 'approved'
  if (!manifestApproved && !allowUnapproved) {
    throw new Error(
      `Fixture manifest is not approved for recall gating (review.status=${manifestDocument.review?.status ?? 'missing'}, `
      + `agentMemoryApproval=${manifestDocument.review?.agentMemoryApproval ?? 'missing'}). `
      + 'Pass --allow-unapproved to bypass during development.',
    )
  }
  const expectedDocument = await readJson(resolve(directory, 'expected-agent-memory.json'))
  const profileDocument = await readJson(resolve(directory, 'profiles.json'))
  const config = personaOpenVikingConfig(expectedDocument.cohortId)
  const allItems = expectedDocument.items.filter((item) => item.reviewStatus !== 'rejected')
  const items = limit > 0 ? allItems.slice(0, limit) : allItems
  const userIds = profileDocument.profiles.map((profile) => profile.id)
  const results = []

  for (const [index, item] of items.entries()) {
    const probeUserId = userIds[(userIds.indexOf(item.userId) + 1) % userIds.length]
    process.stdout.write(`[persona-recall] ${index + 1}/${items.length}: ${item.id}\n`)
    try {
      const [memories, probeMemories] = await Promise.all([
        recallOpenViking(config, item.userId, item.statement, topK),
        recallOpenViking(config, probeUserId, item.statement, topK),
      ])
      const scored = memories.map((memory) => ({
        objectKey: String(memory.uri || memory.id || ''),
        score: Number(memory.score || 0),
        coverage: coverage(item.statement, collectText(memory).join(' ')),
      }))
      const ownerPrefix = `viking://user/${item.userId}/memories/`
      const currentPrefix = `viking://user/${probeUserId}/memories/`
      results.push({
        expectedId: item.id,
        userId: item.userId,
        memoryType: item.memoryType,
        reviewStatus: item.reviewStatus,
        status: 'completed',
        recalled: scored.length,
        hit: scored.some((memory) => memory.coverage >= coverageThreshold),
        maxCoverage: Number(Math.max(0, ...scored.map((memory) => memory.coverage)).toFixed(4)),
        topScore: Number(Math.max(0, ...scored.map((memory) => memory.score)).toFixed(4)),
        wrongScopeObjects: scored.filter((memory) => !memory.objectKey.startsWith(ownerPrefix)).length,
        probeUserId,
        ownerObjectsInProbe: probeMemories.filter((memory) => {
          const key = String(memory.uri || memory.id || '')
          return key.startsWith(ownerPrefix) || !key.startsWith(currentPrefix)
        }).length,
      })
    } catch (error) {
      results.push({
        expectedId: item.id,
        userId: item.userId,
        memoryType: item.memoryType,
        reviewStatus: item.reviewStatus,
        status: 'failed',
        errorType: error.name || 'Error',
        error: error.message,
      })
    }
  }

  const completed = results.filter((item) => item.status === 'completed')
  const memoryTypes = [...new Set(completed.map((item) => item.memoryType))]
  const report = {
    schemaVersion: 1,
    cohortId: expectedDocument.cohortId,
    measuredAt: new Date().toISOString(),
    provider: 'openviking',
    baseUrl: config.baseUrl,
    account: config.account,
    topK,
    coverageThreshold,
    manifest: {
      reviewStatus: manifestDocument.review?.status ?? null,
      agentMemoryApproval: manifestDocument.review?.agentMemoryApproval ?? null,
      approved: manifestApproved,
    },
    summary: {
      expectedQueries: results.length,
      completedQueries: completed.length,
      failedQueries: results.length - completed.length,
      hitAtK: rate(completed.filter((item) => item.hit).length, completed.length),
      emptyRecallRate: rate(completed.filter((item) => item.recalled === 0).length, completed.length),
      wrongScopeObjectRate: rate(
        completed.reduce((total, item) => total + item.wrongScopeObjects, 0),
        completed.reduce((total, item) => total + item.recalled, 0),
      ),
      crossUserProbeLeakageRate: rate(
        completed.filter((item) => item.ownerObjectsInProbe > 0).length,
        completed.length,
      ),
      byMemoryType: Object.fromEntries(
        memoryTypes.map((memoryType) => [
          memoryType,
          summarize(completed.filter((item) => item.memoryType === memoryType)),
        ]),
      ),
    },
    results,
  }
  report.gate = evaluateGate(report.summary)
  await writeJson(reportPath, report)
  process.stdout.write(`[persona-recall] report: ${reportPath}\n`)
  process.stdout.write(`[persona-recall] summary: ${JSON.stringify(report.summary)}\n`)
  process.stdout.write(`[persona-recall] manifest: ${JSON.stringify(report.manifest)}\n`)
  if (!report.gate.pass) {
    const failed = report.gate.checks.filter((check) => !check.pass)
    process.stdout.write(`[persona-recall] gate FAILED:\n${failed.map((check) => `  - ${check.name}: ${check.detail}`).join('\n')}\n`)
    process.exitCode = 1
  } else {
    process.stdout.write('[persona-recall] gate passed\n')
  }
  if (report.summary.failedQueries > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(`[persona-recall] failed: ${error.message}`)
  process.exitCode = 1
})
