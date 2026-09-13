export type MemorySourceType = 'text' | 'chat_screenshot'
export type MemoryInputMode = MemorySourceType | 'photo' | 'video'

export type RelationshipChange = 'closer' | 'stable' | 'distant' | 'reconnected' | 'conflict'
export type SemanticInteractionType =
  | 'mention'
  | 'conversation'
  | 'co_presence'
  | 'shared_activity'
  | 'collaboration'
  | 'support'
  | 'milestone'
  | 'reconnection'
  | 'conflict'
  | 'other'

export interface MemorySemanticEvidence {
  schemaVersion: 'semantic-evidence.v1'
  interactionType: SemanticInteractionType
  participation: 'direct' | 'indirect'
  direction: 'mutual' | 'outgoing' | 'incoming' | 'unknown'
  evidenceSpans: string[]
  confidence: number
}

export interface MemoryObjectPersonRef {
  id: string
  name: string
  isExisting: boolean
  relationType?: import('../product/contracts').RelationType
  identityLabel?: string
  relationshipDescription?: string
}

export interface MemoryObjectEmotion {
  name: string
  /** 0-100. */
  intensity: number
}

export interface RelationshipSignals {
  /** 0-100. */
  interactionFrequency: number
  /** 0-100. */
  emotionalIntimacy: number
  /** 0-100. 50 = balanced; higher = user-initiated more. */
  initiativeBalance: number
  relationshipChange: RelationshipChange
}

/**
 * The unified shape every memory input (text or chat screenshot) is
 * normalized into after AI analysis, before the user confirms it and it's
 * written into the cosmos. See src/services/aiMemoryService.ts for the
 * (currently mocked) analysis step that produces this.
 */
export interface MemoryObject {
  id: string
  sourceType: MemorySourceType
  rawText: string
  /** Object URL for a chat-screenshot source; empty string for text input. */
  mediaUrl: string
  /** Persisted media attachments rendered as photo/video pages in the memory book. */
  media?: import('../product/contracts').ActivityMedia[]
  people: MemoryObjectPersonRef[]
  /** ISO date string. */
  eventTime: string
  location: string
  eventType: string
  summary: string
  facts: string[]
  emotions: MemoryObjectEmotion[]
  relationshipSignals: RelationshipSignals
  keywords: string[]
  /** AI-generated "cosmos narrative" — the poetic one-liner shown in confirm step. */
  narrative: string
  /** 0-1. */
  confidence: number
  semanticEvidence?: MemorySemanticEvidence | null
  analysisProvider?: string | null
}

export interface ConfirmedMemorySummary extends MemoryObject {
  relationshipId?: string | null
  shared?: boolean
  sharedByUserId?: string | null
  sharedByName?: string | null
}

export interface ConfirmedMemoryListItem {
  id: string
  summary: string
  eventTime: string
  location: string
  eventType: string
  people: MemoryObjectPersonRef[]
  relationshipId: string | null
  currentVersion: number
  syncStatus: string
  createdAt: string
  updatedAt: string
}

export type AnalysisJobStatus =
  | 'created'
  | 'uploading'
  | 'queued'
  | 'processing'
  | 'awaiting_confirmation'
  | 'confirmed'
  | 'failed'
  | 'cancelled'
  | 'expired'

export interface AnalysisJobRecord {
  id: string
  jobType: string
  sourceType: MemorySourceType
  status: AnalysisJobStatus
  attempt: number
  version: number
  provider: string
  inputHash: string
  draftId: string | null
  lastError: string
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export interface MemoryDraftEnvelope {
  id: string
  jobId: string
  relationshipId: string | null
  candidateMemoryId: string
  schemaVersion: string
  candidate: MemoryObject
  status: 'awaiting_confirmation' | 'confirmed' | 'rejected' | 'expired'
  version: number
  confirmedMemoryId: string | null
  expiresAt: string
  createdAt: string
  updatedAt: string
}

export interface MemoryRevisionRecord {
  id: string
  memoryId: string
  version: number
  authorUserId?: string | null
  reason: string
  document: MemoryObject
  createdAt: string
}

export interface MemorySourceRecord {
  id: string
  analysisJobId?: string | null
  draftId?: string | null
  sourceType: MemorySourceType
  sourceOrder: number
  mediaAssetId?: string | null
  agentConversationId?: string | null
  agentMessageId?: string | null
  createdAt: string
}

export interface ConfirmedMemoryDetail {
  memory: MemoryObject
  relationshipId: string | null
  currentVersion: number
  latestRevision: MemoryRevisionRecord | null
  sources: MemorySourceRecord[]
  createdAt: string
  updatedAt: string
  shared?: boolean
  sharedByUserId?: string | null
  readOnly?: boolean
}
