import { useEffect, useState } from 'react'

const NARROW_QUERY = '(max-width: 640px)'

/** True on phone-width viewports; used to switch the detail panel between
 * a right-side dock and a bottom drawer. */
export function useIsNarrowScreen(): boolean {
  const [isNarrow, setIsNarrow] = useState(() => window.matchMedia(NARROW_QUERY).matches)

  useEffect(() => {
    const mediaQuery = window.matchMedia(NARROW_QUERY)
    const handleChange = (event: MediaQueryListEvent) => setIsNarrow(event.matches)
    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [])

  return isNarrow
}
