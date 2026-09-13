export type MemoryType = 'photo' | 'conversation' | 'event' | 'milestone'

export type EmotionalTone =
  | 'joyful'
  | 'comforting'
  | 'proud'
  | 'calm'
  | 'nostalgic'
  | 'warm'
  | 'bittersweet'

export interface Memory {
  id: string
  title: string
  date: string
  type: MemoryType
  summary: string
  /** CSS gradient string used as a placeholder in place of a real photo. */
  image: string
  emotionalTone: EmotionalTone
  /** 0-100. Higher = larger, more prominent memory node. */
  importance: number
  /** The full, untruncated original text the user wrote/uploaded, when this
   * memory came from the add-memory flow (see MemoryObject.rawText). Absent
   * for the static curated fixtures, whose `summary` is already the
   * complete text — display code should fall back to `summary` when this
   * is unset. */
  rawText?: string
}
