import { ChevronLeft, ChevronRight, PenLine } from 'lucide-react'
import type { PageDirection } from '../types'
import styles from '../MemoryBook.module.css'

interface MemoryBookControlsProps {
  currentPage: number
  totalPages: number
  chapterLabel: string
  disabled: boolean
  canPrevious: boolean
  canNext: boolean
  onTurn: (direction: PageDirection) => void
  onAddMemory?: () => void
  friendName?: string
}

export function MemoryBookControls({
  currentPage,
  totalPages,
  chapterLabel,
  disabled,
  canPrevious,
  canNext,
  onTurn,
  onAddMemory,
  friendName,
}: MemoryBookControlsProps) {
  return (
    <div className={styles.bookmark}>
      <span className={styles.chapterLabel}>{chapterLabel}</span>
      <nav className={styles.controls} aria-label="Memory book pages">
        <button
          type="button"
          disabled={disabled || !canPrevious}
          onClick={() => onTurn('previous')}
          aria-label="Previous page"
        >
          <ChevronLeft size={14} />
        </button>
        <span>{Math.min(currentPage + 1, totalPages)} / {totalPages}</span>
        <button
          type="button"
          disabled={disabled || !canNext}
          onClick={() => onTurn('next')}
          aria-label="Next page"
        >
          <ChevronRight size={14} />
        </button>
      </nav>
      {onAddMemory && (
        <button type="button" className={styles.writeMemoryButton} onClick={onAddMemory}>
          <PenLine size={12} />
          <span>Add a memory with {friendName || 'your friend'}</span>
        </button>
      )}
    </div>
  )
}
