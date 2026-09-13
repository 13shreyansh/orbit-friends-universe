import { SkipForward } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import styles from './UniverseTextPrelude.module.css'

export function UniverseTextPrelude({ isZh, onComplete }: { isZh: boolean; onComplete: () => void }) {
  const lines = isZh
    ? ['Every world begins with an encounter.', 'Every relationship deserves a universe of its own.', 'Now, let us begin this journey…']
    : ['Every world begins with an encounter.', 'Every relationship deserves a universe of its own.', 'Now, let us begin this journey…']
  const [lineIndex, setLineIndex] = useState(0)
  const text = lines[lineIndex]
  const [characterCount, setCharacterCount] = useState(0)
  const [leaving, setLeaving] = useState(false)
  const completedRef = useRef(false)
  const completeRef = useRef(onComplete)
  completeRef.current = onComplete
  const finish = useCallback(() => {
    if (completedRef.current) return
    completedRef.current = true
    completeRef.current()
  }, [])

  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reducedMotion) {
      setCharacterCount(text.length)
      const timer = window.setTimeout(() => {
        if (lineIndex === lines.length - 1) finish()
        else {
          setLineIndex((value) => value + 1)
          setCharacterCount(0)
        }
      }, 1550)
      return () => window.clearTimeout(timer)
    }
    if (characterCount < text.length) {
      const timer = window.setTimeout(() => setCharacterCount((value) => value + 1), isZh ? 68 : 38)
      return () => window.clearTimeout(timer)
    }
    const leaveTimer = window.setTimeout(() => setLeaving(true), 1150)
    const completeTimer = window.setTimeout(() => {
      if (lineIndex === lines.length - 1) finish()
      else {
        setLineIndex((value) => value + 1)
        setCharacterCount(0)
        setLeaving(false)
      }
    }, 1750)
    return () => {
      window.clearTimeout(leaveTimer)
      window.clearTimeout(completeTimer)
    }
  }, [characterCount, finish, isZh, lineIndex, lines.length, text])

  return (
    <main className={`${styles.screen} ${leaving ? styles.leaving : ''}`}>
      <div className={styles.stars} aria-hidden="true" />
      <div className={styles.nebula} aria-hidden="true" />
      <div className={styles.vignette} aria-hidden="true" />
      <div className={styles.copy} aria-live="polite">
        <p>{text.slice(0, characterCount)}{characterCount < text.length && <i aria-hidden="true" />}</p>
      </div>
      <button type="button" className={styles.skip} onClick={finish}><SkipForward size={15} />{isZh ? 'Enter coordinate guide' : 'Enter coordinate guide'}</button>
      <div className={styles.dissolve} aria-hidden="true" />
    </main>
  )
}
