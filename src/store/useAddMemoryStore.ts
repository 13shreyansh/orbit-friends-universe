import { create } from 'zustand'
import type { MemoryDraftEnvelope, MemoryInputMode, MemoryObject } from '../types/memoryObject'
import type { MemoryDraftReference } from '../services/aiMemoryService'
import { apiClient } from '../product/api/apiClient'

export type AddMemoryStep = 'closed' | 'input' | 'loading' | 'confirm'

export interface MemoryRelationshipContext {
  relationshipId: string
  targetUserId: string
  targetPlanetId: string
  targetName: string
}

const MAX_IMAGE_BYTES = 8 * 1024 * 1024 // 8MB
const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg']
const MAX_PHOTO_BYTES = 12 * 1024 * 1024
const MAX_VIDEO_BYTES = 80 * 1024 * 1024
const ACCEPTED_PHOTO_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
const ACCEPTED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-m4v']

interface AddMemoryState {
  step: AddMemoryStep
  inputMode: MemoryInputMode
  textValue: string
  imageFile: File | null
  imagePreviewUrl: string | null
  imageError: string | null
  loadingStage: number
  draft: MemoryObject | null
  draftReference: MemoryDraftReference | null
  libraryOpen: boolean
  agentOpen: boolean
  toastMessage: string | null
  memoryChangeVersion: number
  requestedMemoryId: string | null
  relationshipContext: MemoryRelationshipContext | null
  /** Owns the in-flight analysis request's abort controller so closing the
   * drawer mid-loading reliably cancels it — otherwise a stale response
   * could resolve after close and snap the drawer back open on 'confirm'. */
  activeAbortController: AbortController | null

  openDrawer: (context?: MemoryRelationshipContext) => void
  openLibrary: () => void
  openAgent: () => void
  closeLibrary: () => void
  closeAgent: () => void
  openMemoryDetail: (memoryId: string) => void
  clearMemoryDetailRequest: () => void
  closeDrawer: () => void
  setInputMode: (mode: MemoryInputMode) => void
  setTextValue: (value: string) => void
  setImageFile: (file: File | null) => string | null
  clearImage: () => void
  startLoading: () => AbortController
  setLoadingStage: (stage: number) => void
  setDraft: (draft: MemoryObject, reference: MemoryDraftReference | null) => void
  openDraftForConfirmation: (draft: MemoryDraftEnvelope) => void
  discardDraft: () => Promise<boolean>
  updateDraft: (patch: Partial<MemoryObject>) => void
  backToInput: () => void
  triggerToast: (message: string) => void
  clearToast: () => void
  notifyMemoryChanged: () => void
}

function revokePreview(url: string | null) {
  if (url) URL.revokeObjectURL(url)
}

export const useAddMemoryStore = create<AddMemoryState>((set, get) => ({
  step: 'closed',
  inputMode: 'text',
  textValue: '',
  imageFile: null,
  imagePreviewUrl: null,
  imageError: null,
  loadingStage: 0,
  draft: null,
  draftReference: null,
  libraryOpen: false,
  agentOpen: false,
  toastMessage: null,
  memoryChangeVersion: 0,
  requestedMemoryId: null,
  relationshipContext: null,
  activeAbortController: null,

  openDrawer: (relationshipContext) => set({
    step: 'input',
    libraryOpen: false,
    agentOpen: false,
    relationshipContext: relationshipContext ?? null,
  }),

  openLibrary: () => set((state) => (
    state.step === 'closed' ? { libraryOpen: true, agentOpen: false } : state
  )),

  openAgent: () => set((state) => (
    state.step === 'closed' ? { agentOpen: true, libraryOpen: false } : state
  )),

  closeLibrary: () => set({ libraryOpen: false }),
  closeAgent: () => set({ agentOpen: false }),
  openMemoryDetail: (requestedMemoryId) => set({
    requestedMemoryId,
    libraryOpen: true,
    agentOpen: false,
  }),
  clearMemoryDetailRequest: () => set({ requestedMemoryId: null }),

  closeDrawer: () => {
    get().activeAbortController?.abort()
    revokePreview(get().imagePreviewUrl)
    set({
      step: 'closed',
      inputMode: 'text',
      textValue: '',
      imageFile: null,
      imagePreviewUrl: null,
      imageError: null,
      loadingStage: 0,
      draft: null,
      draftReference: null,
      relationshipContext: null,
      activeAbortController: null,
    })
  },

  setInputMode: (mode) => {
    revokePreview(get().imagePreviewUrl)
    set({
      inputMode: mode,
      imageFile: null,
      imagePreviewUrl: null,
      imageError: null,
    })
  },

  setTextValue: (value) => set({ textValue: value }),

  setImageFile: (file) => {
    if (!file) {
      revokePreview(get().imagePreviewUrl)
      set({ imageFile: null, imagePreviewUrl: null, imageError: null })
      return null
    }

    const mode = get().inputMode
    const acceptedTypes = mode === 'video'
      ? ACCEPTED_VIDEO_TYPES
      : mode === 'photo'
        ? ACCEPTED_PHOTO_TYPES
        : ACCEPTED_IMAGE_TYPES
    const maxBytes = mode === 'video'
      ? MAX_VIDEO_BYTES
      : mode === 'photo'
        ? MAX_PHOTO_BYTES
        : MAX_IMAGE_BYTES

    if (!acceptedTypes.includes(file.type)) {
      const error = mode === 'video'
        ? 'Choose an MP4, WebM, MOV or M4V video.'
        : mode === 'photo'
          ? 'Choose a PNG, JPEG, WebP or GIF image.'
          : 'Choose a PNG or JPEG chat screenshot.'
      set({ imageError: error })
      return error
    }
    if (file.size > maxBytes) {
      const error = mode === 'video'
        ? 'Videos must be 80 MB or smaller.'
        : mode === 'photo'
          ? 'Photos must be 12 MB or smaller.'
          : 'Chat screenshots must be 8 MB or smaller.'
      set({ imageError: error })
      return error
    }

    revokePreview(get().imagePreviewUrl)
    set({
      imageFile: file,
      imagePreviewUrl: URL.createObjectURL(file),
      imageError: null,
    })
    return null
  },

  clearImage: () => {
    revokePreview(get().imagePreviewUrl)
    set({ imageFile: null, imagePreviewUrl: null, imageError: null })
  },

  startLoading: () => {
    const controller = new AbortController()
    set({ step: 'loading', loadingStage: 0, activeAbortController: controller })
    return controller
  },

  setLoadingStage: (stage) => set({ loadingStage: stage }),

  setDraft: (draft, reference) => set({
    step: 'confirm',
    draft,
    draftReference: reference,
    activeAbortController: null,
  }),

  openDraftForConfirmation: (draft) => set({
    step: 'confirm',
    libraryOpen: false,
    agentOpen: false,
    draft: draft.candidate,
    draftReference: { id: draft.id, version: draft.version },
    inputMode: draft.candidate.sourceType,
    textValue: draft.candidate.rawText,
    relationshipContext: null,
    activeAbortController: null,
  }),

  discardDraft: async () => {
    const reference = get().draftReference
    if (!reference) return true
    try {
      await apiClient.rejectMemoryDraft(reference.id, reference.version)
      set({ draftReference: null })
      return true
    } catch (cause) {
      set({ toastMessage: `Could not discard the memory draft: ${(cause as Error).message}` })
      return false
    }
  },

  updateDraft: (patch) =>
    set((state) => (state.draft ? { draft: { ...state.draft, ...patch } } : state)),

  backToInput: () => set({ step: 'input', draft: null, activeAbortController: null }),

  triggerToast: (message) => set({ toastMessage: message }),
  clearToast: () => set({ toastMessage: null }),
  notifyMemoryChanged: () => set((state) => ({ memoryChangeVersion: state.memoryChangeVersion + 1 })),
}))
