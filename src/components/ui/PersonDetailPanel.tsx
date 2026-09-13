import { useEffect, useMemo } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useSceneStore } from '../../store/useSceneStore'
import { usePeopleStore } from '../../store/usePeopleStore'
import { getRelationColor } from '../../utils/relationshipVisuals'
import { useIsNarrowScreen } from '../../hooks/useIsNarrowScreen'
import type { RelationType, RelationshipStatus } from '../../types/person'
import styles from './PersonDetailPanel.module.css'

const RELATION_LABELS: Record<RelationType, string> = {
  family: 'Family',
  friend: 'Friend',
  colleague: 'Colleague',
  classmate: 'Classmate',
  past: 'Past connection',
}

const STATUS_LABELS: Record<RelationshipStatus, string> = {
  active: 'Active',
  dormant: 'Dormant',
  faded: 'Faded',
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function PersonDetailPanel() {
  const mode = useSceneStore((state) => state.mode)
  const selectedPersonId = useSceneStore((state) => state.selectedPersonId)
  const clearSelectedPersonId = useSceneStore((state) => state.clearSelectedPersonId)
  const enterMemories = useSceneStore((state) => state.enterMemories)
  const enterTimeline = useSceneStore((state) => state.enterTimeline)
  const startPlanetVisit = useSceneStore((state) => state.startPlanetVisit)
  const navigateBack = useSceneStore((state) => state.navigateBack)
  const isNarrowScreen = useIsNarrowScreen()
  const people = usePeopleStore((state) => state.people)

  const selectedPerson = useMemo(
    () => people.find((person) => person.id === selectedPersonId) ?? null,
    [people, selectedPersonId],
  )

  const isOpen = mode === 'person' && selectedPerson !== null

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') navigateBack()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [navigateBack])

  const motionProps = isNarrowScreen
    ? {
        initial: { y: '100%', opacity: 0 },
        animate: { y: 0, opacity: 1 },
        exit: { y: '100%', opacity: 0 },
      }
    : {
        initial: { x: 48, opacity: 0 },
        animate: { x: 0, opacity: 1 },
        exit: { x: 48, opacity: 0 },
      }

  return (
    <AnimatePresence>
      {isOpen && selectedPerson && (
        <motion.div
          key={selectedPerson.id}
          className={isNarrowScreen ? styles.panelMobile : styles.panel}
          initial={motionProps.initial}
          animate={motionProps.animate}
          exit={motionProps.exit}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        >
          <button
            type="button"
            className={styles.closeButton}
            onClick={() => clearSelectedPersonId()}
            aria-label="Close"
          >
            ×
          </button>

          <div className={styles.header}>
            <span
              className={styles.relationDot}
              style={{ background: getRelationColor(selectedPerson.relationType) }}
            />
            <span className={styles.relationLabel}>
              {RELATION_LABELS[selectedPerson.relationType]}
            </span>
          </div>

          <h2 className={styles.name}>{selectedPerson.name}</h2>
          <p className={styles.description}>{selectedPerson.shortDescription}</p>

          <div className={styles.metrics}>
            <div className={styles.metricRow}>
              <span className={styles.metricLabel}>Intimacy</span>
              <span className={styles.metricValue}>{selectedPerson.intimacy}</span>
            </div>
            <div className={styles.metricBarTrack}>
              <div
                className={styles.metricBarFill}
                style={{ width: `${selectedPerson.intimacy}%` }}
              />
            </div>

            <div className={styles.metricRow}>
              <span className={styles.metricLabel}>Shared memories</span>
              <span className={styles.metricValue}>{selectedPerson.memoryCount}</span>
            </div>

            <div className={styles.metricRow}>
              <span className={styles.metricLabel}>Last interaction</span>
              <span className={styles.metricValue}>
                {formatDate(selectedPerson.lastInteraction)}
              </span>
            </div>

            <div className={styles.metricRow}>
              <span className={styles.metricLabel}>Status</span>
              <span className={styles.metricValue}>
                {STATUS_LABELS[selectedPerson.status]}
              </span>
            </div>
          </div>

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.visitButton}
              onClick={() => startPlanetVisit()}
            >
              <span className={styles.visitIcon} aria-hidden="true" />
              Visit this planet
            </button>
            <button type="button" className={styles.actionButton} onClick={() => enterMemories()}>
              Explore Memories
            </button>
            <button type="button" className={styles.actionButton} onClick={() => enterTimeline()}>
              View Relationship Timeline
            </button>
            <button
              type="button"
              className={styles.returnButton}
              onClick={() => clearSelectedPersonId()}
            >
              Return to Cosmos
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
