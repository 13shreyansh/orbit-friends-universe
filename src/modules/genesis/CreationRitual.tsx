import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SkipForward } from 'lucide-react'
import type { PlanetVisualConfig } from '../../product/contracts'
import { useI18n } from '../../product/i18n'
import { AuthGalaxy, type AuthVisualPhase } from '../auth/AuthGalaxy'
import { GENESIS_FORMATION_DURATION_MS } from './GenesisSequence'
import styles from './GenesisSequence.module.css'

interface CreationRitualProps {
  config: PlanetVisualConfig
  planetName: string
  onComplete: () => void
}

const COLLAPSE_START_MS = 1400
const SINGULARITY_VISIBLE_MS = 2900
const FORMATION_START_MS = 3800
const PLANET_FORMING_MS = 6500
const MIN_RITUAL_DURATION_MS = FORMATION_START_MS + GENESIS_FORMATION_DURATION_MS

export function CreationRitual({ config, planetName, onComplete }: CreationRitualProps) {
  const { t } = useI18n()
  const [phase, setPhase] = useState<AuthVisualPhase>('idle')
  const [stage, setStage] = useState(0)
  const completedRef = useRef(false)
  const startedAtRef = useRef(performance.now())
  const completionTimerRef = useRef<number | null>(null)

  const finish = useCallback(() => {
    if (completedRef.current) return
    completedRef.current = true
    onComplete()
  }, [onComplete])

  const finishFormation = useCallback(() => {
    const remaining = MIN_RITUAL_DURATION_MS - (performance.now() - startedAtRef.current)
    if (remaining <= 0) {
      finish()
      return
    }
    completionTimerRef.current = window.setTimeout(finish, remaining)
  }, [finish])

  useEffect(() => {
    const timers = [
      window.setTimeout(() => {
        setPhase('collapse')
        setStage(1)
      }, COLLAPSE_START_MS),
      window.setTimeout(() => setStage(2), SINGULARITY_VISIBLE_MS),
      window.setTimeout(() => {
        setPhase('formation')
        setStage(3)
      }, FORMATION_START_MS),
      window.setTimeout(() => setStage(4), PLANET_FORMING_MS),
    ]
    return () => {
      timers.forEach(window.clearTimeout)
      if (completionTimerRef.current !== null) window.clearTimeout(completionTimerRef.current)
    }
  }, [])

  const labels = useMemo(() => [
    t('genesis.blackHoleWaiting'),
    t('genesis.eventHorizonCollapse'),
    t('genesis.singularityStable'),
    t('genesis.bigBang'),
    t('genesis.takingForm', { name: planetName }),
  ], [planetName, t])

  return (
    <main className={styles.screen}>
      <AuthGalaxy
        phase={phase}
        formationConfig={config}
        onFormationComplete={finishFormation}
        formationIgnitionProgress={0.18}
      />
      <div className={styles.status} aria-live="polite">
        <span>{t('auth.genesis')} / {String(stage + 1).padStart(2, '0')}</span>
        <p>{labels[stage]}</p>
        <div className={styles.ritualTimeline} aria-hidden="true">
          {labels.map((_, index) => (
            <i key={index} className={index <= stage ? styles.ritualActive : undefined} />
          ))}
        </div>
      </div>
      <button type="button" className={styles.skip} onClick={finish}>
        <SkipForward size={15} />
        {t('auth.skipFormation')}
      </button>
    </main>
  )
}
