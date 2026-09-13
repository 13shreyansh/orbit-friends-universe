import { Check } from 'lucide-react'
import type { PersonalityType } from '../../product/contracts'
import { PERSONALITY_CATALOG } from './personalityCatalog'
import styles from './OnboardingFlow.module.css'

interface PersonalitySelectorProps {
  selected: PersonalityType | null
  isZh: boolean
  onSelect: (type: PersonalityType) => void
}

const groupNames = {
  analyst: { zh: 'Analysts', en: 'Analysts' },
  diplomat: { zh: 'Diplomats', en: 'Diplomats' },
  sentinel: { zh: 'Sentinels', en: 'Sentinels' },
  explorer: { zh: 'Explorers', en: 'Explorers' },
}

export function PersonalitySelector({ selected, isZh, onSelect }: PersonalitySelectorProps) {
  return (
    <div className={styles.personalityGroups}>
      {Object.entries(groupNames).map(([group, name]) => (
        <section key={group} className={styles.personalityGroup}>
          <div className={styles.groupLabel}>{isZh ? name.zh : name.en}</div>
          <div className={styles.personalityGrid}>
            {PERSONALITY_CATALOG.filter((item) => item.group === group).map((item) => {
              const active = item.id === selected
              return (
                <button
                  type="button"
                  key={item.id}
                  className={active ? styles.personalityActive : styles.personalityCard}
                  style={{ '--personality-accent': item.accent } as React.CSSProperties}
                  onClick={() => onSelect(item.id)}
                >
                  <span className={styles.personalityCode}>{item.id}</span>
                  <strong>{isZh ? item.name.zh : item.name.en}</strong>
                  <small>{isZh ? item.summary.zh : item.summary.en}</small>
                  {active && <Check className={styles.personalityCheck} size={15} />}
                </button>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}
