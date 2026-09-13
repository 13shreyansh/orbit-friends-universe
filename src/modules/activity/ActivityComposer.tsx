import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Camera, LoaderCircle, Mic, Radio, Square, Upload, Video, X } from 'lucide-react'
import type { ActivityDraft, ActivityPost } from '../../product/contracts'
import { useI18n } from '../../product/i18n'
import styles from './ActivityComposer.module.css'

interface ActivityComposerProps {
  onClose: () => void
  onPublish: (draft: ActivityDraft, mediaFiles?: File[]) => Promise<ActivityPost>
  onPublished: (activity: ActivityPost) => void
}

interface SelectedMedia {
  id: string
  file: File
  previewUrl: string
}

const MAX_MEDIA_FILES = 6

function parseTags(value: string) {
  const seen = new Set<string>()
  return value
    .split(/[,，、;；\n]+/)
    .map((tag) => tag.trim().replace(/^#+/, '').slice(0, 40))
    .filter((tag) => {
      const key = tag.toLocaleLowerCase()
      if (!tag || seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, 12)
}

function mediaKind(file: File) {
  if (file.type.startsWith('image/')) return 'image' as const
  if (file.type.startsWith('audio/')) return 'audio' as const
  if (file.type.startsWith('video/')) return 'video' as const
  return null
}

export function ActivityComposer({ onClose, onPublish, onPublished }: ActivityComposerProps) {
  const { t } = useI18n()
  const [visibility, setVisibility] = useState<ActivityDraft['visibility']>('friends')
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [eventName, setEventName] = useState('')
  const [location, setLocation] = useState('')
  const [tagsInput, setTagsInput] = useState('')
  const [mediaItems, setMediaItems] = useState<SelectedMedia[]>([])
  const [recording, setRecording] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState('')
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const mediaItemsRef = useRef<SelectedMedia[]>([])

  function updateMediaItems(items: SelectedMedia[]) {
    mediaItemsRef.current = items
    setMediaItems(items)
  }

  function selectMedia(files: File[]) {
    setError('')
    const accepted: SelectedMedia[] = []
    let validationError = ''
    for (const file of files) {
      const kind = mediaKind(file)
      if (!kind) {
        validationError = t('activity.unsupportedMedia')
        continue
      }
      const limit = kind === 'image' ? 12 * 1024 * 1024 : kind === 'audio' ? 20 * 1024 * 1024 : 80 * 1024 * 1024
      if (file.size > limit) {
        validationError = kind === 'image'
          ? t('activity.photoTooLarge')
          : kind === 'audio'
            ? t('activity.audioTooLarge')
            : t('activity.videoTooLarge')
        continue
      }
      if (mediaItems.length + accepted.length >= MAX_MEDIA_FILES) {
        validationError = t('activity.tooManyMedia')
        break
      }
      accepted.push({
        id: `${Date.now()}-${accepted.length}-${file.name}`,
        file,
        previewUrl: URL.createObjectURL(file),
      })
    }
    if (accepted.length) {
      updateMediaItems([...mediaItems, ...accepted])
    }
    if (validationError) setError(validationError)
  }

  function removeMedia(id: string) {
    const removed = mediaItems.find((item) => item.id === id)
    if (removed) URL.revokeObjectURL(removed.previewUrl)
    updateMediaItems(mediaItems.filter((item) => item.id !== id))
  }

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    mediaItemsRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl))
  }, [])

  async function toggleRecording() {
    if (recording) {
      recorderRef.current?.stop()
      return
    }
    setError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      chunksRef.current = []
      const recorder = new MediaRecorder(stream)
      recorderRef.current = recorder
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data)
      }
      recorder.onstop = () => {
        const mimeType = recorder.mimeType || 'audio/webm'
        const blob = new Blob(chunksRef.current, { type: mimeType })
        selectMedia([new File([blob], `voice-signal-${Date.now()}.webm`, { type: mimeType })])
        stream.getTracks().forEach((track) => track.stop())
        streamRef.current = null
        setRecording(false)
      }
      recorder.start()
      setRecording(true)
    } catch {
      setError(t('activity.microphoneUnavailable'))
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPublishing(true)
    setError('')
    try {
      const activity = await onPublish({
        title: title.trim(),
        text: text.trim(),
        eventName: eventName.trim(),
        location: location.trim(),
        tags: parseTags(tagsInput),
        visibility,
      }, mediaItems.map((item) => item.file))
      onPublished(activity)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('activity.publishFailed'))
    } finally {
      setPublishing(false)
    }
  }

  const hasContent = Boolean(text.trim() || mediaItems.length)

  return (
    <div className={styles.backdrop} role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className={styles.composer} role="dialog" aria-modal="true" aria-label={t('activity.dialog')}>
        <button type="button" className={styles.close} onClick={onClose} aria-label={t('activity.closeComposer')}>
          <X size={17} />
        </button>
        <div className={styles.heading}>
          <span><Radio size={14} /> {t('activity.lifeSignal')}</span>
          <h2>{t('activity.title')}</h2>
          <p>{t('activity.description')}</p>
        </div>

        <form onSubmit={handleSubmit}>
          <label>
            {t('activity.whatHappened')}
            <textarea value={text} onChange={(event) => setText(event.target.value)} placeholder={t('activity.textPlaceholder')} rows={4} maxLength={5000} />
          </label>
          <label>
            {t('activity.signalTitle')}
            <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={t('activity.titlePlaceholder')} maxLength={180} />
          </label>
          <label>
            {t('activity.tags')}
            <input value={tagsInput} onChange={(event) => setTagsInput(event.target.value)} placeholder={t('activity.tagsPlaceholder')} maxLength={500} />
            <small className={styles.fieldHint}>{t('activity.tagsHint')}</small>
          </label>
          <div className={styles.inlineFields}>
            <label>
              {t('activity.event')}
              <input value={eventName} onChange={(event) => setEventName(event.target.value)} placeholder={t('activity.eventPlaceholder')} maxLength={180} />
            </label>
            <label>
              {t('activity.location')}
              <input value={location} onChange={(event) => setLocation(event.target.value)} placeholder={t('activity.locationPlaceholder')} maxLength={240} />
            </label>
          </div>
          <label>
            {t('activity.visibility')}
            <select value={visibility} onChange={(event) => setVisibility(event.target.value as ActivityDraft['visibility'])}>
              <option value="friends">{t('activity.visibility.friends')}</option>
              <option value="public">{t('activity.visibility.public')}</option>
            </select>
          </label>

          <div className={styles.mediaTools}>
            <label className={styles.fileButton}>
              <Camera size={15} /> {t('activity.photo')}
              <input type="file" accept="image/*" multiple onChange={(event) => {
                selectMedia(Array.from(event.target.files ?? []))
                event.target.value = ''
              }} />
            </label>
            <label className={styles.fileButton}>
              <Upload size={15} /> {t('activity.audioFile')}
              <input type="file" accept="audio/*" multiple onChange={(event) => {
                selectMedia(Array.from(event.target.files ?? []))
                event.target.value = ''
              }} />
            </label>
            <label className={styles.fileButton}>
              <Video size={15} /> {t('activity.videoFile')}
              <input type="file" accept="video/*" multiple onChange={(event) => {
                selectMedia(Array.from(event.target.files ?? []))
                event.target.value = ''
              }} />
            </label>
            <button type="button" className={recording ? styles.recording : styles.recordButton} onClick={toggleRecording}>
              {recording ? <Square size={13} /> : <Mic size={15} />}
              {recording ? t('activity.stopRecording') : t('activity.recordVoice')}
            </button>
          </div>

          {mediaItems.length > 0 && (
            <div className={styles.previewList} aria-label={t('activity.selectedMedia')}>
              <span>{t('activity.mediaCount', { count: mediaItems.length, max: MAX_MEDIA_FILES })}</span>
              {mediaItems.map((item) => {
                const kind = mediaKind(item.file)
                return (
                  <div className={styles.preview} key={item.id}>
                    {kind === 'image' && <img src={item.previewUrl} alt={item.file.name} />}
                    {kind === 'audio' && <audio src={item.previewUrl} controls preload="metadata" />}
                    {kind === 'video' && <video src={item.previewUrl} controls muted playsInline preload="metadata" />}
                    <div><strong>{item.file.name}</strong><small>{Math.max(1, Math.round(item.file.size / 1024))} KB</small></div>
                    <button type="button" onClick={() => removeMedia(item.id)} aria-label={`${t('activity.removeMedia')}: ${item.file.name}`}><X size={14} /></button>
                  </div>
                )
              })}
            </div>
          )}

          <div className={styles.ecologyPreview}>
            <i />
            <div><span>{t('activity.forecast')}</span><strong>{t('activity.generatedEcology')}</strong></div>
            <small>{t('activity.ugcForecastDescription')}</small>
          </div>

          {error && <p className={styles.error}>{error}</p>}
          {!hasContent && <p className={styles.contentHint}>{t('activity.contentRequired')}</p>}
          <button type="submit" className={styles.publish} disabled={publishing || recording || !hasContent}>
            {publishing ? <LoaderCircle className={styles.spinner} size={16} /> : <Radio size={16} />}
            {publishing ? (mediaItems.length ? t('activity.uploading') : t('activity.transforming')) : t('activity.publish')}
          </button>
        </form>
      </section>
    </div>
  )
}
