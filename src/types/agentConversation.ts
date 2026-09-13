export type ConversationStatus = 'active' | 'archived'
export type AgentMessageStatus = 'pending' | 'completed' | 'failed' | 'cancelled'
export type AgentRunStatus = 'queued' | 'retrieving' | 'generating' | 'completed' | 'failed' | 'cancelled'
export type AgentFeedbackRating = 'helpful' | 'inaccurate' | 'unsafe'

export interface AgentConversation {
  id: string
  title: string
  mode: 'memory_companion'
  relationshipId: string | null
  status: ConversationStatus
  lastMessageAt: string | null
  createdAt: string
  updatedAt: string
}

export interface MemoryCitation {
  memoryId: string
  summary: string
  eventTime: string
}

export interface MemoryProposal {
  draftId: string
  status: string
  summary: string
}

export interface AgentMessage {
  id: string
  conversationId: string
  role: 'user' | 'assistant'
  status: AgentMessageStatus
  content: string
  citations: MemoryCitation[]
  memoryProposal: MemoryProposal | null
  createdAt: string
}

export interface AgentRun {
  id: string
  conversationId: string
  userMessageId: string
  assistantMessageId: string
  status: AgentRunStatus
  provider: string
  retrievalDegraded: boolean
  lastError: string
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export interface AgentMessageAccepted {
  message: AgentMessage
  run: AgentRun
}

export interface AgentFeedback {
  messageId: string
  rating: AgentFeedbackRating
  comment: string
  createdAt: string
  updatedAt: string
}

export interface CursorPage<T> {
  items: T[]
  nextCursor: string | null
}

export type AgentRunEventName =
  | 'run.started'
  | 'retrieval.completed'
  | 'assistant.delta'
  | 'citation.added'
  | 'memory.proposal'
  | 'run.completed'
  | 'run.failed'
  | 'run.cancelled'

export interface AgentRunEvent {
  id: number
  event: AgentRunEventName
  data: Record<string, unknown>
}
