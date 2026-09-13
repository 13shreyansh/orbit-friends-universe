import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useSceneStore } from '../../store/useSceneStore'
import { usePeopleStore } from '../../store/usePeopleStore'
import { useMemoriesForPerson } from '../../hooks/useMemoriesForPerson'
import { getEmotionalToneColor, getMemoryTypeLabel } from '../../utils/memoryVisuals'
import styles from './MemoryDetail.module.css'

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

/** Height tolerance for the scrollHeight/clientHeight overflow check —
 * sub-pixel rounding can report a 1px "overflow" on text that visually
 * fits perfectly, which would show a "Read more" button with nothing
 * left to reveal. */
const OVERFLOW_TOLERANCE_PX = 1

export function MemoryDetail() {
  const mode = useSceneStore((state) => state.mode)
  const selectedPersonId = useSceneStore((state) => state.selectedPersonId)
  const selectedMemoryId = useSceneStore((state) => state.selectedMemoryId)
  const clearSelectedMemory = useSceneStore((state) => state.clearSelectedMemory)
  const people = usePeopleStore((state) => state.people)
  const memories = useMemoriesForPerson(selectedPersonId)

  const memory = useMemo(() => {
    if (!selectedMemoryId) return null
    return memories.find((item) => item.id === selectedMemoryId) ?? null
  }, [memories, selectedMemoryId])

  const person = useMemo(
    () => people.find((candidate) => candidate.id === selectedPersonId) ?? null,
    [people, selectedPersonId],
  )

  const isOpen = mode === 'memories' && memory !== null
  const fullText = memory ? memory.rawText?.trim() || memory.summary : ''

  const [isExpanded, setIsExpanded] = useState(false)
  const [canExpand, setCanExpand] = useState(false)
  const textRef = useRef<HTMLParagraphElement>(null)

  // Switching to a different memory (or the modal closing and a fresh one
  // opening) should always start collapsed — never carry over the previous
  // memory's expanded state.
  useEffect(() => {
    setIsExpanded(false)
  }, [memory?.id])

  // Real overflow detection: only meaningful while the 4-line clamp is
  // active, since that's what determines whether clientHeight is actually
  // smaller than the text's natural scrollHeight. Re-measures on resize
  // (desktop <-> mobile) and once web fonts finish loading, both of which
  // can change wrapped line count without the text itself changing.
  useLayoutEffect(() => {
    if (!isOpen || isExpanded) return
    const el = textRef.current
    if (!el) return

    const measure = () => {
      setCanExpand(el.scrollHeight - el.clientHeight > OVERFLOW_TOLERANCE_PX)
    }

    measure()

    const resizeObserver = new ResizeObserver(measure)
    resizeObserver.observe(el)

    let cancelled = false
    document.fonts?.ready.then(() => {
      if (!cancelled) measure()
    })

    return () => {
      cancelled = true
      resizeObserver.disconnect()
    }
  }, [isOpen, isExpanded, fullText])

  const handleBackdropClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) clearSelectedMemory()
  }

  return (
    <AnimatePresence>
      {isOpen && memory && (
        <motion.div
          className={styles.backdrop}
          onClick={handleBackdropClick}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
        >
          <motion.div
            className={styles.card}
            initial={{ opacity: 0, scale: 0.94, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 12 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          >
            <button
              type="button"
              className={styles.closeButton}
              onClick={() => clearSelectedMemory()}
              aria-label="Close"
            >
              ×
            </button>

            <div className={styles.image} style={{ background: memory.image }} />

            <div className={styles.body}>
              <div className={styles.metaRow}>
                <span className={styles.typeLabel}>{getMemoryTypeLabel(memory.type)}</span>
                <span className={styles.date}>{formatDate(memory.date)}</span>
              </div>

              <h3 className={styles.title}>{memory.title}</h3>

              <p
                ref={textRef}
                className={isExpanded ? styles.summary : `${styles.summary} ${styles.summaryClamped}`}
              >
                {fullText}
              </p>

              {canExpand && (
                <button
                  type="button"
                  className={styles.expandButton}
                  onClick={() => setIsExpanded((prev) => !prev)}
                  aria-expanded={isExpanded}
                >
                  {isExpanded ? 'Show less' : 'Read more'}
                </button>
              )}

              {person && <p className={styles.attribution}>— with {person.name}</p>}

              <span
                className={styles.toneTag}
                style={{ background: getEmotionalToneColor(memory.emotionalTone) }}
              >
                {memory.emotionalTone}
              </span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
