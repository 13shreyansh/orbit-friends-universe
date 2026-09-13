import { MessageCircleMore } from 'lucide-react'
import styles from './AgentChatButton.module.css'

interface AgentChatButtonProps {
  onClick: () => void
}

export function AgentChatButton({ onClick }: AgentChatButtonProps) {
  return (
    <button type="button" className={styles.button} aria-label="Chat with friends" onClick={onClick}>
      <MessageCircleMore size={18} />
      <span>Chat</span>
    </button>
  )
}
