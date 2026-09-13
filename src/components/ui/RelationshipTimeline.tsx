import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useSceneStore } from '../../store/useSceneStore'
import { usePeopleStore } from '../../store/usePeopleStore'
import { getTimelineForPerson } from '../../data/relationshipTimelines'
import { getEmotionalToneColor } from '../../utils/memoryVisuals'
import { RelationshipPlaybackController } from './RelationshipPlaybackController'
import styles from './RelationshipTimeline.module.css'

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

export function RelationshipTimeline() {
  const mode = useSceneStore((state) => state.mode)
  const selectedPersonId = useSceneStore((state) => state.selectedPersonId)
  const timelineIndex = useSceneStore((state) => state.timelineIndex)
  const isPlaying = useSceneStore((state) => state.isTimelinePlaying)
  const setTimelineIndex = useSceneStore((state) => state.setTimelineIndex)
  const stepTimelineIndex = useSceneStore((state) => state.stepTimelineIndex)
  const playTimeline = useSceneStore((state) => state.playTimeline)
  const pauseTimeline = useSceneStore((state) => state.pauseTimeline)
  const returnToPresentTimeline = useSceneStore((state) => state.returnToPresentTimeline)
  const returnToPersonMode = useSceneStore((state) => state.returnToPersonMode)

  const trackRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const people = usePeopleStore((state) => state.people)

  const person = useMemo(
    () => people.find((candidate) => candidate.id === selectedPersonId) ?? null,
    [people, selectedPersonId],
  )
  const timeline = useMemo(
    () => (selectedPersonId ? getTimelineForPerson(selectedPersonId) : []),
    [selectedPersonId],
  )
  const maxIndex = Math.max(0, timeline.length - 1)
  const activeEntry = timelineIndex !== null ? timeline[timelineIndex] : null

  const isOpen = mode === 'timeline' && person !== null && timeline.length > 0

  const indexFromClientX = (clientX: number): number => {
    if (!trackRef.current) return 0
    const rect = trackRef.current.getBoundingClientRect()
    const t = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    return Math.round(t * maxIndex)
  }

  useEffect(() => {
    if (!isDragging) return

    function handlePointerMove(event: PointerEvent) {
      setTimelineIndex(indexFromClientX(event.clientX))
    }
    function handlePointerUp() {
      setIsDragging(false)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDragging, maxIndex])

  const handleTrackPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    setIsDragging(true)
    setTimelineIndex(indexFromClientX(event.clientX))
  }

  return (
    <AnimatePresence>
      {isOpen && person && (
        <>
          <RelationshipPlaybackController />
          <motion.div
            className={styles.wrapper}
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className={styles.header}>
              <div>
                <div className={styles.eventLabel}>{activeEntry ? activeEntry.event : 'Present'}</div>
                <div className={styles.eventDate}>
                  {activeEntry ? formatDate(activeEntry.date) : 'Now'}
                </div>
              </div>
              <button
                type="button"
                className={styles.presentButton}
                onClick={() => returnToPresentTimeline()}
              >
                Return to Present
              </button>
            </div>

            <p className={styles.description}>
              {activeEntry ? activeEntry.description : person.shortDescription}
            </p>

            <div ref={trackRef} className={styles.track} onPointerDown={handleTrackPointerDown}>
              <div className={styles.trackLine} />
              <div
                className={styles.trackProgress}
                style={{
                  width: `${
                    timelineIndex !== null ? (timelineIndex / Math.max(1, maxIndex)) * 100 : 100
                  }%`,
                }}
              />
              {timeline.map((entry, index) => {
                const toneColor = getEmotionalToneColor(entry.emotionalTone)
                const nodeIsActive = timelineIndex === index
                return (
                  <button
                    key={entry.date + entry.event}
                    type="button"
                    className={`${styles.node} ${nodeIsActive ? styles.nodeActive : ''}`}
                    style={{
                      left: `${(index / Math.max(1, maxIndex)) * 100}%`,
                      backgroundColor: toneColor,
                      boxShadow: nodeIsActive
                        ? `0 0 16px 4px ${toneColor}`
                        : `0 0 6px 1px ${toneColor}`,
                    }}
                    onClick={(event) => {
                      event.stopPropagation()
                      setTimelineIndex(index)
                    }}
                    aria-label={entry.event}
                  />
                )
              })}
            </div>

            <div className={styles.controls}>
              <button
                type="button"
                className={styles.controlButton}
                onClick={() => {
                  pauseTimeline()
                  stepTimelineIndex(-1, maxIndex)
                }}
              >
                ⏮ Prev
              </button>
              <button
                type="button"
                className={styles.playButton}
                onClick={() => (isPlaying ? pauseTimeline() : playTimeline(maxIndex))}
              >
                {isPlaying ? 'Pause' : 'Play'}
              </button>
              <button
                type="button"
                className={styles.controlButton}
                onClick={() => {
                  pauseTimeline()
                  stepTimelineIndex(1, maxIndex)
                }}
              >
                Next ⏭
              </button>
              <button
                type="button"
                className={styles.exitButton}
                onClick={() => returnToPersonMode()}
              >
                Exit Timeline
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
