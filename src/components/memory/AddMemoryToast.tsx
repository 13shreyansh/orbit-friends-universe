import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useAddMemoryStore } from '../../store/useAddMemoryStore'
import styles from './AddMemoryToast.module.css'

const VISIBLE_DURATION_MS = 3600

export function AddMemoryToast() {
  const toastMessage = useAddMemoryStore((state) => state.toastMessage)
  const clearToast = useAddMemoryStore((state) => state.clearToast)

  useEffect(() => {
    if (!toastMessage) return
    const timer = window.setTimeout(() => clearToast(), VISIBLE_DURATION_MS)
    return () => window.clearTimeout(timer)
  }, [toastMessage, clearToast])

  return (
    <AnimatePresence>
      {toastMessage && (
        <motion.div
          className={styles.wrapper}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        >
          <span className={styles.dot} />
          <span className={styles.text}>{toastMessage}</span>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
