import { useEffect, useRef } from 'react'
import { usePeopleStore, type PersonEffectKind } from '../store/usePeopleStore'

/** Subscribes to usePeopleStore's transient effect signal and exposes the
 * timestamp (performance.now()) of the most recent matching pulse as a ref
 * — read inside a useFrame loop, not through React state, so it doesn't
 * trigger re-renders. Returns null once nothing matching has fired (or the
 * component mounted before it did).
 *
 * `kinds` must be a stable reference (module-level array or memoized) —
 * it's read once at mount to set up the subscription. */
export function useEffectPulse(
  personId: string,
  kinds: readonly PersonEffectKind[],
): React.MutableRefObject<number | null> {
  const pulseRef = useRef<number | null>(null)

  useEffect(() => {
    return usePeopleStore.subscribe((state) => {
      const effect = state.lastEffect
      if (!effect || effect.personId !== personId) return
      if (effect.kinds.some((kind) => kinds.includes(kind))) {
        pulseRef.current = effect.startedAt
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personId])

  return pulseRef
}
