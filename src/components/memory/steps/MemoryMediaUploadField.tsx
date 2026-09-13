import { useRef, type ChangeEvent } from 'react'
import { useAddMemoryStore } from '../../../store/useAddMemoryStore'
import styles from './ImageUploadField.module.css'

interface MemoryMediaUploadFieldProps {
  kind: 'photo' | 'video'
}

export function MemoryMediaUploadField({ kind }: MemoryMediaUploadFieldProps) {
  const file = useAddMemoryStore((state) => state.imageFile)
  const previewUrl = useAddMemoryStore((state) => state.imagePreviewUrl)
  const error = useAddMemoryStore((state) => state.imageError)
  const setFile = useAddMemoryStore((state) => state.setImageFile)
  const clearFile = useAddMemoryStore((state) => state.clearImage)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    setFile(event.target.files?.[0] ?? null)
    event.target.value = ''
  }

  const accept = kind === 'photo'
    ? 'image/png,image/jpeg,image/webp,image/gif'
    : 'video/mp4,video/webm,video/quicktime,video/x-m4v'
  const title = kind === 'photo' ? 'Choose a shared photo' : 'Choose a shared video'
  const hint = kind === 'photo'
    ? 'PNG / JPG / WebP / GIF, up to 12 MB'
    : 'MP4 / WebM / MOV / M4V, up to 80 MB'

  if (file && previewUrl) {
    return (
      <div className={styles.previewWrapper}>
        {kind === 'photo' ? (
          <img src={previewUrl} alt={file.name} className={styles.previewImage} />
        ) : (
          <video src={previewUrl} className={styles.previewVideo} controls muted playsInline preload="metadata" />
        )}
        <div className={styles.previewActions}>
          <span className={styles.fileName}>{file.name}</span>
          <div className={styles.previewButtons}>
            <button type="button" className={styles.secondaryButton} onClick={() => inputRef.current?.click()}>Choose another</button>
            <button type="button" className={styles.removeButton} onClick={clearFile}>Delete</button>
          </div>
        </div>
        <input ref={inputRef} type="file" accept={accept} className={styles.hiddenInput} onChange={handleFileChange} />
      </div>
    )
  }

  return (
    <div className={styles.dropzoneWrapper}>
      <button type="button" className={styles.dropzone} onClick={() => inputRef.current?.click()}>
        <span className={styles.dropzoneIcon}>+</span>
        <span className={styles.dropzoneLabel}>{title}</span>
        <span className={styles.dropzoneHint}>{hint}</span>
      </button>
      {error && <p className={styles.errorText}>{error}</p>}
      <input ref={inputRef} type="file" accept={accept} className={styles.hiddenInput} onChange={handleFileChange} />
    </div>
  )
}
