import type { CSSProperties, ReactNode } from 'react'
import { getMemoryFrameStyle } from './memoryFrameConfig'
import styles from './MemoryFrame.module.css'

interface MemoryFrameProps {
  children: ReactNode
  type: 'text' | 'image' | 'video'
  compact?: boolean
  className?: string
  style?: CSSProperties
}

export function MemoryFrame({ children, type, compact = false, className, style }: MemoryFrameProps) {
  const classNames = [
    styles.frame,
    styles[type],
    compact ? styles.compact : styles.showcase,
    className,
  ].filter(Boolean).join(' ')

  return (
    <div className={classNames} data-memory-frame={type} style={{ ...getMemoryFrameStyle(), ...style }}>
      <div className={styles.energyField} aria-hidden="true" />
      <div className={styles.shell}>
        <div className={styles.content}>{children}</div>
        <div className={styles.innerVignette} aria-hidden="true" />
        <div className={styles.stardust} aria-hidden="true" />
      </div>
    </div>
  )
}
