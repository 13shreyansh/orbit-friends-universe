import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { MemoryFrame } from './MemoryFrame'
import type { PlanetMemory } from './planetMemory'
import styles from './MemorySlideshow.module.css'

const TOTAL_DURATION = 20_000
const EMPTY_DURATION = 2_500
const MIN_ITEM_DURATION = 2_000

export function MemorySlideshow({ memories, friendName, onComplete }: { memories: PlanetMemory[]; friendName: string; onComplete: () => void }) {
  const duration = memories.length ? Math.max(TOTAL_DURATION, memories.length * MIN_ITEM_DURATION) : EMPTY_DURATION
  const perItem = memories.length ? duration / memories.length : duration
  const [elapsed, setElapsed] = useState(0)
  const videoRef = useRef<HTMLVideoElement>(null)
  const completed = useRef(false)
  const finish = useCallback(() => {
    if (completed.current) return
    completed.current = true
    videoRef.current?.pause()
    onComplete()
  }, [onComplete])
  useEffect(() => {
    const started = performance.now()
    const video = videoRef.current
    let frame = 0
    const tick = (now: number) => {
      const next = Math.min(duration, now - started)
      setElapsed(next)
      if (next >= duration) finish()
      else frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(frame); video?.pause() }
  }, [duration, finish])
  const index = memories.length ? Math.min(memories.length - 1, Math.floor(elapsed / perItem)) : 0
  const active = memories[index]
  useEffect(() => {
    const video = videoRef.current
    if (active?.type === 'video' && video) {
      video.currentTime = 0
      void video.play().catch(() => undefined)
    }
    return () => video?.pause()
  }, [active])
  const text = useMemo(() => active?.text?.slice(0, 280), [active])
  const stageStyle = { '--memory-item-duration': `${perItem}ms` } as CSSProperties
  return (
    <section className={styles.overlay} aria-label="Shared memories">
      <div className={styles.ambient} />
      <header><span>Arrived · Planet of {friendName}</span><button type="button" onClick={finish}>Skip memories</button></header>
      <div className={styles.stage} key={active?.id ?? 'empty'} style={stageStyle}>
        {!active && <div className={styles.empty}><span>OUR STORY</span><p>The story of this planet is waiting to be told.</p></div>}
        {active?.type === 'text' && <MemoryFrame type="text"><blockquote>{text}</blockquote></MemoryFrame>}
        {active?.type === 'image' && <MemoryFrame type="image"><img src={active.src} alt={active.fileName ?? 'Shared memory'} /></MemoryFrame>}
        {active?.type === 'video' && <MemoryFrame type="video"><video ref={videoRef} src={active.src} muted autoPlay playsInline preload="auto" /></MemoryFrame>}
      </div>
      <footer><i style={{ transform: `scaleX(${elapsed / duration})` }} /></footer>
    </section>
  )
}
