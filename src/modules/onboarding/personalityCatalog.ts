import type { PersonalityType, PlanetArchetype, PlanetPalette, PlanetVisualConfig } from '../../product/contracts'
import { planetStyleModule } from '../planet/style/planetStyleModule'

export interface LocalizedText {
  zh: string
  en: string
}

export interface PersonalityDefinition {
  id: PersonalityType
  name: LocalizedText
  summary: LocalizedText
  group: 'analyst' | 'diplomat' | 'sentinel' | 'explorer'
  accent: string
  archetypes: [PlanetArchetype, PlanetArchetype, PlanetArchetype]
  motto: LocalizedText
}

export interface PersonalityPlanetOption {
  id: string
  name: LocalizedText
  description: LocalizedText
  visual: PlanetVisualConfig
}

const analyst = { group: 'analyst' as const, accent: '#b99cff' }
const diplomat = { group: 'diplomat' as const, accent: '#74dfbd' }
const sentinel = { group: 'sentinel' as const, accent: '#71c9ff' }
const explorer = { group: 'explorer' as const, accent: '#ffc47c' }

const groupPlanetPalettes: Record<PersonalityDefinition['group'], PlanetPalette> = {
  analyst: {
    deep: '#1d123c',
    surface: '#7b50c7',
    highlight: '#ddc9ff',
    atmosphere: '#b99cff',
  },
  diplomat: {
    deep: '#082d28',
    surface: '#25b487',
    highlight: '#b7f4dc',
    atmosphere: '#74dfbd',
  },
  sentinel: {
    deep: '#092743',
    surface: '#268dcc',
    highlight: '#bee9ff',
    atmosphere: '#71c9ff',
  },
  explorer: {
    deep: '#40230c',
    surface: '#d37a27',
    highlight: '#ffe1ad',
    atmosphere: '#ffc47c',
  },
}

export const PERSONALITY_CATALOG: PersonalityDefinition[] = [
  { id: 'INTJ', ...analyst, name: { zh: 'Architect', en: 'Architect' }, summary: { zh: 'Independent, composed, and drawn to long-range systems', en: 'Independent, composed, and drawn to long-range systems' }, archetypes: ['crystalline', 'volcanic', 'terran'], motto: { zh: 'Let order emerge from deep space', en: 'Let order emerge from deep space' } },
  { id: 'INTP', ...analyst, name: { zh: 'Logician', en: 'Logician' }, summary: { zh: 'Curious, open, and always taking ideas apart', en: 'Curious, open, and always taking ideas apart' }, archetypes: ['crystalline', 'oceanic', 'terran'], motto: { zh: 'Every question opens a new orbit', en: 'Every question opens a new orbit' } },
  { id: 'ENTJ', ...analyst, name: { zh: 'Commander', en: 'Commander' }, summary: { zh: 'Decisive, organized, and able to move complex goals', en: 'Decisive, organized, and able to move complex goals' }, archetypes: ['volcanic', 'crystalline', 'terran'], motto: { zh: 'Build gravity for futures not yet made', en: 'Build gravity for futures not yet made' } },
  { id: 'ENTP', ...analyst, name: { zh: 'Debater', en: 'Debater' }, summary: { zh: 'Quick, experimental, and energized by possibility', en: 'Quick, experimental, and energized by possibility' }, archetypes: ['volcanic', 'crystalline', 'oceanic'], motto: { zh: 'Stay off course until something new appears', en: 'Stay off course until something new appears' } },
  { id: 'INFJ', ...diplomat, name: { zh: 'Advocate', en: 'Advocate' }, summary: { zh: 'Insightful, steady, and attentive to human meaning', en: 'Insightful, steady, and attentive to human meaning' }, archetypes: ['verdant', 'oceanic', 'crystalline'], motto: { zh: 'Even quiet light can turn a tide', en: 'Even quiet light can turn a tide' } },
  { id: 'INFP', ...diplomat, name: { zh: 'Mediator', en: 'Mediator' }, summary: { zh: 'Gentle, imaginative, and loyal to inner values', en: 'Gentle, imaginative, and loyal to inner values' }, archetypes: ['verdant', 'oceanic', 'terran'], motto: { zh: 'Keep an ocean for what feels true', en: 'Keep an ocean for what feels true' } },
  { id: 'ENFJ', ...diplomat, name: { zh: 'Protagonist', en: 'Protagonist' }, summary: { zh: 'Warm, compelling, and able to help others be seen', en: 'Warm, compelling, and able to help others be seen' }, archetypes: ['verdant', 'terran', 'oceanic'], motto: { zh: 'Let every meeting become shared light', en: 'Let every meeting become shared light' } },
  { id: 'ENFP', ...diplomat, name: { zh: 'Campaigner', en: 'Campaigner' }, summary: { zh: 'Free-spirited, energetic, and drawn to new connections', en: 'Free-spirited, energetic, and drawn to new connections' }, archetypes: ['verdant', 'volcanic', 'oceanic'], motto: { zh: 'Grow new ecologies along what you love', en: 'Grow new ecologies along what you love' } },
  { id: 'ISTJ', ...sentinel, name: { zh: 'Logistician', en: 'Logistician' }, summary: { zh: 'Reliable, precise, and committed to stable orbits', en: 'Reliable, precise, and committed to stable orbits' }, archetypes: ['terran', 'crystalline', 'verdant'], motto: { zh: 'Stability is its own kind of force', en: 'Stability is its own kind of force' } },
  { id: 'ISFJ', ...sentinel, name: { zh: 'Defender', en: 'Defender' }, summary: { zh: 'Considerate, patient, and attentive to relational detail', en: 'Considerate, patient, and attentive to relational detail' }, archetypes: ['terran', 'verdant', 'oceanic'], motto: { zh: 'Keep valued people in warm orbit', en: 'Keep valued people in warm orbit' } },
  { id: 'ESTJ', ...sentinel, name: { zh: 'Executive', en: 'Executive' }, summary: { zh: 'Direct, practical, and skilled at turning chaos into action', en: 'Direct, practical, and skilled at turning chaos into action' }, archetypes: ['terran', 'volcanic', 'crystalline'], motto: { zh: 'Give every action a real coordinate', en: 'Give every action a real coordinate' } },
  { id: 'ESFJ', ...sentinel, name: { zh: 'Consul', en: 'Consul' }, summary: { zh: 'Friendly, collaborative, and invested in shared life', en: 'Friendly, collaborative, and invested in shared life' }, archetypes: ['terran', 'verdant', 'oceanic'], motto: { zh: 'Shared life gives a planet its seasons', en: 'Shared life gives a planet its seasons' } },
  { id: 'ISTP', ...explorer, name: { zh: 'Virtuoso', en: 'Virtuoso' }, summary: { zh: 'Calm, adaptable, and inclined to understand by doing', en: 'Calm, adaptable, and inclined to understand by doing' }, archetypes: ['volcanic', 'crystalline', 'terran'], motto: { zh: 'Calibrate the unknown by hand', en: 'Calibrate the unknown by hand' } },
  { id: 'ISFP', ...explorer, name: { zh: 'Adventurer', en: 'Adventurer' }, summary: { zh: 'Sensitive, spontaneous, and alert to unexpected beauty', en: 'Sensitive, spontaneous, and alert to unexpected beauty' }, archetypes: ['oceanic', 'verdant', 'terran'], motto: { zh: 'Let every feeling leave a landscape', en: 'Let every feeling leave a landscape' } },
  { id: 'ESTP', ...explorer, name: { zh: 'Entrepreneur', en: 'Entrepreneur' }, summary: { zh: 'Bold, agile, and quick to catch opportunity in motion', en: 'Bold, agile, and quick to catch opportunity in motion' }, archetypes: ['volcanic', 'oceanic', 'terran'], motto: { zh: 'Arrive first, define the edge later', en: 'Arrive first, define the edge later' } },
  { id: 'ESFP', ...explorer, name: { zh: 'Entertainer', en: 'Entertainer' }, summary: { zh: 'Bright, generous, and able to animate the present', en: 'Bright, generous, and able to animate the present' }, archetypes: ['oceanic', 'verdant', 'volcanic'], motto: { zh: 'This moment deserves an aurora', en: 'This moment deserves an aurora' } },
]

const optionNames: Array<{ name: LocalizedText; description: LocalizedText }> = [
  { name: { zh: 'Native world', en: 'Native world' }, description: { zh: 'Closest to your personality signal', en: 'Closest to your personality signal' } },
  { name: { zh: 'Resonant world', en: 'Resonant world' }, description: { zh: 'Same temperament, different terrain', en: 'Same temperament, different terrain' } },
  { name: { zh: 'Free orbit', en: 'Free orbit' }, description: { zh: 'A possibility beyond the label', en: 'A possibility beyond the label' } },
]

function stableSeed(type: PersonalityType, index: number): number {
  return [...type].reduce((value, character) => value * 31 + character.charCodeAt(0), 17) + index * 7919
}

export function getPersonality(type: PersonalityType): PersonalityDefinition {
  return PERSONALITY_CATALOG.find((item) => item.id === type) ?? PERSONALITY_CATALOG[0]
}

export function createPersonalityPlanetOptions(type: PersonalityType): PersonalityPlanetOption[] {
  const personality = getPersonality(type)
  return personality.archetypes.map((archetype, index) => {
    const seed = stableSeed(type, index)
    const base = planetStyleModule.generate({ mode: 'personality', archetype, seed })
    const overrides = index === 1
      ? {
          cloudDensity: Math.min(1, base.cloudDensity + 0.12),
          atmosphereStrength: Math.min(1, base.atmosphereStrength + 0.1),
        }
      : index === 2
        ? { ring: !base.ring, satellites: 2, terrain: Math.min(1, base.terrain + 0.14) }
        : undefined
    const visual = overrides
      ? planetStyleModule.generate({ mode: 'personality', archetype, seed, overrides })
      : base
    const palette = groupPlanetPalettes[personality.group]
    return {
      id: `${type}-${index}`,
      ...optionNames[index],
      visual: {
        ...visual,
        palette: { ...palette },
        ringColor: palette.highlight,
      },
    }
  })
}
