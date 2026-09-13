import { useEffect } from 'react'
import { useProductStore } from '../../product/store/useProductStore'
import { useAddMemoryStore } from '../../store/useAddMemoryStore'
import { AddMemoryButton } from './AddMemoryButton'
import { AddMemoryDrawer } from './AddMemoryDrawer'
import { AddMemoryToast } from './AddMemoryToast'
import { MemoryLibraryButton } from './MemoryLibraryButton'
import { MemoryManagerDrawer } from './MemoryManagerDrawer'
import { AgentChatButton } from '../agent/AgentChatButton'
import { AgentChatDrawer } from '../agent/AgentChatDrawer'

interface MemoryIngestionOverlayProps {
  showButton: boolean
}

export function MemoryIngestionOverlay({ showButton }: MemoryIngestionOverlayProps) {
  const memories = useProductStore((state) => state.memories)
  const step = useAddMemoryStore((state) => state.step)
  const libraryOpen = useAddMemoryStore((state) => state.libraryOpen)
  const openLibrary = useAddMemoryStore((state) => state.openLibrary)
  const closeLibrary = useAddMemoryStore((state) => state.closeLibrary)
  const closeDrawer = useAddMemoryStore((state) => state.closeDrawer)
  const agentOpen = useAddMemoryStore((state) => state.agentOpen)
  const openAgent = useAddMemoryStore((state) => state.openAgent)
  const closeAgent = useAddMemoryStore((state) => state.closeAgent)
  const showControls = showButton && step === 'closed' && !libraryOpen && !agentOpen

  useEffect(() => () => {
    closeLibrary()
    closeAgent()
    closeDrawer()
  }, [closeAgent, closeDrawer, closeLibrary])

  return (
    <>
      {showControls && <MemoryLibraryButton count={memories.length} onClick={openLibrary} />}
      {showControls && <AgentChatButton onClick={openAgent} />}
      {showControls && <AddMemoryButton />}
      <AddMemoryDrawer />
      <MemoryManagerDrawer />
      <AgentChatDrawer />
      <AddMemoryToast />
    </>
  )
}
