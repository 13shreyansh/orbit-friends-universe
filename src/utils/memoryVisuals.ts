import type { EmotionalTone, MemoryType } from '../types/memory'

// Muted, dreamy palette — distinct per tone but kept within the same
// desaturated family as the rest of the cosmos (no rainbow saturation).
const EMOTIONAL_TONE_COLORS: Record<EmotionalTone, string> = {
  joyful: '#e3b673',
  comforting: '#cf93a6',
  proud: '#d1a5e0',
  calm: '#7fb0c9',
  nostalgic: '#9f8fd1',
  warm: '#e0977a',
  bittersweet: '#7d87a8',
}

const MEMORY_TYPE_LABELS: Record<MemoryType, string> = {
  photo: 'Photo',
  conversation: 'Conversation',
  event: 'Event',
  milestone: 'Milestone',
}

const NODE_SIZE_MIN = 0.22
const NODE_SIZE_MAX = 0.46

export function getEmotionalToneColor(tone: EmotionalTone): string {
  return EMOTIONAL_TONE_COLORS[tone]
}

export function getMemoryTypeLabel(type: MemoryType): string {
  return MEMORY_TYPE_LABELS[type]
}

/** Importance 0-100 → memory node size, same lerp language as planet sizing. */
export function getMemoryNodeSize(importance: number): number {
  const t = Math.min(1, Math.max(0, importance / 100))
  return NODE_SIZE_MIN + (NODE_SIZE_MAX - NODE_SIZE_MIN) * t
}
