import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useSceneStore } from '../../store/useSceneStore'
import styles from './IntroGuide.module.css'

const SHOW_DELAY_MS = 1400
const VISIBLE_DURATION_MS = 4200

/** A one-time, one-line piece of narrative that appears shortly after the
 * cosmos loads and fades away on its own — never blocks interaction
 * (pointer-events: none throughout) and never reappears once dismissed. */
export function IntroGuide() {
  const isReady = useSceneStore((state) => state.isReady)
  const mode = useSceneStore((state) => state.mode)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!isReady || mode !== 'cosmos') {
      setVisible(false)
      return
    }
    const showTimer = window.setTimeout(() => {
      setVisible(true)
    }, SHOW_DELAY_MS)
    const hideTimer = window.setTimeout(
      () => setVisible(false),
      SHOW_DELAY_MS + VISIBLE_DURATION_MS,
    )
    return () => {
      window.clearTimeout(showTimer)
      window.clearTimeout(hideTimer)
    }
  }, [isReady, mode])

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className={styles.wrapper}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1.1, ease: 'easeOut' }}
        >
          <span className={styles.text}>Every relationship leaves a trace.</span>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
