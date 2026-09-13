import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useSceneStore } from '../../store/useSceneStore'
import { usePeopleStore } from '../../store/usePeopleStore'
import styles from './CometRideControls.module.css'

export function CometRideControls() {
  const mode = useSceneStore((state) => state.mode)
  const selectedPersonId = useSceneStore((state) => state.selectedPersonId)
  const cancelPlanetVisit = useSceneStore((state) => state.cancelPlanetVisit)
  const people = usePeopleStore((state) => state.people)
  const isRiding = mode === 'cometRide'
  const destination = people.find((person) => person.id === selectedPersonId) ?? null

  useEffect(() => {
    if (!isRiding) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancelPlanetVisit()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [cancelPlanetVisit, isRiding])

  return (
    <AnimatePresence mode="wait">
      {isRiding ? (
        <motion.div
          key="ride"
          className={styles.rideHud}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.45 }}
        >
          <div className={styles.routeInfo}>
            <span className={styles.routeLabel}>PLANET VISIT</span>
            <span className={styles.routeName}>
              Home → {destination?.name ?? 'Friend'}
            </span>
          </div>
          <button
            type="button"
            className={styles.exitButton}
            onClick={() => cancelPlanetVisit()}
          >
            Cancel trip
          </button>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
