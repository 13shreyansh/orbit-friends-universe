import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { readJson, readJsonl, sha256 } from './lib.mjs'

const relationTypes = new Set(['family', 'friend', 'partner', 'colleague', 'classmate', 'mentor', 'community', 'past', 'other'])
const relationshipStatuses = new Set(['active', 'dormant', 'faded'])
const archetypes = new Set(['terran', 'oceanic', 'volcanic', 'crystalline', 'verdant'])
const eventTypes = new Set(['conversation', 'gathering', 'trip', 'celebration', 'check-in', 'work', 'community', 'milestone'])
const relationshipChanges = new Set(['closer', 'stable', 'distant', 'reconnected', 'conflict'])
const agentMemoryTypes = new Set(['profile', 'preferences', 'identity', 'entities', 'events', 'cases', 'experiences'])
const ageBands = new Set(['18-24', '25-34', '35-44', '45-54', '55-64', '65+'])

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function isIsoDate(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
}

function duplicateValues(values) {
  const seen = new Set()
  const duplicates = new Set()
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value)
    seen.add(value)
  }
  return [...duplicates]
}

function allStrings(values) {
  return Array.isArray(values) && values.length > 0 && values.every(isNonEmptyString)
}

function collectStrings(value, result = []) {
  if (typeof value === 'string') result.push(value)
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, result))
  else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (key !== 'email') collectStrings(item, result)
    }
  }
  return result
}

function referencesChineseName(text, displayName) {
  if (!isNonEmptyString(text) || !isNonEmptyString(displayName)) return false
  const surname = displayName.slice(0, 1)
  const givenName = displayName.slice(1)
  const surnameTitles = ['教授', '老師', '先生', '小姐', '太太', '姐', '哥'].map((title) => `${surname}${title}`)
  return text.includes(displayName)
    || (givenName.length > 0 && text.includes(givenName))
    || surnameTitles.some((title) => text.includes(title))
}

export async function validateFixtureDirectory(directory) {
  const errors = []
  const warnings = []
  const fail = (condition, message) => {
    if (!condition) errors.push(message)
  }
  const warn = (condition, message) => {
    if (!condition) warnings.push(message)
  }

  const profilesDocument = await readJson(resolve(directory, 'profiles.json'))
  const relationshipsDocument = await readJson(resolve(directory, 'relationships.json'))
  const scenarios = await readJsonl(resolve(directory, 'scenarios.jsonl'))
  const agentMemoryDocument = await readJson(resolve(directory, 'expected-agent-memory.json'))
  const manifest = await readJson(resolve(directory, 'manifest.json'))
  const reviewPatch = await readJson(resolve(directory, 'review-patch.json'))

  const cohortIds = [
    profilesDocument.cohortId,
    relationshipsDocument.cohortId,
    agentMemoryDocument.cohortId,
    manifest.cohortId,
    reviewPatch.cohortId,
  ]
  fail(new Set(cohortIds).size === 1 && cohortIds.every(isNonEmptyString), 'All documents must use the same cohortId')
  fail([profilesDocument, relationshipsDocument, agentMemoryDocument, manifest, reviewPatch].every((document) => document.schemaVersion === 1), 'All documents must use schemaVersion 1')
  fail(Array.isArray(reviewPatch.textCorrections), 'review-patch.json must contain textCorrections[]')
  for (const correction of reviewPatch.textCorrections || []) {
    fail(
      isNonEmptyString(correction.from) && isNonEmptyString(correction.to) && isNonEmptyString(correction.reason),
      'Every review text correction needs from, to, and reason',
    )
    fail(correction.from !== correction.to, 'Review text correction from and to values must differ')
  }

  const profiles = profilesDocument.profiles
  fail(Array.isArray(profiles), 'profiles.json must contain profiles[]')
  fail(profiles?.length === 5, `Expected 5 profiles, received ${profiles?.length ?? 0}`)
  const profileIds = new Set(profiles?.map((profile) => profile.id))
  fail(profileIds.size === profiles?.length, 'Profile IDs must be unique')
  fail(duplicateValues(profiles?.map((profile) => profile.account?.email) || []).length === 0, 'Profile emails must be unique')
  fail(duplicateValues(profiles?.map((profile) => profile.profile?.displayName) || []).length === 0, 'Profile display names must be unique')

  for (const profile of profiles || []) {
    const label = `Profile ${profile.id || '<missing-id>'}`
    fail(/^persona-hk-00[1-5]$/.test(profile.id), `${label} has an invalid stable ID`)
    fail(Number.isInteger(profile.sourceLine) && profile.sourceLine > 0, `${label} needs a positive sourceLine`)
    fail(isNonEmptyString(profile.sourcePersona), `${label} needs sourcePersona`)
    fail(profile.account?.email === `${profile.id.replaceAll('-', '.')}@socialcosmos.local`, `${label} has an unexpected test email`)
    fail(isNonEmptyString(profile.profile?.displayName), `${label} needs displayName`)
    fail(ageBands.has(profile.profile?.ageBand), `${label} has invalid ageBand`)
    fail(profile.profile?.locale === 'zh-HK', `${label} locale must be zh-HK`)
    fail(allStrings(profile.profile?.languages), `${label} needs languages[]`)
    fail(profile.profile?.languages?.some((language) => ['zh-HK', 'yue-HK'].includes(language)), `${label} languages must include zh-HK or yue-HK`)
    fail(isNonEmptyString(profile.profile?.occupation), `${label} needs occupation`)
    fail(isNonEmptyString(profile.profile?.bio), `${label} needs bio`)
    fail(isNonEmptyString(profile.profile?.communicationStyle), `${label} needs communicationStyle`)
    fail(allStrings(profile.profile?.interests) && profile.profile.interests.length >= 3 && profile.profile.interests.length <= 6, `${label} needs 3-6 interests`)
    fail(allStrings(profile.profile?.tags) && profile.profile.tags.length >= 3 && profile.profile.tags.length <= 5, `${label} needs 3-5 tags`)
    fail(isNonEmptyString(profile.planet?.name), `${label} needs planet.name`)
    fail(!profile.planet?.name?.toLowerCase().includes(profile.planet?.archetype || ''), `${label} planet.name must not contain its archetype token`)
    fail(isNonEmptyString(profile.planet?.motto), `${label} needs planet.motto`)
    fail(archetypes.has(profile.planet?.archetype), `${label} has invalid planet archetype`)
  }

  const relationships = relationshipsDocument.relationships
  fail(Array.isArray(relationships), 'relationships.json must contain relationships[]')
  fail(relationships?.length === 8, `Expected 8 relationships, received ${relationships?.length ?? 0}`)
  fail(new Set(relationships?.map((relationship) => relationship.id)).size === relationships?.length, 'Relationship IDs must be unique')
  const relationshipById = new Map((relationships || []).map((relationship) => [relationship.id, relationship]))
  const profileById = new Map((profiles || []).map((profile) => [profile.id, profile]))
  const degrees = new Map([...profileIds].map((id) => [id, 0]))

  for (const relationship of relationships || []) {
    const label = `Relationship ${relationship.id || '<missing-id>'}`
    fail(/^persona-rel-00[1-8]$/.test(relationship.id), `${label} has an invalid stable ID`)
    fail(Array.isArray(relationship.participantIds) && relationship.participantIds.length === 2, `${label} needs two participantIds`)
    fail(new Set(relationship.participantIds).size === 2, `${label} participants must differ`)
    for (const participantId of relationship.participantIds || []) {
      fail(profileIds.has(participantId), `${label} references unknown participant ${participantId}`)
      if (degrees.has(participantId)) degrees.set(participantId, degrees.get(participantId) + 1)
    }
    fail(isIsoDate(relationship.startedAt), `${label} needs a valid startedAt date`)
    fail(isNonEmptyString(relationship.sharedContext), `${label} needs sharedContext`)
    fail(Array.isArray(relationship.perspectives) && relationship.perspectives.length === 2, `${label} needs two perspectives`)
    const ownerIds = new Set()
    for (const perspective of relationship.perspectives || []) {
      ownerIds.add(perspective.ownerUserId)
      fail(relationship.participantIds.includes(perspective.ownerUserId), `${label} has an invalid perspective owner`)
      fail(relationship.participantIds.includes(perspective.targetUserId), `${label} has an invalid perspective target`)
      fail(perspective.ownerUserId !== perspective.targetUserId, `${label} perspective owner and target must differ`)
      fail(relationTypes.has(perspective.relationType), `${label} has invalid relationType ${perspective.relationType}`)
      fail(isNonEmptyString(perspective.identityLabel), `${label} perspective needs identityLabel`)
      fail(isNonEmptyString(perspective.description), `${label} perspective needs description`)
      fail(Number.isFinite(perspective.strength) && perspective.strength >= 0.3 && perspective.strength <= 0.95, `${label} strength must be 0.30-0.95`)
      fail(relationshipStatuses.has(perspective.status), `${label} has invalid status ${perspective.status}`)
    }
    fail(ownerIds.size === 2 && relationship.participantIds.every((id) => ownerIds.has(id)), `${label} needs one perspective per participant`)
  }

  for (const [profileId, degree] of degrees) fail(degree >= 3 && degree <= 4, `${profileId} must have 3-4 relationships, received ${degree}`)

  fail(scenarios.length === 24, `Expected 24 scenarios, received ${scenarios.length}`)
  fail(new Set(scenarios.map((scenario) => scenario.id)).size === scenarios.length, 'Scenario IDs must be unique')
  const scenarioIds = new Set(scenarios.map((scenario) => scenario.id))
  const scenarioCounts = new Map()
  const recentCounts = new Map()

  for (const scenario of scenarios) {
    const label = `Scenario ${scenario.id || '<missing-id>'}`
    const relationship = relationshipById.get(scenario.relationshipId)
    fail(Boolean(relationship), `${label} references unknown relationship ${scenario.relationshipId}`)
    scenarioCounts.set(scenario.relationshipId, (scenarioCounts.get(scenario.relationshipId) || 0) + 1)
    if (scenario.eventDate >= '2025-01-01') recentCounts.set(scenario.relationshipId, (recentCounts.get(scenario.relationshipId) || 0) + 1)
    fail(isIsoDate(scenario.eventDate), `${label} needs a valid eventDate`)
    fail(scenario.eventDate <= '2026-07-22', `${label} cannot occur in the future`)
    if (relationship) {
      fail(scenario.eventDate >= relationship.startedAt, `${label} occurs before the relationship started`)
      fail(JSON.stringify([...scenario.participantIds].sort()) === JSON.stringify([...relationship.participantIds].sort()), `${label} participants do not match its relationship`)
    }
    fail(isNonEmptyString(scenario.location), `${label} needs location`)
    fail(eventTypes.has(scenario.eventType), `${label} has invalid eventType ${scenario.eventType}`)
    fail(isNonEmptyString(scenario.sharedEvent), `${label} needs sharedEvent`)
    fail(Array.isArray(scenario.inputs) && scenario.inputs.length === 2, `${label} needs two participant inputs`)
    const inputUsers = new Set()
    for (const input of scenario.inputs || []) {
      inputUsers.add(input.userId)
      fail(scenario.participantIds.includes(input.userId), `${label} input references unknown participant ${input.userId}`)
      fail(isNonEmptyString(input.text) && input.text.length >= 20 && input.text.length <= 500, `${label} input text must be 20-500 characters`)
      const targetId = scenario.participantIds.find((participantId) => participantId !== input.userId)
      const targetName = profileById.get(targetId)?.profile?.displayName
      fail(referencesChineseName(input.text, targetName), `${label} input from ${input.userId} does not reference target name ${targetName}`)
    }
    fail(inputUsers.size === 2 && scenario.participantIds.every((id) => inputUsers.has(id)), `${label} needs one input per participant`)
    const expected = scenario.expectedBusinessMemory
    fail(isNonEmptyString(expected?.summary), `${label} expected memory needs summary`)
    fail(allStrings(expected?.facts), `${label} expected memory needs facts[]`)
    fail(Array.isArray(expected?.emotions) && expected.emotions.length > 0, `${label} expected memory needs emotions[]`)
    for (const emotion of expected?.emotions || []) {
      fail(isNonEmptyString(emotion.name), `${label} emotion needs name`)
      fail(Number.isFinite(emotion.intensity) && emotion.intensity >= 0 && emotion.intensity <= 100, `${label} emotion intensity must be 0-100`)
    }
    fail(relationshipChanges.has(expected?.relationshipChange), `${label} has invalid relationshipChange`)
  }

  for (const relationship of relationships || []) {
    fail(scenarioCounts.get(relationship.id) === 3, `${relationship.id} must have exactly three scenarios`)
    fail((recentCounts.get(relationship.id) || 0) >= 1, `${relationship.id} needs at least one scenario from 2025 or 2026`)
  }

  const memories = agentMemoryDocument.items
  fail(Array.isArray(memories), 'expected-agent-memory.json must contain items[]')
  fail((memories?.length || 0) >= 15, 'Expected at least 15 Agent Memory candidates')
  fail(new Set(memories?.map((memory) => memory.id)).size === memories?.length, 'Agent Memory IDs must be unique')
  warn((memories?.length || 0) <= 100, `Agent Memory candidate count is high: ${memories?.length || 0}`)
  for (const memory of memories || []) {
    const label = `Agent Memory ${memory.id || '<missing-id>'}`
    fail(profileIds.has(memory.userId), `${label} references unknown user ${memory.userId}`)
    fail(agentMemoryTypes.has(memory.memoryType), `${label} has invalid type ${memory.memoryType}`)
    fail(isNonEmptyString(memory.statement), `${label} needs statement`)
    fail(['pending', 'approved', 'rejected'].includes(memory.reviewStatus), `${label} has invalid reviewStatus`)
    fail(memory.evidenceProfileId === null || profileIds.has(memory.evidenceProfileId), `${label} has invalid evidenceProfileId`)
    fail(Array.isArray(memory.evidenceScenarioIds), `${label} needs evidenceScenarioIds[]`)
    for (const scenarioId of memory.evidenceScenarioIds || []) fail(scenarioIds.has(scenarioId), `${label} references unknown scenario ${scenarioId}`)
    fail(Boolean(memory.evidenceProfileId) || memory.evidenceScenarioIds?.length > 0, `${label} needs profile or scenario evidence`)
  }
  fail(duplicateValues((memories || []).map((memory) => `${memory.userId}:${memory.statement.trim().toLowerCase()}`)).length === 0, 'Agent Memory candidates must be unique per user')

  const fixtureText = collectStrings({ profiles, relationships, scenarios, memories }).join('\n')
  fail(!/\b(?:ignore (?:all |the )?previous|system prompt|act as|you are chatgpt|assistant:)\b/i.test(fixtureText), 'Generated fixture contains instruction-like prompt injection text')
  fail(!/https?:\/\//i.test(fixtureText), 'Generated fixture contains a URL')
  fail(!/[\w.+-]+@(?!socialcosmos\.local)[\w.-]+\.[A-Za-z]{2,}/.test(fixtureText), 'Generated fixture contains a non-test email address')
  warn(!/(?:\+852[ -]?)?[2-9]\d{3}[ -]?\d{4}/.test(fixtureText), 'Generated fixture contains a Hong Kong phone-like number; review it manually')

  const expectedCounts = manifest.counts || {}
  fail(expectedCounts.profiles === profiles?.length, 'Manifest profile count does not match')
  fail(expectedCounts.relationships === relationships?.length, 'Manifest relationship count does not match')
  fail(expectedCounts.scenarios === scenarios.length, 'Manifest scenario count does not match')
  fail(expectedCounts.expectedAgentMemories === memories?.length, 'Manifest Agent Memory count does not match')
  for (const [file, expectedHash] of Object.entries(manifest.outputHashes || {})) {
    const actualHash = sha256(await readFile(resolve(directory, file), 'utf8'))
    fail(actualHash === expectedHash, `Manifest hash mismatch for ${file}`)
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    counts: {
      profiles: profiles?.length || 0,
      relationships: relationships?.length || 0,
      scenarios: scenarios.length,
      expectedAgentMemories: memories?.length || 0,
    },
    cohortId: cohortIds[0] || null,
  }
}
