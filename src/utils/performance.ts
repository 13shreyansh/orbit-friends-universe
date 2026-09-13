interface NavigatorWithHints extends Navigator {
  deviceMemory?: number
}

/**
 * A lightweight, dependency-free heuristic — not a benchmark. Combines a
 * few signals the browser already exposes (CPU core count, device memory
 * if available, mobile UA, coarse pointer) to decide whether to trim
 * particle counts / resolution / postprocessing for this session.
 */
function detectLowPerformanceDevice(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false

  const nav = navigator as NavigatorWithHints
  const lowCoreCount = typeof nav.hardwareConcurrency === 'number' && nav.hardwareConcurrency <= 4
  const lowMemory = typeof nav.deviceMemory === 'number' && nav.deviceMemory <= 4
  const isMobileUA = /Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent)
  const isCoarsePointer = window.matchMedia?.('(pointer: coarse)').matches ?? false

  // Mobile + coarse pointer alone is a strong enough signal on its own;
  // on desktop, require low cores AND low memory before downgrading.
  if (isMobileUA && isCoarsePointer) return true
  return lowCoreCount && lowMemory
}

/** Computed once per session — device capability doesn't change mid-tab. */
export const isLowPerformanceDevice = detectLowPerformanceDevice()
