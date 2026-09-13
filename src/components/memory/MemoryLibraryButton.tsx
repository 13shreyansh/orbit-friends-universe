import { BookHeart } from 'lucide-react'
import styles from './MemoryLibraryButton.module.css'

interface MemoryLibraryButtonProps {
  count: number
  onClick: () => void
}

export function MemoryLibraryButton({ count, onClick }: MemoryLibraryButtonProps) {
  return (
    <button
      type="button"
      className={styles.button}
      aria-label={`Open memory collection, ${count} moments`}
      onClick={onClick}
    >
      <BookHeart size={18} />
      <span>Memories</span>
      <strong>{count}</strong>
    </button>
  )
}
