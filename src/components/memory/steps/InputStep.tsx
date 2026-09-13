import { useAddMemoryStore } from '../../../store/useAddMemoryStore'
import type { MemoryRelationshipContext } from '../../../store/useAddMemoryStore'
import { analyzeMemory } from '../../../services/aiMemoryService'
import type { AnalyzeMemoryResult } from '../../../services/aiMemoryService'
import { ImageUploadField } from './ImageUploadField'
import { MemoryMediaUploadField } from './MemoryMediaUploadField'
import { apiClient } from '../../../product/api/apiClient'
import type { MemoryObject } from '../../../types/memoryObject'
import { shanghaiDateInputValue } from '../../../utils/time'
import styles from './InputStep.module.css'

function buildFallbackDraft(
  kind: 'text' | 'chat_screenshot' | 'photo' | 'video',
  rawText: string,
  relationshipContext: MemoryRelationshipContext | null,
): MemoryObject {
  const targetName = relationshipContext?.targetName ?? 'a friend'
  const mediaLabel = kind === 'photo' ? 'photo' : kind === 'video' ? 'video' : 'memory'
  const summary = rawText || `A shared ${mediaLabel} with ${targetName}, ready for more details`

  return {
    id: crypto.randomUUID(),
    sourceType: kind === 'chat_screenshot' ? 'chat_screenshot' : 'text',
    rawText: summary,
    mediaUrl: '',
    people: relationshipContext
      ? [{
          id: relationshipContext.targetUserId,
          name: relationshipContext.targetName,
          isExisting: true,
        }]
      : [],
    eventTime: shanghaiDateInputValue(),
    location: '',
    eventType: 'memory',
    summary,
    facts: [summary],
    emotions: [],
    relationshipSignals: {
      interactionFrequency: 50,
      emotionalIntimacy: 50,
      initiativeBalance: 50,
      relationshipChange: 'stable',
    },
    keywords: [],
    narrative: summary,
    confidence: 0.35,
    semanticEvidence: null,
    analysisProvider: 'media-fallback',
  }
}

export function InputStep() {
  const inputMode = useAddMemoryStore((state) => state.inputMode)
  const textValue = useAddMemoryStore((state) => state.textValue)
  const imageFile = useAddMemoryStore((state) => state.imageFile)
  const setInputMode = useAddMemoryStore((state) => state.setInputMode)
  const setTextValue = useAddMemoryStore((state) => state.setTextValue)
  const startLoading = useAddMemoryStore((state) => state.startLoading)
  const setLoadingStage = useAddMemoryStore((state) => state.setLoadingStage)
  const setDraft = useAddMemoryStore((state) => state.setDraft)
  const backToInputStep = useAddMemoryStore((state) => state.backToInput)
  const triggerToast = useAddMemoryStore((state) => state.triggerToast)
  const relationshipContext = useAddMemoryStore((state) => state.relationshipContext)

  const isBookMedia = inputMode === 'photo' || inputMode === 'video'
  const canSubmit = inputMode === 'text' ? textValue.trim().length > 0 : imageFile !== null

  const handleSubmit = async () => {
    if (!canSubmit) return
    const controller = startLoading()

    try {
      const analysisText = textValue.trim() || (inputMode === 'photo'
        ? `I saved a shared photo with ${relationshipContext?.targetName ?? 'a friend'}.`
        : inputMode === 'video'
          ? `I saved a shared video with ${relationshipContext?.targetName ?? 'a friend'}.`
          : '')
      let result: AnalyzeMemoryResult
      try {
        result = await analyzeMemory(
          {
            sourceType: inputMode === 'chat_screenshot' ? 'chat_screenshot' : 'text',
            rawText: analysisText,
            imageFile: inputMode === 'chat_screenshot' ? imageFile : null,
            imagePreviewUrl: null,
            relationshipId: relationshipContext?.relationshipId,
          },
          (stage) => setLoadingStage(stage),
          controller.signal,
        )
      } catch (analysisError) {
        if ((analysisError as Error).name === 'AbortError') throw analysisError
        result = {
          memory: buildFallbackDraft(inputMode, analysisText, relationshipContext),
          draftReference: null,
        }
      }
      const uploadedMedia = imageFile && inputMode !== 'text'
        ? await apiClient.uploadMemoryMedia(imageFile, controller.signal)
        : null
      setDraft({
        ...result.memory,
        mediaUrl: uploadedMedia?.url ?? result.memory.mediaUrl,
        media: uploadedMedia ? [uploadedMedia] : result.memory.media,
      }, result.draftReference)
    } catch (error) {
      if ((error as Error).name === 'AbortError') return
      console.warn('Memory media upload did not complete after analysis fallback.', error)
      triggerToast('The upload did not finish. Your content is saved; please try again.')
      backToInputStep()
    }
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.tabs}>
        <button
          type="button"
          className={`${styles.tab} ${inputMode === 'text' ? styles.tabActive : ''}`}
          onClick={() => setInputMode('text')}
        >
          Write a memory
        </button>
        <button
          type="button"
          className={`${styles.tab} ${inputMode === 'chat_screenshot' ? styles.tabActive : ''}`}
          onClick={() => setInputMode('chat_screenshot')}
        >
          Chat screenshot
        </button>
        <button
          type="button"
          className={`${styles.tab} ${inputMode === 'photo' ? styles.tabActive : ''}`}
          onClick={() => setInputMode('photo')}
        >
          Shared photo
        </button>
        <button
          type="button"
          className={`${styles.tab} ${inputMode === 'video' ? styles.tabActive : ''}`}
          onClick={() => setInputMode('video')}
        >
          Shared video
        </button>
      </div>

      {inputMode === 'text' ? (
        <textarea
          className={styles.textarea}
          rows={7}
          placeholder={relationshipContext
            ? `Write about something you and ${relationshipContext.targetName} experienced together…`
            : 'Write about a moment with someone, recent or unforgettable…'}
          value={textValue}
          onChange={(event) => setTextValue(event.target.value)}
        />
      ) : inputMode === 'chat_screenshot' ? (
        <ImageUploadField />
      ) : (
        <>
          <MemoryMediaUploadField kind={inputMode} />
          <textarea
            className={styles.textarea}
            rows={3}
            placeholder={`Add the story behind this ${inputMode === 'photo' ? 'photo' : 'video'} (optional)`}
            value={textValue}
            onChange={(event) => setTextValue(event.target.value)}
          />
        </>
      )}

      <button
        type="button"
        className={styles.submitButton}
        disabled={!canSubmit}
        onClick={handleSubmit}
      >
        {isBookMedia ? 'Save and organize memory' : 'Organize memory'}
      </button>
    </div>
  )
}
