import type { MemoryObject, MemorySourceType } from '../types/memoryObject'
import { apiClient } from '../product/api/apiClient'

export interface AnalyzeMemoryInput {
  sourceType: MemorySourceType
  rawText: string
  imageFile: File | null
  imagePreviewUrl: string | null
  relationshipId?: string
}

export interface MemoryDraftReference {
  id: string
  version: number
}

export interface AnalyzeMemoryResult {
  memory: MemoryObject
  draftReference: MemoryDraftReference | null
}

export async function analyzeMemory(
  input: AnalyzeMemoryInput,
  onStageChange: (stage: number) => void,
  signal?: AbortSignal,
): Promise<AnalyzeMemoryResult> {
  const stageTimers = [0, 320, 680, 1040].map((delay, stage) =>
    window.setTimeout(() => onStageChange(stage), delay),
  )
  const analysisController = new AbortController()
  let analysisTimedOut = false
  const abortFromCaller = () => analysisController.abort(signal?.reason)
  if (signal?.aborted) abortFromCaller()
  else signal?.addEventListener('abort', abortFromCaller, { once: true })
  const analysisDeadline = window.setTimeout(() => {
    analysisTimedOut = true
    analysisController.abort()
  }, 5_500)

  try {
    let memory: MemoryObject
    let draftReference: MemoryDraftReference | null = null
    if (input.sourceType === 'text') {
      const job = await apiClient.createTextIngestion(
        input.rawText,
        input.relationshipId,
        analysisController.signal,
      )
      const analyzed = await apiClient.analyzeIngestionJob(job.id, analysisController.signal)
      if (!analyzed.draft) {
        throw new Error(analyzed.job.lastError || 'Memory analysis did not produce a draft.')
      }
      memory = analyzed.draft.candidate
      draftReference = { id: analyzed.draft.id, version: analyzed.draft.version }
    } else {
      memory = await apiClient.analyzeMemory(
        {
          sourceType: input.sourceType,
          rawText: input.rawText,
          imageName: input.imageFile?.name,
        },
        analysisController.signal,
      )
    }
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    return {
      memory: { ...memory, mediaUrl: input.imagePreviewUrl ?? memory.mediaUrl },
      draftReference,
    }
  } catch (error) {
    if (analysisTimedOut && (error as Error).name === 'AbortError') {
      throw new Error('Memory enrichment exceeded its foreground time budget.')
    }
    throw error
  } finally {
    window.clearTimeout(analysisDeadline)
    signal?.removeEventListener('abort', abortFromCaller)
    stageTimers.forEach(window.clearTimeout)
  }
}
