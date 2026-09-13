import { ChevronDown, ChevronUp, Pause, Play, Trash2, Volume2, VolumeX } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { MemoryFrame } from './MemoryFrame'
import type { PlanetMemory } from './planetMemory'
import styles from './PlanetMemoryInput.module.css'

export function PlanetMemoryCard({ memory, onRemove }: { memory: PlanetMemory; onRemove: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  useEffect(() => () => { videoRef.current?.pause() }, [])
  const togglePlayback = () => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) void video.play().catch(() => setPlaying(false))
    else video.pause()
  }
  const toggleMuted = () => {
    const video = videoRef.current
    if (!video) return
    video.muted = !video.muted
  }
  return (
    <article className={styles.card}>
      <MemoryFrame type={memory.type} compact>
        {memory.type === 'text' && <p className={expanded ? styles.expanded : styles.clamped}>{memory.text}</p>}
        {memory.type === 'image' && <img src={memory.src} alt={memory.fileName ?? 'Shared memory'} />}
        {memory.type === 'video' && (
          <div className={styles.videoPreview}>
            <video
              ref={videoRef}
              src={memory.src}
              muted={muted}
              playsInline
              preload="metadata"
              onClick={togglePlayback}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => setPlaying(false)}
              onVolumeChange={(event) => setMuted(event.currentTarget.muted)}
            />
            <div className={styles.videoControls}>
              <button type="button" onClick={togglePlayback} aria-label={playing ? 'Pause video' : 'Play video'}>
                {playing ? <Pause size={13} /> : <Play size={13} />}
              </button>
              <button type="button" onClick={toggleMuted} aria-label={muted ? 'Unmute' : 'Mute video'}>
                {muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
              </button>
            </div>
          </div>
        )}
      </MemoryFrame>
      <footer>
        {memory.type === 'text' && (memory.text?.length ?? 0) > 90 && (
          <button type="button" onClick={() => setExpanded((value) => !value)}>
            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}{expanded ? 'Show less' : 'Read more'}
          </button>
        )}
        <button type="button" className={styles.remove} onClick={onRemove} aria-label="Delete memory"><Trash2 size={13} /></button>
      </footer>
    </article>
  )
}
