import type { EmotionalTone, Memory, MemoryType } from '../types/memory'
import type { MemoryObject } from '../types/memoryObject'
import { getEmotionalToneColor } from './memoryVisuals'

// Loose keyword → EmotionalTone matching for whatever free-text emotion name
// the (mock, later real) AI returns — kept intentionally permissive since we
// don't control that vocabulary.
const EMOTION_NAME_TO_TONE: Record<string, EmotionalTone> = {
  joy: 'joyful',
  happy: 'joyful',
  happiness: 'joyful',
  excited: 'joyful',
  comfort: 'comforting',
  comforted: 'comforting',
  supported: 'comforting',
  pride: 'proud',
  proud: 'proud',
  calm: 'calm',
  peaceful: 'calm',
  relaxed: 'calm',
  nostalgia: 'nostalgic',
  nostalgic: 'nostalgic',
  wistful: 'nostalgic',
  warm: 'warm',
  affection: 'warm',
  love: 'warm',
  bittersweet: 'bittersweet',
  sad: 'bittersweet',
  melancholy: 'bittersweet',
}

function dominantToneFromEmotions(emotions: MemoryObject['emotions']): EmotionalTone {
  if (emotions.length === 0) return 'warm'
  const top = [...emotions].sort((a, b) => b.intensity - a.intensity)[0]
  return EMOTION_NAME_TO_TONE[top.name.toLowerCase()] ?? 'warm'
}

function memoryTypeFromObject(memory: MemoryObject): MemoryType {
  if (memory.sourceType === 'chat_screenshot') return 'conversation'
  const haystack = `${memory.eventType} ${memory.keywords.join(' ')}`.toLowerCase()
  if (haystack.includes('milestone')) return 'milestone'
  if (haystack.includes('photo')) return 'photo'
  return 'event'
}

function deriveTitle(memory: MemoryObject): string {
  if (memory.keywords[0]) return memory.keywords[0]
  const summary = memory.summary || memory.narrative || 'A shared memory'
  return summary.length > 42 ? `${summary.slice(0, 39)}...` : summary
}

function averageIntensity(emotions: MemoryObject['emotions']): number {
  if (emotions.length === 0) return 50
  return emotions.reduce((sum, e) => sum + e.intensity, 0) / emotions.length
}

/** Converts a rich MemoryObject (from AI analysis) into the lightweight
 * Memory shape MemoryOrbit/MemoryNode/MemoryDetail already know how to
 * render, so those components don't need to change. */
export function memoryObjectToMemory(memory: MemoryObject): Memory {
  const emotionalTone = dominantToneFromEmotions(memory.emotions)
  const importance = Math.min(
    100,
    Math.max(0, Math.round(memory.confidence * 60 + averageIntensity(memory.emotions) * 0.4)),
  )

  return {
    id: memory.id,
    title: deriveTitle(memory),
    date: memory.eventTime,
    type: memoryTypeFromObject(memory),
    summary: memory.summary || memory.narrative,
    image: `linear-gradient(135deg, #241f3a, ${getEmotionalToneColor(emotionalTone)})`,
    emotionalTone,
    importance,
    // The mock (and, later, real) analysis step may shorten `summary` for
    // display purposes, but the full original input is preserved here so
    // the detail view can always show what the user actually wrote.
    rawText: memory.rawText || undefined,
  }
}
