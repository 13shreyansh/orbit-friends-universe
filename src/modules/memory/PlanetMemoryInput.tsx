import { PenLine } from 'lucide-react'
import styles from './PlanetMemoryInput.module.css'

interface PlanetMemoryInputProps {
  targetName: string
  onAddMemory?: () => void
}

export function PlanetMemoryInput({ targetName, onAddMemory }: PlanetMemoryInputProps) {
  return (
    <section className={styles.memoryBox}>
      <header className={styles.memoryHeader}>
        <span><strong>Our shared memories</strong><small>A LIFE IN ORBIT</small></span>
        <p>Keep a moment with {targetName}. Shared experiences become part of your universe.</p>
      </header>
      <div className={styles.actions}>
        <button type="button" disabled={!onAddMemory} onClick={onAddMemory}>
          <PenLine size={14} />
          {onAddMemory ? 'Add a shared memory' : 'Connect to add a memory'}
        </button>
      </div>
    </section>
  )
}
