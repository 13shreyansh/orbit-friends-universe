export type MemoryPageType = 'cover' | 'photo' | 'video' | 'text'

export interface MemoryPage {
  id: string
  type: MemoryPageType
  title?: string
  text?: string
  mediaUrl?: string
  fileName?: string
  createdAt?: number
}

export type BookState = 'opened' | 'turning' | 'closed'
export type PageDirection = 'next' | 'previous'
export type MemoryBookStage = 'opening' | 'view' | 'turning'
