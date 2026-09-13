import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useAddMemoryStore, type AddMemoryStep } from '../../store/useAddMemoryStore'
import { useIsNarrowScreen } from '../../hooks/useIsNarrowScreen'
import { InputStep } from './steps/InputStep'
import { LoadingStep } from './steps/LoadingStep'
import { ConfirmStep } from './steps/ConfirmStep'
import styles from './AddMemoryDrawer.module.css'

const STEP_TITLES: Partial<Record<AddMemoryStep, string>> = {
  input: 'Add a memory',
  loading: 'Understanding this memory',
  confirm: 'Review this memory',
}

export function AddMemoryDrawer() {
  const step = useAddMemoryStore((state) => state.step)
  const relationshipContext = useAddMemoryStore((state) => state.relationshipContext)
  const closeDrawer = useAddMemoryStore((state) => state.closeDrawer)
  const isNarrowScreen = useIsNarrowScreen()
  const isOpen = step !== 'closed'

  useEffect(() => {
    if (!isOpen || step === 'loading') return
    const handleKeyDown = (event: KeyboardEvent) => event.key === 'Escape' && closeDrawer()
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [closeDrawer, isOpen, step])

  const motionProps = isNarrowScreen
    ? { initial: { y: '100%', opacity: 0 }, animate: { y: 0, opacity: 1 }, exit: { y: '100%', opacity: 0 } }
    : { initial: { x: 420, opacity: 0 }, animate: { x: 0, opacity: 1 }, exit: { x: 420, opacity: 0 } }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div className={styles.backdrop} onClick={() => step !== 'loading' && closeDrawer()} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          <motion.div
            className={isNarrowScreen ? styles.panelMobile : styles.panel}
            initial={motionProps.initial}
            animate={motionProps.animate}
            exit={motionProps.exit}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className={styles.header}>
              <span>
                <span className={styles.title}>{STEP_TITLES[step]}</span>
                {relationshipContext && (
                  <span className={styles.relationshipContext}>
                    With {relationshipContext.targetName} · Shared memory
                  </span>
                )}
              </span>
              {step !== 'loading' && <button type="button" className={styles.closeButton} onClick={closeDrawer} aria-label="Close">×</button>}
            </div>
            <div className={styles.body}>
              {step === 'input' && <InputStep />}
              {step === 'loading' && <LoadingStep />}
              {step === 'confirm' && <ConfirmStep />}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
