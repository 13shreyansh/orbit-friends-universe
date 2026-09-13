import type { ActivityPost, EcosystemEffect, EcosystemTraits } from '../../product/contracts'
import type { TranslationKey } from '../../product/i18n/messages'

const LEGACY_LABELS: Record<string, TranslationKey> = {
  'aurora-grove': 'ecosystem.aurora-grove',
  'crystal-bloom': 'ecosystem.crystal-bloom',
  'storm-lights': 'ecosystem.storm-lights',
  'memory-flowers': 'ecosystem.memory-flowers',
  'luminous-forest': 'ecosystem.luminous-forest',
  'moonlit-lake': 'ecosystem.moonlit-lake',
  'tidal-ocean': 'ecosystem.tidal-ocean',
  'volcanic-forge': 'ecosystem.volcanic-forge',
  'flower-field': 'ecosystem.flower-field',
}

export const DEFAULT_ECOSYSTEM_TRAITS: EcosystemTraits = {
  vitality: 0.5,
  serenity: 0.5,
  intensity: 0.5,
  connection: 0.5,
  motion: 0.5,
  memory: 0.5,
  novelty: 0.5,
}

export function ecosystemTraits(effect: EcosystemEffect): EcosystemTraits {
  const traits = { ...DEFAULT_ECOSYSTEM_TRAITS, ...(effect.traits ?? {}) }
  // Old persisted effects predate continuous traits. Preserve their intended
  // appearance while all new effects remain fully parameter-driven.
  if (effect.kind === 'luminous-forest' || effect.kind === 'aurora-grove') {
    traits.vitality = Math.max(traits.vitality, 0.9)
    traits.connection = Math.max(traits.connection, 0.66)
  }
  if (effect.kind === 'moonlit-lake' || effect.kind === 'tidal-ocean') {
    traits.serenity = Math.max(traits.serenity, 0.86)
    traits.motion = Math.max(traits.motion, 0.7)
  }
  if (effect.kind === 'volcanic-forge' || effect.kind === 'storm-lights') {
    traits.intensity = Math.max(traits.intensity, 0.92)
  }
  return traits
}

export function ecosystemLabel(
  activity: ActivityPost,
  t: (key: TranslationKey) => string,
) {
  const legacyKey = LEGACY_LABELS[activity.ecosystemEffect.kind]
  if (legacyKey) return t(legacyKey)
  const subject = activity.tags?.[0]
  return subject ? `${subject} · ${t('activity.generatedEcology')}` : t('activity.generatedEcology')
}

export function activityHeadline(
  activity: ActivityPost,
  t: (key: TranslationKey) => string,
) {
  if (activity.title.trim()) return activity.title
  const text = activity.text.trim().replace(/\s+/g, ' ')
  if (text) return text.length > 42 ? `${text.slice(0, 42)}…` : text
  return t('activity.mediaMoment')
}
