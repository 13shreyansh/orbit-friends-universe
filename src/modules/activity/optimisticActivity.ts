import type {
  ActivityDraft,
  ActivityMedia,
  ActivityPost,
  EcosystemEffect,
  SocialPlanet,
  UserProfile,
} from '../../product/contracts'
import { calibratedNowIso } from '../../utils/time'

const PALETTE = [
  ['#78ead6', '#9ca7ff'],
  ['#f4a88a', '#d58cff'],
  ['#86c8ff', '#73f0c4'],
  ['#ffb4cf', '#8ba4ff'],
] as const

function hash(value: string) {
  let result = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index)
    result = Math.imul(result, 16777619)
  }
  return result >>> 0
}

function mediaType(file: File): ActivityMedia['type'] {
  if (file.type.startsWith('audio/')) return 'audio'
  if (file.type.startsWith('video/')) return 'video'
  return 'image'
}

function optimisticEffect(seed: number, draft: ActivityDraft, mediaFiles: File[]): EcosystemEffect {
  const palette = PALETTE[seed % PALETTE.length]
  const mediaTypes = new Set(mediaFiles.map(mediaType))
  const expression = Math.min(1, (draft.text.length + draft.tags.join('').length) / 320)
  return {
    version: 1,
    kind: 'emerging-terrain',
    seed,
    intensity: 0.48 + expression * 0.2,
    signalStrength: 0.58 + Math.min(0.18, mediaFiles.length * 0.04),
    landmarkCount: Math.min(24, 7 + draft.tags.length + mediaFiles.length * 2),
    primaryColor: palette[0],
    secondaryColor: palette[1],
    traits: {
      vitality: 0.48 + (mediaTypes.has('image') ? 0.12 : 0),
      serenity: 0.5,
      intensity: 0.46 + expression * 0.18,
      connection: 0.48 + (mediaTypes.has('audio') ? 0.16 : 0),
      motion: 0.45 + (mediaTypes.has('video') ? 0.28 : 0),
      memory: 0.52 + (mediaFiles.length ? 0.12 : 0),
      novelty: 0.5 + Math.min(0.18, draft.tags.length * 0.03),
    },
  }
}

export function createOptimisticActivity(
  draft: ActivityDraft,
  mediaFiles: File[],
  profile: UserProfile,
  planet: SocialPlanet,
): { activity: ActivityPost; previewUrls: string[] } {
  const id = `pending-activity-${Date.now()}-${Math.random().toString(16).slice(2)}`
  const seed = hash(`${profile.id}:${id}:${draft.title}:${draft.text}`)
  const previewUrls: string[] = []
  const media = mediaFiles.map((file): ActivityMedia => {
    const url = URL.createObjectURL(file)
    previewUrls.push(url)
    return {
      type: mediaType(file),
      url,
      mimeType: file.type || 'application/octet-stream',
      name: file.name,
      size: file.size,
    }
  })
  return {
    previewUrls,
    activity: {
      id,
      authorUserId: profile.id,
      authorName: profile.displayName,
      planetId: planet.id,
      kind: 'life-update',
      ...draft,
      media,
      ecosystemEffect: optimisticEffect(seed, draft, mediaFiles),
      publishedAt: calibratedNowIso(),
      analysisStatus: 'queued',
      deliveryStatus: 'uploading',
      broadcast: { active: true, visible: true, canClose: true, seenAt: null },
    },
  }
}
