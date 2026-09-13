import { AnimatePresence, motion } from 'framer-motion'
import { useSceneStore } from '../../store/useSceneStore'
import styles from './LoadingScreen.module.css'

/** Covers the screen (in the same background color as the cosmos itself,
 * so there's no color flash) until the Canvas reports ready, then fades
 * out. Deliberately minimal — a single breathing point of light, not a
 * spinner or progress bar. */
export function LoadingScreen() {
  const isReady = useSceneStore((state) => state.isReady)

  return (
    <AnimatePresence>
      {!isReady && (
        <motion.div
          className={styles.screen}
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        >
          <div className={styles.glow} />
          <div className={styles.label}>Entering the cosmos</div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
