import type { CSSProperties } from 'react'
import { backgroundSkinModule } from './backgroundSkinModule'
import styles from './UniverseBackground.module.css'

interface UniverseBackgroundProps {
  skinId?: string | null
  className?: string
}

export function UniverseBackground({ skinId, className }: UniverseBackgroundProps) {
  const skin = backgroundSkinModule.resolve(skinId)
  const rootClassName = className ? `${styles.root} ${className}` : styles.root
  const rootStyle = {
    background: skin.fallback,
    '--background-overlay': skin.overlay,
  } as CSSProperties

  return (
    <div className={rootClassName} style={rootStyle} data-background-skin={skin.id} aria-hidden="true">
      {skin.media.type === 'video' && skin.media.src && (
        <video
          key={skin.id}
          className={styles.media}
          src={skin.media.src}
          style={{ opacity: skin.media.opacity }}
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
        />
      )}
      {skin.media.type === 'image' && skin.media.src && (
        <img className={styles.media} src={skin.media.src} style={{ opacity: skin.media.opacity }} alt="" />
      )}
      <div className={styles.overlay} />
    </div>
  )
}
