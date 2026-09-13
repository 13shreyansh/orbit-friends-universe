export interface DirectConversation {
  conversationId: string | null
  targetUserId: string
  targetName: string
  targetBio: string
  targetPlanetId: string | null
  lastMessagePreview: string
  lastMessageAt: string | null
  unreadCount: number
  createdAt: string | null
  updatedAt: string | null
}

export interface DirectMessage {
  id: string
  conversationId: string
  senderUserId: string
  senderName: string
  content: string
  status: string
  mine: boolean
  createdAt: string
}

export interface DirectMessageAccepted {
  message: DirectMessage
  analysis: { status: string }
}
