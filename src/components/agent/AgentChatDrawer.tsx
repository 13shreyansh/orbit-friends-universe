import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, MessageCircleMore, Send, X } from 'lucide-react'
import { apiClient } from '../../product/api/apiClient'
import { useProductStore } from '../../product/store/useProductStore'
import { useAddMemoryStore } from '../../store/useAddMemoryStore'
import type { DirectConversation, DirectMessage } from '../../types/directChat'
import { formatShanghaiTime } from '../../utils/time'
import styles from './AgentChatDrawer.module.css'

function newClientMessageId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

export function AgentChatDrawer() {
  const open = useAddMemoryStore((state) => state.agentOpen)
  const close = useAddMemoryStore((state) => state.closeAgent)
  const relationships = useProductStore((state) => state.relationships)
  const session = useProductStore((state) => state.session)
  const [conversations, setConversations] = useState<DirectConversation[]>([])
  const [selected, setSelected] = useState<DirectConversation | null>(null)
  const [messages, setMessages] = useState<DirectMessage[]>([])
  const [messageCursor, setMessageCursor] = useState<string | null>(null)
  const [messageInput, setMessageInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const messagesRef = useRef<HTMLDivElement>(null)

  const refreshConversations = useCallback(async () => {
    const page = await apiClient.listDirectConversations()
    setConversations(page.items)
  }, [])

  useEffect(() => {
    if (!open) return
    setError('')
    setLoading(true)
    void refreshConversations()
      .catch((cause) => setError((cause as Error).message))
      .finally(() => setLoading(false))
  }, [open, refreshConversations])

  useEffect(() => {
    if (!open || !selected?.conversationId) return
    let active = true
    setLoading(true)
    setError('')
    void apiClient.listDirectMessages(selected.conversationId, { limit: 80 })
      .then((page) => {
        if (!active) return
        setMessages(page.items)
        setMessageCursor(page.nextCursor)
        void apiClient.markDirectConversationRead(selected.conversationId!)
          .then((updated) => setConversations((current) => current.map((item) => item.targetUserId === updated.targetUserId ? updated : item)))
          .catch(() => undefined)
      })
      .catch((cause) => {
        if (active) setError((cause as Error).message)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [open, selected?.conversationId])

  useEffect(() => {
    const node = messagesRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [messages, selected?.conversationId])

  if (!open) return null

  const openFriend = async (conversation: DirectConversation) => {
    setError('')
    if (conversation.conversationId) {
      setSelected(conversation)
      return
    }
    setBusy(true)
    try {
      const created = await apiClient.createDirectConversation(conversation.targetUserId)
      setConversations((current) => current.map((item) => item.targetUserId === created.targetUserId ? created : item))
      setSelected(created)
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const sendMessage = async (event: FormEvent) => {
    event.preventDefault()
    if (!selected?.conversationId || !messageInput.trim() || busy) return
    const content = messageInput.trim()
    setBusy(true)
    setError('')
    const optimistic: DirectMessage = {
      id: newClientMessageId(),
      conversationId: selected.conversationId,
      senderUserId: session?.userId ?? 'self',
      senderName: 'Me',
      content,
      status: 'sending',
      mine: true,
      createdAt: new Date().toISOString(),
    }
    setMessages((current) => [...current, optimistic])
    setMessageInput('')
    try {
      const accepted = await apiClient.sendDirectMessage(selected.conversationId, {
        clientMessageId: optimistic.id,
        content,
      })
      setMessages((current) => current.map((item) => item.id === optimistic.id ? accepted.message : item))
      await refreshConversations()
    } catch (cause) {
      setMessages((current) => current.filter((item) => item.id !== optimistic.id))
      setMessageInput(content)
      setError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const loadMore = async () => {
    if (!selected?.conversationId || !messageCursor || loading) return
    setLoading(true)
    try {
      const page = await apiClient.listDirectMessages(selected.conversationId, { cursor: messageCursor, limit: 80 })
      setMessages((current) => [...page.items, ...current.filter((item) => !page.items.some((incoming) => incoming.id === item.id))])
      setMessageCursor(page.nextCursor)
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const friends = conversations.length > 0 ? conversations : relationships.map((relationship) => ({
    conversationId: null,
    targetUserId: relationship.targetUserId,
    targetName: relationship.targetName,
    targetBio: relationship.description,
    targetPlanetId: relationship.targetPlanetId,
    lastMessagePreview: '',
    lastMessageAt: null,
    unreadCount: 0,
    createdAt: null,
    updatedAt: null,
  }))

  return (
    <>
      <button type="button" className={styles.backdrop} aria-label="Close chat" onClick={close} />
      <aside className={styles.panel} aria-label="Chat with friends">
        <header className={styles.header}>
          {selected && <button type="button" aria-label="Back to friends" onClick={() => { setSelected(null); setMessages([]) }}><ArrowLeft size={17} /></button>}
          <div><span>Friends</span><h2>{selected?.targetName ?? 'Chat'}</h2></div>
          <button type="button" aria-label="Close chat" onClick={close}><X size={17} /></button>
        </header>
        {error && <p className={styles.error}>{error}</p>}

        {!selected && (
          <div className={styles.conversationHome}>
            <p className={styles.intro}>Catch up with a friend. Your conversations become part of your shared story.</p>
            <div className={styles.conversationList}>
              {!loading && friends.length === 0 && <p className={styles.empty}>No friends yet. Explore the galaxy and meet someone.</p>}
              {friends.map((conversation) => (
                <button type="button" key={conversation.targetUserId} onClick={() => void openFriend(conversation)} disabled={busy}>
                  <span className={styles.friendGlyph}><MessageCircleMore size={17} /></span>
                  <span><strong>{conversation.targetName}</strong><small>{conversation.lastMessagePreview || conversation.targetBio || 'Start a conversation'}</small></span>
                  {conversation.unreadCount > 0 && <em>{conversation.unreadCount}</em>}
                </button>
              ))}
              {loading && <p className={styles.empty}>Loading friends…</p>}
            </div>
          </div>
        )}

        {selected && (
          <div className={styles.chat}>
            <div className={styles.friendMeta}><strong>{selected.targetName}</strong><span>{selected.targetBio || 'Your friend'}</span></div>
            <div className={styles.messages} ref={messagesRef} aria-live="polite">
              {messageCursor && <button type="button" className={styles.moreButton} onClick={() => void loadMore()}>Earlier messages</button>}
              {messages.length === 0 && !loading && <p className={styles.empty}>No messages yet. Say hello.</p>}
              {messages.map((message) => (
                <article key={message.id} className={message.mine ? styles.userMessage : styles.friendMessage}>
                  <span>{message.mine ? 'Me' : message.senderName} · {message.status === 'sending' ? 'Sending…' : formatShanghaiTime(message.createdAt, 'en-US', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}</span>
                  <p>{message.content}</p>
                </article>
              ))}
              {loading && <p className={styles.empty}>Loading messages…</p>}
            </div>
            <form className={styles.composer} onSubmit={sendMessage}>
              <textarea aria-label="Send message" rows={3} maxLength={20000} placeholder={`Message ${selected.targetName}`} value={messageInput} onChange={(event) => setMessageInput(event.target.value)} />
              <button type="submit" disabled={busy || !messageInput.trim()} aria-label="Send message"><Send size={17} /></button>
            </form>
          </div>
        )}
      </aside>
    </>
  )
}
