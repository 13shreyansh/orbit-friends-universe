import { create } from 'zustand'

export type PlanetMemoryType = 'text' | 'image' | 'video'

export interface PlanetMemory {
  id: string
  planetId: string
  type: PlanetMemoryType
  text?: string
  src?: string
  file?: File
  fileName?: string
  createdAt: number
  temporary?: boolean
}

const STORAGE_KEY = 'social-cosmos-planet-text-memories-v1'

function loadTextMemories(): PlanetMemory[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as PlanetMemory[]
    return parsed.filter((memory) => memory.type === 'text' && memory.text)
  } catch {
    return []
  }
}

function persistTextMemories(memories: PlanetMemory[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(memories.filter((memory) => memory.type === 'text')))
  } catch {
    // Memory input remains usable when storage is unavailable or full.
  }
}

interface PlanetMemoryState {
  memories: PlanetMemory[]
  addText: (planetId: string, text: string) => void
  addFile: (planetId: string, type: 'image' | 'video', file: File) => void
  remove: (id: string) => void
  releaseSessionMedia: () => void
}

export const usePlanetMemoryStore = create<PlanetMemoryState>((set, get) => ({
  memories: loadTextMemories(),
  addText: (planetId, text) => {
    const normalizedText = text.trim()
    if (!normalizedText) return
    const memory: PlanetMemory = {
      id: crypto.randomUUID(), planetId, type: 'text', text: normalizedText, createdAt: Date.now(),
    }
    const memories = [...get().memories, memory]
    persistTextMemories(memories)
    set({ memories })
  },
  // Binary previews deliberately stay session-only; object URLs are never persisted.
  addFile: (planetId, type, file) => set((state) => ({
    memories: [...state.memories, {
      id: crypto.randomUUID(), planetId, type, src: URL.createObjectURL(file),
      file, fileName: file.name, createdAt: Date.now(), temporary: true,
    }],
  })),
  remove: (id) => {
    const target = get().memories.find((memory) => memory.id === id)
    if (target?.temporary && target.src) URL.revokeObjectURL(target.src)
    const memories = get().memories.filter((memory) => memory.id !== id)
    persistTextMemories(memories)
    set({ memories })
  },
  releaseSessionMedia: () => {
    const memories = get().memories
    for (const memory of memories) {
      if (memory.temporary && memory.src) URL.revokeObjectURL(memory.src)
    }
    set({ memories: memories.filter((memory) => !memory.temporary) })
  },
}))

export function usePlanetMemories(planetId: string) {
  const memories = usePlanetMemoryStore((state) => state.memories)
  return memories.filter((memory) => memory.planetId === planetId).sort((a, b) => a.createdAt - b.createdAt)
}

export function buildMemoryStory(friendName: string, memories: PlanetMemory[]): string {
  if (!memories.length) return `Your story with ${friendName} still has room to grow. Start with the next time you meet.`
  const textCount = memories.filter((memory) => memory.type === 'text').length
  const imageCount = memories.filter((memory) => memory.type === 'image').length
  const videoCount = memories.filter((memory) => memory.type === 'video').length
  const firstText = memories.find((memory) => memory.text)?.text?.replace(/\s+/g, ' ').slice(0, 18)
  const media = [imageCount && `${imageCount} photos`, videoCount && `${videoCount} videos`].filter(Boolean).join(' and ')
  return `You and ${friendName} have saved ${memories.length} shared memories on this planet. ${textCount ? `${textCount} stories are written down` : 'Some stories are still waiting to be told'}${media ? `, with ${media} capturing the moments` : ''}. ${firstText ? `One begins with “${firstText}${firstText.length >= 18 ? '…' : ''}”. ` : ''}You make moments worth remembering. Life gets busy, but you still show up for the chapters that matter.`
}
