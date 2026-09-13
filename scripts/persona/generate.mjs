import { mkdir, readFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  PERSONA_PROMPT_VERSION,
  PERSONA_SCHEMA_VERSION,
  assert,
  callJsonModel,
  modelConfig,
  parseArgs,
  readJsonl,
  sha256,
  writeJson,
  writeJsonl,
} from './lib.mjs'

const args = parseArgs(process.argv.slice(2))
const projectRoot = resolve(import.meta.dirname, '../..')
const inputPath = resolve(projectRoot, args.get('input', 'test/persona/persona.test-5.jsonl'))
const outputDir = resolve(projectRoot, args.get('output', 'test/persona/generated/hk-5'))
const seed = Number(args.get('seed', process.env.PERSONA_SEED || '42'))
const temperature = Number(process.env.PERSONA_TEMPERATURE || '0.3')
const force = args.has('force')
const cohortId = `hk-5-seed-${seed}`

const relationshipTopology = [
  ['persona-rel-001', 'persona-hk-001', 'persona-hk-002'],
  ['persona-rel-002', 'persona-hk-001', 'persona-hk-003'],
  ['persona-rel-003', 'persona-hk-001', 'persona-hk-004'],
  ['persona-rel-004', 'persona-hk-002', 'persona-hk-003'],
  ['persona-rel-005', 'persona-hk-002', 'persona-hk-005'],
  ['persona-rel-006', 'persona-hk-003', 'persona-hk-005'],
  ['persona-rel-007', 'persona-hk-004', 'persona-hk-005'],
  ['persona-rel-008', 'persona-hk-002', 'persona-hk-004'],
].map(([id, first, second]) => ({ id, participantIds: [first, second] }))

const systemPrompt = `You generate fictional, internally consistent test fixtures for Social Cosmos.
Return one JSON object only, with no Markdown.
All people must be fictional. Never copy a real person's full identity, contact details, or private information.
Use natural Traditional Chinese suitable for Hong Kong. English may appear only where locally natural.
Keep the supplied stable IDs unchanged. Treat seed ${seed} as a reproducibility constraint.
Avoid political persuasion, stereotypes, diagnoses, explicit sexual content, crime instructions, and financial advice.
The fixtures will test relationship memories and an AI agent, so prefer ordinary life, work, family, friendship, culture, food, travel, and community events.
Prompt version: ${PERSONA_PROMPT_VERSION}.`

async function runStage(stage, input) {
  const config = modelConfig()
  console.log(`[persona] generating ${stage} with ${config.model}`)
  const result = await callJsonModel({
    ...config,
    stage,
    system: systemPrompt,
    input,
    temperature,
  })
  await writeJson(resolve(outputDir, 'raw-responses', `${stage}.json`), {
    stage,
    model: config.model,
    requestId: result.requestId,
    content: result.raw,
  })
  return result.data
}

function profileRequest(selected) {
  return {
    task: 'Create five complete fictional Hong Kong test-user profiles from the source role descriptions.',
    requirements: [
      'Return exactly five profiles in the same order as input.',
      'Each displayName must be a unique fictional Chinese name, written in Traditional Chinese.',
      'Use a varied but plausible mix of age bands: 18-24, 25-34, 35-44, 45-54, 55-64, or 65+.',
      'locale must be zh-HK and languages must include zh-HK or yue-HK.',
      'bio must be 40-100 Traditional Chinese characters.',
      'interests must contain 3-6 short items; tags must contain 3-5 short items.',
      'communicationStyle must be a concise behavioral description, not a diagnosis.',
      'planet must include name, motto, and one archetype from terran, oceanic, volcanic, crystalline, verdant.',
      'planet.name must be a natural Chinese proper name and must not include the archetype token.',
      'agentMemoryCandidates must contain 3-5 stable profile/preference/identity facts worth recalling later.',
    ],
    outputShape: {
      profiles: [{
        id: 'stable input id',
        profile: {
          displayName: 'string',
          ageBand: 'string',
          locale: 'zh-HK',
          languages: ['string'],
          occupation: 'string',
          bio: 'string',
          communicationStyle: 'string',
          interests: ['string'],
          tags: ['string'],
        },
        planet: {
          name: 'string',
          motto: 'string',
          archetype: 'terran|oceanic|volcanic|crystalline|verdant',
        },
        agentMemoryCandidates: [{ memoryType: 'profile|preferences|identity', statement: 'string' }],
      }],
    },
    profiles: selected.map((item) => ({ id: item.testPersonaId, sourcePersona: item.persona })),
  }
}

function relationshipRequest(profiles) {
  return {
    task: 'Create eight mutually consistent relationships for the fixed participant pairs.',
    requirements: [
      'Return exactly one relationship for every supplied relationship id.',
      'Do not change participant IDs or invent additional people.',
      'Use plausible prior connections in Hong Kong and avoid making everyone current colleagues.',
      'Across the cohort use varied relation types from family, friend, colleague, classmate, mentor, community, past, other.',
      'Each relationship needs two directional perspectives, one owned by each participant.',
      'startedAt must be an ISO date from 2005-01-01 through 2025-12-31 and fit both age bands.',
      'strength must be between 0.30 and 0.95.',
      'status must be active, dormant, or faded.',
      'sharedContext and perspective descriptions must agree on how the pair met.',
    ],
    allowedRelationTypes: ['family', 'friend', 'partner', 'colleague', 'classmate', 'mentor', 'community', 'past', 'other'],
    outputShape: {
      relationships: [{
        id: 'stable relationship id',
        startedAt: 'YYYY-MM-DD',
        sharedContext: 'string',
        perspectives: [{
          ownerUserId: 'participant id',
          targetUserId: 'other participant id',
          relationType: 'allowed relation type',
          identityLabel: 'string',
          description: 'string',
          strength: 0.7,
          status: 'active|dormant|faded',
        }],
      }],
    },
    profiles: profiles.map((item) => ({ id: item.id, profile: item.profile })),
    topology: relationshipTopology,
  }
}

function scenarioRequest(profiles, relationships) {
  const participantIds = new Set(relationships.flatMap((item) => item.participantIds))
  return {
    task: 'Create three shared relationship-memory scenarios for each supplied relationship.',
    requirements: [
      'Return exactly three scenarios for each relationship, indexed 1, 2, and 3.',
      'Events must be mutually consistent with the profiles, relationship origin, and current date 2026-07-23.',
      'Use ISO event dates between the relationship startedAt and 2026-07-22.',
      'At least one event per relationship should be from 2025 or 2026.',
      'Each scenario must include a natural first-person memory input from both participants.',
      'Each input should be 50-180 Traditional Chinese characters and mention the other person by display name.',
      'Whenever a person is named, use the exact supplied displayName or a natural abbreviation derived from it; never change the surname.',
      'Expected business memory must state only facts supported by that event.',
      'Expected Agent Memory candidates must be useful later and traceable to the event.',
      'Do not infer mental health, personality disorders, protected traits, or unsupported relationship conclusions.',
    ],
    outputShape: {
      relationships: [{
        relationshipId: 'stable relationship id',
        scenarios: [{
          scenarioIndex: 1,
          eventDate: 'YYYY-MM-DD',
          location: 'string',
          eventType: 'conversation|gathering|trip|celebration|check-in|work|community|milestone',
          sharedEvent: 'string',
          inputs: [{ userId: 'participant id', text: 'string' }],
          expectedBusinessMemory: {
            summary: 'string',
            facts: ['string'],
            emotions: [{ name: 'string', intensity: 60 }],
            relationshipChange: 'closer|stable|distant|reconnected|conflict',
          },
          expectedAgentMemoryCandidates: [{
            userId: 'participant id',
            memoryType: 'entities|events|preferences',
            statement: 'string',
          }],
        }],
      }],
    },
    profiles: profiles
      .filter((profile) => participantIds.has(profile.id))
      .map((profile) => ({ id: profile.id, displayName: profile.profile.displayName, profile: profile.profile })),
    relationships,
  }
}

function indexById(items, label) {
  const result = new Map()
  for (const item of items) {
    assert(item?.id, `${label} contains an item without id`)
    assert(!result.has(item.id), `${label} contains duplicate id ${item.id}`)
    result.set(item.id, item)
  }
  return result
}

function mergeProfiles(selected, generated) {
  assert(Array.isArray(generated.profiles), 'Profile response must contain profiles[]')
  const generatedById = indexById(generated.profiles, 'profiles')
  return selected.map((source, index) => {
    const item = generatedById.get(source.testPersonaId)
    assert(item, `Profile response is missing ${source.testPersonaId}`)
    return {
      id: source.testPersonaId,
      sourceLine: source.sourceLine,
      sourcePersona: source.persona,
      account: { email: `persona.hk.${String(index + 1).padStart(3, '0')}@socialcosmos.local` },
      profile: item.profile,
      planet: item.planet,
      agentMemoryCandidates: item.agentMemoryCandidates,
    }
  })
}

function mergeRelationships(generated) {
  assert(Array.isArray(generated.relationships), 'Relationship response must contain relationships[]')
  const generatedById = indexById(generated.relationships, 'relationships')
  return relationshipTopology.map((topology) => {
    const item = generatedById.get(topology.id)
    assert(item, `Relationship response is missing ${topology.id}`)
    return {
      id: topology.id,
      participantIds: topology.participantIds,
      startedAt: item.startedAt,
      sharedContext: item.sharedContext,
      perspectives: item.perspectives,
    }
  })
}

function mergeScenarios(generated, relationships) {
  assert(Array.isArray(generated.relationships), 'Scenario response must contain relationships[]')
  const generatedById = new Map(generated.relationships.map((item) => [item.relationshipId, item]))
  const scenarios = []
  for (const relationship of relationships) {
    const generatedRelationship = generatedById.get(relationship.id)
    assert(generatedRelationship, `Scenario response is missing ${relationship.id}`)
    assert(Array.isArray(generatedRelationship.scenarios), `${relationship.id} scenarios must be an array`)
    const byIndex = new Map(generatedRelationship.scenarios.map((item) => [Number(item.scenarioIndex), item]))
    for (const scenarioIndex of [1, 2, 3]) {
      const item = byIndex.get(scenarioIndex)
      assert(item, `${relationship.id} is missing scenario ${scenarioIndex}`)
      const id = `scenario-${relationship.id.slice('persona-rel-'.length)}-${String(scenarioIndex).padStart(2, '0')}`
      scenarios.push({
        id,
        relationshipId: relationship.id,
        participantIds: relationship.participantIds,
        eventDate: item.eventDate,
        location: item.location,
        eventType: item.eventType,
        sharedEvent: item.sharedEvent,
        inputs: item.inputs,
        expectedBusinessMemory: item.expectedBusinessMemory,
        expectedAgentMemoryCandidates: item.expectedAgentMemoryCandidates,
      })
    }
  }
  return scenarios
}

function collectAgentMemories(profiles, scenarios) {
  const items = []
  let index = 1
  for (const profile of profiles) {
    for (const candidate of profile.agentMemoryCandidates || []) {
      items.push({
        id: `expected-agent-memory-${String(index).padStart(3, '0')}`,
        userId: profile.id,
        memoryType: candidate.memoryType,
        statement: candidate.statement,
        evidenceProfileId: profile.id,
        evidenceScenarioIds: [],
        reviewStatus: 'pending',
      })
      index += 1
    }
  }
  for (const scenario of scenarios) {
    for (const candidate of scenario.expectedAgentMemoryCandidates || []) {
      items.push({
        id: `expected-agent-memory-${String(index).padStart(3, '0')}`,
        userId: candidate.userId,
        memoryType: candidate.memoryType,
        statement: candidate.statement,
        evidenceProfileId: null,
        evidenceScenarioIds: [scenario.id],
        reviewStatus: 'pending',
      })
      index += 1
    }
  }
  return items
}

async function main() {
  assert(Number.isInteger(seed) && seed > 0, 'seed must be a positive integer')
  const selected = await readJsonl(inputPath)
  assert(selected.length === 5, `Expected exactly five selected personas, received ${selected.length}`)
  const expectedIds = selected.map((item) => item.testPersonaId)
  assert(new Set(expectedIds).size === 5, 'Selected persona IDs must be unique')

  if (force) await rm(outputDir, { recursive: true, force: true })
  else {
    try {
      await readFile(resolve(outputDir, 'manifest.json'), 'utf8')
      throw new Error(`Output already exists at ${outputDir}; pass --force to regenerate`)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  await mkdir(outputDir, { recursive: true })

  const profileResponse = await runStage('profiles', profileRequest(selected))
  const profiles = mergeProfiles(selected, profileResponse)

  const relationshipResponse = await runStage('relationships', relationshipRequest(profiles))
  const relationships = mergeRelationships(relationshipResponse)

  const scenarios = []
  for (let index = 0; index < relationships.length; index += 2) {
    const batch = relationships.slice(index, index + 2)
    const stage = `scenarios-${String(index / 2 + 1).padStart(2, '0')}`
    const scenarioResponse = await runStage(stage, scenarioRequest(profiles, batch))
    scenarios.push(...mergeScenarios(scenarioResponse, batch))
  }

  const agentMemories = collectAgentMemories(profiles, scenarios)
  const cleanProfiles = profiles.map(({ agentMemoryCandidates: _agentMemoryCandidates, ...profile }) => profile)
  const cleanScenarios = scenarios.map(({ expectedAgentMemoryCandidates: _expectedAgentMemoryCandidates, ...scenario }) => scenario)

  const profilesDocument = { schemaVersion: PERSONA_SCHEMA_VERSION, cohortId, profiles: cleanProfiles }
  const relationshipsDocument = { schemaVersion: PERSONA_SCHEMA_VERSION, cohortId, relationships }
  const agentMemoryDocument = { schemaVersion: PERSONA_SCHEMA_VERSION, cohortId, items: agentMemories }

  await writeJson(resolve(outputDir, 'profiles.json'), profilesDocument)
  await writeJson(resolve(outputDir, 'relationships.json'), relationshipsDocument)
  await writeJsonl(resolve(outputDir, 'scenarios.jsonl'), cleanScenarios)
  await writeJson(resolve(outputDir, 'expected-agent-memory.json'), agentMemoryDocument)

  const sourceText = await readFile(inputPath, 'utf8')
  const outputFiles = ['profiles.json', 'relationships.json', 'scenarios.jsonl', 'expected-agent-memory.json']
  const outputHashes = {}
  for (const file of outputFiles) outputHashes[file] = sha256(await readFile(resolve(outputDir, file), 'utf8'))
  const config = modelConfig()
  await writeJson(resolve(outputDir, 'manifest.json'), {
    schemaVersion: PERSONA_SCHEMA_VERSION,
    cohortId,
    generatedAt: new Date().toISOString(),
    generator: {
      model: config.model,
      promptVersion: PERSONA_PROMPT_VERSION,
      temperature,
      seed,
    },
    source: {
      path: inputPath.slice(projectRoot.length + 1),
      sha256: sha256(sourceText),
      selectedSourceLines: selected.map((item) => item.sourceLine),
    },
    counts: {
      profiles: cleanProfiles.length,
      relationships: relationships.length,
      scenarios: cleanScenarios.length,
      expectedAgentMemories: agentMemories.length,
    },
    outputHashes,
  })

  console.log(`[persona] generated ${cleanProfiles.length} profiles, ${relationships.length} relationships, ${cleanScenarios.length} scenarios, and ${agentMemories.length} Agent Memory candidates`)
  console.log(`[persona] output: ${outputDir}`)
}

main().catch((error) => {
  console.error(`[persona] generation failed: ${error.message}`)
  process.exitCode = 1
})
