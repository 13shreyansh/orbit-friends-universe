import type { EmotionalTone } from './memory'

export interface TimelineEntry {
  date: string
  /** Short stage title, e.g. "First Met", "Became Distant", "Reconnected". */
  event: string
  intimacy: number
  interactionFrequency: number
  emotionalTone: EmotionalTone
  description: string
}
