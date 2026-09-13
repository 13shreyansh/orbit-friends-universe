import { useEffect, useRef } from 'react'
import type { MemoryPage } from '../types'
import styles from '../MemoryBook.module.css'

interface MemoryMediaProps {
  page: MemoryPage
  active: boolean
}

export function MemoryMedia({ page, active }: MemoryMediaProps) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (active) {
      video.currentTime = 0
      void video.play().catch(() => undefined)
    } else {
      video.pause()
      video.currentTime = 0
    }
    return () => {
      video.pause()
      video.currentTime = 0
    }
  }, [active, page.id])

  if (!page.mediaUrl) return null

  return (
    <div className={styles.media}>
      {page.type === 'photo' && (
        <img src={page.mediaUrl} alt={page.fileName ?? page.title ?? 'Shared memories'} />
      )}
      {page.type === 'video' && (
        <video
          ref={videoRef}
          src={page.mediaUrl}
          muted
          autoPlay={active}
          playsInline
          preload="metadata"
        />
      )}
      <div className={styles.mediaVignette} aria-hidden="true" />
      <div className={styles.mediaDust} aria-hidden="true" />
      {page.type === 'video' && <span className={styles.mutedBadge}>Playing muted</span>}
    </div>
  )
}
