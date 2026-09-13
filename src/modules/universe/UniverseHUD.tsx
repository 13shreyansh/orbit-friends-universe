import { ArrowLeft, Orbit, RotateCcw, Users } from 'lucide-react'
import type { SocialPlanet, UniverseScale } from '../../product/contracts'
import styles from './UniverseHUD.module.css'

interface UniverseHUDProps {
  activePlanet: SocialPlanet
  selfPlanet: SocialPlanet
  scale: UniverseScale
  nebulaName?: string
  returnLabel?: string
  onScaleChange: (scale: UniverseScale) => void
  onResetView: () => void
  onOpenRelationship: () => void
  onOpenActivity: () => void
  onOpenData: () => void
  onOpenNebulaMembers: () => void
  onOpenProfile: () => void
  profileIncomplete?: boolean
  onReturnHome: () => void
  onSignOut: () => void
}

export function UniverseHUD({activePlanet,selfPlanet,scale,onScaleChange,onResetView,onReturnHome,onSignOut}: UniverseHUDProps) {
  const away = activePlanet.id !== selfPlanet.id
  const first = selfPlanet.ownerName.split(' ')[0]
  return <>
    <header className={styles.header}>
      <div className={styles.brand}><Orbit size={23} color="#efc99a"/><div><strong>THE FRIENDS UNIVERSE</strong><small>Through {first}’s eyes</small></div></div>
      <div className={styles.tools}>
        <button type="button" onClick={onResetView} aria-label="Reset view" title="Reset view"><RotateCcw size={16}/></button>
        <button type="button" className={styles.perspective} onClick={onSignOut}><Users size={15}/><span>Change perspective</span></button>
      </div>
    </header>
    {away ? <button className={styles.backUniverse} onClick={onReturnHome}><ArrowLeft size={15}/> Back to your universe</button> : scale !== 'galaxy' ? <button className={styles.backUniverse} onClick={()=>onScaleChange('galaxy')}><Orbit size={15}/> Explore your universe</button> : <div className={styles.demoHint}><span>YOU ARE {first.toUpperCase()}</span><strong>Five people. A world of shared memories.</strong><small>Drag to explore · Select a friend to open your story</small></div>}
  </>
}
