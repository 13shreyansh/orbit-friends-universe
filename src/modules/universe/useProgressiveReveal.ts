import { useEffect, useState } from 'react'

export function useProgressiveReveal(total: number, resetKey: string, batchSize: number, intervalMs: number) {
  const [progress, setProgress] = useState({ key: resetKey, count: 0 })
  const visibleCount = progress.key === resetKey ? progress.count : 0

  useEffect(() => {
    if (visibleCount >= total) return
    const timer = window.setTimeout(() => {
      setProgress((current) => ({
        key: resetKey,
        count: current.key === resetKey ? Math.min(total, current.count + batchSize) : Math.min(total, batchSize),
      }))
    }, visibleCount === 0 ? 80 : intervalMs)
    return () => window.clearTimeout(timer)
  }, [batchSize, intervalMs, resetKey, total, visibleCount])

  return Math.min(total, visibleCount)
}
