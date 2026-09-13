import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useAddMemoryStore } from '../../store/useAddMemoryStore'
import styles from './AddMemoryButton.module.css'

export function AddMemoryButton() {
  const step = useAddMemoryStore((state) => state.step)
  const openDrawer = useAddMemoryStore((state) => state.openDrawer)
  const [hovered, setHovered] = useState(false)

  return (
    <AnimatePresence>
      {step === 'closed' && (
        <motion.div
          className={styles.wrapper}
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        >
          <AnimatePresence>
            {hovered && (
              <motion.div className={styles.tooltip} initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 6 }}>
                Add a memory
              </motion.div>
            )}
          </AnimatePresence>
          <button
            type="button"
            className={styles.button}
            aria-label="Add a memory"
            onClick={() => openDrawer()}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onFocus={() => setHovered(true)}
            onBlur={() => setHovered(false)}
          >
            <span className={styles.glow} />
            <span className={styles.plus}>+</span>
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
