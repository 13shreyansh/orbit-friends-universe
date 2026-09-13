import { buildMemoryStory, type PlanetMemory } from '../memory/planetMemory'
import type { ConfirmedMemorySummary } from '../../types/memoryObject'
import type { MemoryPage } from './types'

export function convertMemoryToPages(
  friendName: string,
  memories: PlanetMemory[],
  confirmedMemories: ConfirmedMemorySummary[] = [],
): MemoryPage[] {
  const sorted = [...memories].sort((left, right) => left.createdAt - right.createdAt)
  const seenMemories = new Set<string>()
  const sortedConfirmed = [...confirmedMemories].sort((left, right) => left.eventTime.localeCompare(right.eventTime)).filter(memory => {
    const key = memory.media?.length ? memory.media.map(media => media.url).sort().join('|') : memory.id
    if (seenMemories.has(key)) return false
    seenMemories.add(key)
    return true
  })
  const storyText = sortedConfirmed.length
    ? `${sortedConfirmed.length} moments from the life you share with ${friendName}. Turn the pages and spend a little time there again.`
    : buildMemoryStory(friendName, sorted)
  const coverMemory = sortedConfirmed.find(memory => memory.media?.some(media => media.type === 'image'))
  const coverPhoto = coverMemory?.media?.find(media => media.type === 'image')
  const pages: MemoryPage[] = [
    {
      id: 'memory-book-cover',
      type: 'cover',
      title: 'Our shared orbit',
      text: friendName,
    },
    coverPhoto ? {
      id: 'memory-book-first-photo',
      type: 'photo',
      title: coverPhoto.name || coverMemory?.summary || 'Our story',
      mediaUrl: coverPhoto.url,
      fileName: coverPhoto.name,
      createdAt: coverMemory?.eventType === 'album_import' ? undefined : new Date(coverMemory!.eventTime).getTime(),
    } : {
      id: 'memory-book-story',
      type: 'text',
      title: 'Our story',
      text: storyText,
    },
  ]

  for (const memory of sorted) {
    if (memory.type === 'text' && memory.text) {
      pages.push({
        id: `memory-page-${memory.id}`,
        type: 'text',
        title: 'A moment together',
        text: memory.text,
        createdAt: memory.createdAt,
      })
    }
    if (memory.type === 'image' && memory.src) {
      pages.push({
        id: `memory-page-${memory.id}`,
        type: 'photo',
        title: 'A moment together',
        mediaUrl: memory.src,
        fileName: memory.fileName,
        createdAt: memory.createdAt,
      })
    }
    if (memory.type === 'video' && memory.src) {
      pages.push({
        id: `memory-page-${memory.id}`,
        type: 'video',
        title: 'A moving memory',
        mediaUrl: memory.src,
        fileName: memory.fileName,
        createdAt: memory.createdAt,
      })
    }
  }

  const seenPhotos = new Set<string>(coverPhoto ? [coverPhoto.url] : [])
  const seenNotes = new Set<string>()
  for (const memory of sortedConfirmed) {
    const createdAt = memory.eventType === 'album_import' ? undefined : new Date(memory.eventTime).getTime()
    const note = memory.rawText || memory.summary || memory.narrative
    if (note && !seenNotes.has(note)) {
      seenNotes.add(note)
      pages.push({
        id: `confirmed-memory-page-${memory.id}`,
        type: 'text',
        title: memory.summary || 'A moment together',
        text: note,
        createdAt,
      })
    }
    for (const [mediaIndex, media] of (memory.media ?? []).entries()) {
      if (media.type !== 'image' && media.type !== 'video') continue
      if (seenPhotos.has(media.url)) continue
      seenPhotos.add(media.url)
      pages.push({
        id: `confirmed-memory-media-${memory.id}-${mediaIndex}`,
        type: media.type === 'image' ? 'photo' : 'video',
        title: media.name || memory.summary || 'A moment together',
        mediaUrl: media.url,
        fileName: media.name,
        createdAt: (memory.media?.length ?? 0) > 1 ? undefined : createdAt,
      })
    }
  }

  return pages
}
