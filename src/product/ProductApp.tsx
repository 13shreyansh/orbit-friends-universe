import { useEffect, useState } from 'react'
import { FriendsDemo } from '../FriendsDemo'
import { GenesisSequence } from '../modules/genesis/GenesisSequence'
import { CreationRitual } from '../modules/genesis/CreationRitual'
import { OnboardingModule } from '../modules/onboarding'
import { UniverseExperience } from '../modules/universe/UniverseExperience'
import { useProductStore } from './store/useProductStore'
import { ApiRequestError, apiClient } from './api/apiClient'
import { usePlanetMemoryStore } from '../modules/memory/planetMemory'

export function ProductApp() {
  const phase = useProductStore((state) => state.phase)
  const session = useProductStore((state) => state.session)
  const draftVisual = useProductStore((state) => state.draftVisual)
  const draftIdentity = useProductStore((state) => state.draftIdentity)
  const completeGenesis = useProductStore((state) => state.completeGenesis)
  const completeArrival = useProductStore((state) => state.completeArrival)
  const selfPlanet = useProductStore((state) => state.selfPlanet)
  const hydrateCosmos = useProductStore((state) => state.hydrateCosmos)
  const signOut = useProductStore((state) => state.signOut)
  const releaseSessionMedia = usePlanetMemoryStore((state) => state.releaseSessionMedia)
  const [hasHydrated, setHasHydrated] = useState(() => useProductStore.persist.hasHydrated())
  const [restoring, setRestoring] = useState(Boolean(session))
  const [restoreError, setRestoreError] = useState('')
  const [restoreAttempt, setRestoreAttempt] = useState(0)

  useEffect(() => {
    if (useProductStore.persist.hasHydrated()) {
      setHasHydrated(true)
      return
    }
    return useProductStore.persist.onFinishHydration(() => setHasHydrated(true))
  }, [])

  useEffect(() => {
    const releaseOnExit = () => {
      usePlanetMemoryStore.getState().releaseSessionMedia()
    }
    window.addEventListener('pagehide', releaseOnExit)
    return () => window.removeEventListener('pagehide', releaseOnExit)
  }, [])

  useEffect(() => {
    if (phase === 'auth') releaseSessionMedia()
  }, [phase, releaseSessionMedia])

  useEffect(() => {
    if (!session) {
      setRestoring(false)
      setRestoreError('')
      return
    }
    let active = true
    setRestoring(true)
    setRestoreError('')
    apiClient.getCosmos()
      .then((cosmos) => {
        if (active) hydrateCosmos(cosmos)
      })
      .catch((cause) => {
        if (!active) return
        if (cause instanceof ApiRequestError && cause.status === 401) {
          void signOut()
          return
        }
        setRestoreError(cause instanceof Error ? cause.message : 'Unable to reconnect to the cosmos.')
      })
      .finally(() => {
        if (active) setRestoring(false)
      })
    return () => { active = false }
  }, [hasHydrated, hydrateCosmos, restoreAttempt, session, signOut])

  if (!hasHydrated || restoring) return <div style={{ minHeight: '100%', background: '#111637' }} />

  if (restoreError && session) {
    return (
      <main style={{ minHeight: '100%', display: 'grid', placeItems: 'center', background: '#111637', color: '#f8fbff' }}>
        <section style={{ maxWidth: 420, padding: 28, textAlign: 'center' }}>
          <p>{restoreError}</p>
          <button type="button" onClick={() => setRestoreAttempt((value) => value + 1)}>Retry connection</button>
        </section>
      </main>
    )
  }

  if (phase === 'auth') return <FriendsDemo />
  if (phase === 'onboarding') return <OnboardingModule />
  if (phase === 'genesis') {
    return (
      <CreationRitual
        config={draftVisual}
        planetName={draftIdentity.name}
        onComplete={completeGenesis}
      />
    )
  }
  if (phase === 'arrival' && selfPlanet) {
    return (
      <GenesisSequence
        config={selfPlanet.visual}
        planetName={selfPlanet.identity.name}
        onComplete={completeArrival}
        mode="arrival"
      />
    )
  }
  return <UniverseExperience />
}
