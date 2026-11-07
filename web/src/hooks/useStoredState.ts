import { useCallback, useEffect, useState } from 'react'

/** useState persisted to localStorage. Storage can be blocked (private mode), so every access is guarded. */
export function useStoredState<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      if (raw == null) return fallback
      const parsed = JSON.parse(raw)
      // Merge objects so new settings keys get their defaults.
      return fallback && typeof fallback === 'object' && !Array.isArray(fallback)
        ? { ...fallback, ...parsed }
        : parsed
    } catch {
      return fallback
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      /* storage unavailable: keep working in memory */
    }
  }, [key, value])

  const update = useCallback((next: T | ((prev: T) => T)) => setValue(next), [])
  return [value, update] as const
}
