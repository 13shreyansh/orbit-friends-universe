import { ImagePlus, MessageSquareText, Sparkles, Video } from 'lucide-react'
import { MemoryFrame } from './MemoryFrame'
import styles from './PlanetMemoryInput.module.css'

export type MemoryDraftKind = 'text' | 'image' | 'video'

interface MemoryDraftEditorProps {
  kind: MemoryDraftKind
  text: string
  previewUrl: string | null
  fileName: string | null
  onTextChange: (value: string) => void
  onCancel: () => void
  onSave: () => void
}

const labels: Record<MemoryDraftKind, { eyebrow: string; title: string }> = {
  text: { eyebrow: 'ORBITAL NOTE', title: 'Write a shared memory' },
  image: { eyebrow: 'STELLAR FRAGMENT', title: 'Review this photo memory' },
  video: { eyebrow: 'LIVING MEMORY', title: 'Review this video memory' },
}

export function MemoryDraftEditor({
  kind,
  text,
  previewUrl,
  fileName,
  onTextChange,
  onCancel,
  onSave,
}: MemoryDraftEditorProps) {
  const valid = kind === 'text' ? text.trim().length > 0 : Boolean(previewUrl)
  const Icon = kind === 'text' ? MessageSquareText : kind === 'image' ? ImagePlus : Video

  return (
    <div className={styles.draftEditor} data-memory-draft={kind}>
      <header className={styles.draftHeader}>
        <Icon size={14} />
        <span><small>{labels[kind].eyebrow}</small><strong>{labels[kind].title}</strong></span>
      </header>

      {kind === 'text' && (
        <textarea
          autoFocus
          rows={5}
          value={text}
          onChange={(event) => onTextChange(event.target.value)}
          placeholder={'For example: Summer 2025,\nwe explored West Lake in Hangzhou together.'}
        />
      )}

      {kind === 'image' && previewUrl && (
        <MemoryFrame type="image" compact className={styles.draftFrame}>
          <img src={previewUrl} alt={fileName ?? 'Shared memory to save'} />
        </MemoryFrame>
      )}

      {kind === 'video' && previewUrl && (
        <MemoryFrame type="video" compact className={styles.draftFrame}>
          <video src={previewUrl} autoPlay muted loop playsInline preload="metadata" />
        </MemoryFrame>
      )}

      {fileName && <p className={styles.fileName}>{fileName}</p>}

      <div className={styles.draftActions}>
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="button" disabled={!valid} onClick={onSave}>
          <Sparkles size={12} />
          Save to Memory Book
        </button>
      </div>
    </div>
  )
}
